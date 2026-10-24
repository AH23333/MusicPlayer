use std::cell::RefCell;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use tao::event_loop::EventLoopProxy;
use windows::core::w;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, RPC_E_CHANGED_MODE, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, TaskbarList,
    THBF_DISABLED, THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIcon, DestroyIcon, PostMessageW, RegisterWindowMessageW, HICON, WM_APP, WM_COMMAND,
    WM_NCDESTROY,
};

use crate::DesktopEvent;

const BUTTON_PREVIOUS: u32 = 0xE001;
const BUTTON_TOGGLE: u32 = 0xE002;
const BUTTON_NEXT: u32 = 0xE003;

const SUBCLASS_ID: usize = 0xE001;
const INITIALIZE_MESSAGE: u32 = WM_APP + 0x421;
const ICON_SIZE: usize = 16;
const ICON_STRIDE: usize = 4;

pub const INITIALIZATION_SCRIPT: &str = r#"
Object.defineProperty(window, "musicDlTaskbarState", {
  configurable: true,
  value: function (hasTracks, isPlaying) {
    window.ipc.postMessage(
      (hasTracks ? "1" : "0") + "|" + (isPlaying ? "1" : "0"),
    );
  },
});
"#;

thread_local! {
    static TOOLBAR: RefCell<Option<TaskbarToolbar>> = const { RefCell::new(None) };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskbarAction {
    Previous,
    Toggle,
    Next,
}

impl TaskbarAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Previous => "previous",
            Self::Toggle => "toggle",
            Self::Next => "next",
        }
    }
}

struct TaskbarIcons {
    previous: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
}

impl TaskbarIcons {
    fn create() -> Result<Self, String> {
        let mut icons = Self {
            previous: HICON::default(),
            play: HICON::default(),
            pause: HICON::default(),
            next: HICON::default(),
        };
        for (index, kind) in [
            IconKind::Previous,
            IconKind::Play,
            IconKind::Pause,
            IconKind::Next,
        ]
        .into_iter()
        .enumerate()
        {
            match create_monochrome_icon(kind) {
                Ok(icon) => match index {
                    0 => icons.previous = icon,
                    1 => icons.play = icon,
                    2 => icons.pause = icon,
                    _ => icons.next = icon,
                },
                Err(error) => {
                    icons.destroy();
                    return Err(error);
                }
            }
        }
        Ok(icons)
    }

    fn destroy(&mut self) {
        for icon in [
            &mut self.previous,
            &mut self.play,
            &mut self.pause,
            &mut self.next,
        ] {
            if !icon.is_invalid() {
                unsafe {
                    let _ = DestroyIcon(*icon);
                }
                *icon = HICON::default();
            }
        }
    }
}

struct TaskbarToolbar {
    hwnd: HWND,
    proxy: EventLoopProxy<DesktopEvent>,
    log_path: PathBuf,
    icons: TaskbarIcons,
    taskbar: Option<ITaskbarList3>,
    taskbar_created_message: u32,
    com_initialized: bool,
    subclass_installed: bool,
    initialized: bool,
    cleaned: bool,
    has_tracks: bool,
    playing: bool,
}

impl TaskbarToolbar {
    fn initialize(&mut self) {
        if self.cleaned || self.initialized {
            return;
        }

        if let Err(error) = self.try_initialize() {
            self.taskbar = None;
            self.initialized = false;
            self.log(&format!(
                "taskbar thumbnail toolbar initialization failed: {error}"
            ));
        }
    }

    fn try_initialize(&mut self) -> Result<(), String> {
        if self.taskbar.is_none() {
            let taskbar: ITaskbarList3 =
                unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
                    .map_err(|error| format!("CoCreateInstance(ITaskbarList3): {error}"))?;
            unsafe {
                taskbar
                    .HrInit()
                    .map_err(|error| format!("ITaskbarList3.HrInit: {error}"))?;
            }
            self.taskbar = Some(taskbar);
        }

        let buttons = make_buttons(self.has_tracks, self.playing, &self.icons);
        unsafe {
            self.taskbar
                .as_ref()
                .expect("taskbar interface initialized")
                .ThumbBarAddButtons(self.hwnd, &buttons)
                .map_err(|error| format!("ThumbBarAddButtons: {error}"))?;
        }
        self.initialized = true;
        self.log("taskbar thumbnail toolbar installed with 3 buttons");
        Ok(())
    }

    fn update_buttons(&mut self) {
        if !self.initialized {
            return;
        }
        let Some(taskbar) = self.taskbar.as_ref() else {
            return;
        };
        let buttons = make_buttons(self.has_tracks, self.playing, &self.icons);
        if let Err(error) = unsafe { taskbar.ThumbBarUpdateButtons(self.hwnd, &buttons) } {
            self.log(&format!("ThumbBarUpdateButtons failed: {error}"));
        }
    }

    fn set_playback_state(&mut self, has_tracks: bool, playing: bool) {
        let playing = has_tracks && playing;
        if self.has_tracks == has_tracks && self.playing == playing {
            return;
        }
        self.has_tracks = has_tracks;
        self.playing = playing;
        self.log(&format!(
            "taskbar playback state: tracks={has_tracks} playing={playing}"
        ));
        self.update_buttons();
    }

    fn taskbar_created(&mut self) {
        self.taskbar = None;
        self.initialized = false;
        self.initialize();
    }

    fn send_action(&mut self, action: TaskbarAction) {
        self.log(&format!("taskbar thumbnail control: {}", action.as_str()));
        let _ = self.proxy.send_event(DesktopEvent::Taskbar(action));
    }

    fn log(&self, message: &str) {
        append_log(&self.log_path, message);
    }

    fn shutdown(&mut self, remove_subclass: bool) {
        if self.cleaned {
            return;
        }
        self.cleaned = true;
        self.initialized = false;
        self.taskbar = None;
        self.icons.destroy();

        if remove_subclass && self.subclass_installed && !self.hwnd.is_invalid() {
            unsafe {
                let _ = RemoveWindowSubclass(self.hwnd, Some(window_proc), SUBCLASS_ID);
            }
        }
        self.subclass_installed = false;

        if self.com_initialized {
            unsafe {
                CoUninitialize();
            }
            self.com_initialized = false;
        }
    }
}

impl Drop for TaskbarToolbar {
    fn drop(&mut self) {
        self.shutdown(true);
    }
}

pub fn install(
    hwnd: isize,
    proxy: EventLoopProxy<DesktopEvent>,
    log_path: &Path,
) -> Result<(), String> {
    let hwnd = HWND(hwnd as *mut _);
    if hwnd.is_invalid() {
        return Err("native window handle is unavailable".to_string());
    }

    let icons = TaskbarIcons::create()?;
    let com_result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let com_initialized = com_result.is_ok();
    if com_result.is_err() && com_result != RPC_E_CHANGED_MODE {
        let mut icons = icons;
        icons.destroy();
        return Err(format!("CoInitializeEx failed: {com_result}"));
    }

    let taskbar_created_message = unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) };
    let mut toolbar = TaskbarToolbar {
        hwnd,
        proxy,
        log_path: log_path.to_path_buf(),
        icons,
        taskbar: None,
        taskbar_created_message,
        com_initialized,
        subclass_installed: false,
        initialized: false,
        cleaned: false,
        has_tracks: false,
        playing: false,
    };

    let subclassed =
        unsafe { SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, 0).as_bool() };
    if !subclassed {
        toolbar.shutdown(false);
        return Err("SetWindowSubclass failed".to_string());
    }
    toolbar.subclass_installed = true;

    TOOLBAR.with(|slot| {
        *slot.borrow_mut() = Some(toolbar);
    });

    TOOLBAR.with(|slot| {
        if let Some(toolbar) = slot.borrow_mut().as_mut() {
            toolbar.initialize();
        }
    });

    // The shell may not have created the taskbar button when the window is
    // constructed, so retry after the application message loop starts.
    unsafe {
        let _ = PostMessageW(hwnd, INITIALIZE_MESSAGE, WPARAM(0), LPARAM(0));
    }
    Ok(())
}

pub fn record_unavailable(log_path: &Path, message: &str) {
    append_log(
        log_path,
        &format!("taskbar thumbnail toolbar is unavailable: {message}"),
    );
}

pub fn shutdown() {
    TOOLBAR.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            // A native window message can be processing toolbar state on the
            // same thread. Let the process exit path continue without panicking.
            return;
        };
        if let Some(toolbar) = slot.as_mut() {
            toolbar.shutdown(true);
        }
    });
}

pub fn handle_playback_state(payload: &str) {
    let Some((has_tracks, playing)) = parse_playback_state(payload) else {
        eprintln!("Ignoring malformed taskbar playback state: {payload:?}");
        return;
    };

    TOOLBAR.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            eprintln!("Ignoring taskbar playback state while the toolbar is busy");
            return;
        };
        if let Some(toolbar) = slot.as_mut() {
            toolbar.set_playback_state(has_tracks, playing);
        }
    });
}

pub fn control_script(action: TaskbarAction) -> String {
    format!(
        r#"(function(){{var control=window.musicDlTaskbarControl;if(typeof control==="function"){{control("{}");}}}})();"#,
        action.as_str()
    )
}

fn parse_playback_state(payload: &str) -> Option<(bool, bool)> {
    let (has_tracks, playing) = payload.trim().split_once('|')?;
    Some((parse_flag(has_tracks)?, parse_flag(playing)?))
}

fn parse_flag(value: &str) -> Option<bool> {
    match value {
        "0" => Some(false),
        "1" => Some(true),
        _ => None,
    }
}

fn action_from_command(wparam: WPARAM) -> Option<TaskbarAction> {
    let command = wparam.0 as u32;
    if command >> 16 != THBN_CLICKED {
        return None;
    }
    match command & 0xFFFF {
        BUTTON_PREVIOUS => Some(TaskbarAction::Previous),
        BUTTON_TOGGLE => Some(TaskbarAction::Toggle),
        BUTTON_NEXT => Some(TaskbarAction::Next),
        _ => None,
    }
}

fn make_buttons(has_tracks: bool, playing: bool, icons: &TaskbarIcons) -> [THUMBBUTTON; 3] {
    let (toggle_icon, toggle_tip) = if playing {
        (icons.pause, "暂停")
    } else {
        (icons.play, "播放")
    };
    [
        make_button(BUTTON_PREVIOUS, "上一首", icons.previous, has_tracks),
        make_button(BUTTON_TOGGLE, toggle_tip, toggle_icon, has_tracks),
        make_button(BUTTON_NEXT, "下一首", icons.next, has_tracks),
    ]
}

fn make_button(id: u32, tip: &str, icon: HICON, enabled: bool) -> THUMBBUTTON {
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        hIcon: icon,
        szTip: utf16_tip(tip),
        dwFlags: if enabled { THBF_ENABLED } else { THBF_DISABLED },
        ..THUMBBUTTON::default()
    }
}

fn utf16_tip(tip: &str) -> [u16; 260] {
    let mut result = [0_u16; 260];
    for (target, value) in result.iter_mut().zip(tip.encode_utf16()) {
        *target = value;
    }
    result
}

#[derive(Clone, Copy)]
enum IconKind {
    Previous,
    Play,
    Pause,
    Next,
}

fn create_monochrome_icon(kind: IconKind) -> Result<HICON, String> {
    let (and_bits, xor_bits) = render_monochrome_icon(kind);
    unsafe {
        CreateIcon(
            HINSTANCE::default(),
            ICON_SIZE as i32,
            ICON_SIZE as i32,
            1,
            1,
            and_bits.as_ptr(),
            xor_bits.as_ptr(),
        )
        .map_err(|error| format!("CreateIcon: {error}"))
    }
}

fn render_monochrome_icon(kind: IconKind) -> ([u8; 64], [u8; 64]) {
    let mut and_bits = [0xFF_u8; 64];
    let mut xor_bits = [0_u8; 64];
    let mut shape = [false; ICON_SIZE * ICON_SIZE];

    match kind {
        IconKind::Previous => {
            fill_icon_triangle(&mut shape, 3, 2, 3, 13, 10, 8);
            for (x, y) in [(3, 2), (3, 13), (10, 8)] {
                clear_icon_pixel(&mut shape, x, y);
            }
            fill_icon_rounded_rect(&mut shape, 11, 2, 12, 13, 1);
        }
        IconKind::Next => {
            fill_icon_triangle(&mut shape, 4, 2, 4, 13, 11, 8);
            for (x, y) in [(4, 2), (4, 13), (11, 8)] {
                clear_icon_pixel(&mut shape, x, y);
            }
            fill_icon_rounded_rect(&mut shape, 12, 2, 13, 13, 1);
        }
        IconKind::Pause => {
            fill_icon_rounded_rect(&mut shape, 3, 2, 5, 13, 1);
            fill_icon_rounded_rect(&mut shape, 10, 2, 12, 13, 1);
        }
        IconKind::Play => {
            fill_icon_triangle(&mut shape, 4, 2, 4, 13, 13, 8);
            for (x, y) in [(4, 2), (4, 13), (13, 8)] {
                clear_icon_pixel(&mut shape, x, y);
            }
        }
    }

    let is_shape = |x: i32, y: i32| {
        (0..ICON_SIZE as i32).contains(&x)
            && (0..ICON_SIZE as i32).contains(&y)
            && shape[y as usize * ICON_SIZE + x as usize]
    };
    for y in 0..ICON_SIZE as i32 {
        let row = ICON_SIZE - 1 - y as usize;
        for x in 0..ICON_SIZE as i32 {
            if !is_shape(x, y) {
                continue;
            }
            let index = row * ICON_STRIDE + x as usize / 8;
            let mask = 0x80_u8 >> (x as usize % 8);
            and_bits[index] &= !mask;
            let edge = !is_shape(x - 1, y)
                || !is_shape(x + 1, y)
                || !is_shape(x, y - 1)
                || !is_shape(x, y + 1);
            if !edge {
                xor_bits[index] |= mask;
            }
        }
    }
    (and_bits, xor_bits)
}

fn set_icon_pixel(shape: &mut [bool; ICON_SIZE * ICON_SIZE], x: i32, y: i32) {
    if (0..ICON_SIZE as i32).contains(&x) && (0..ICON_SIZE as i32).contains(&y) {
        shape[y as usize * ICON_SIZE + x as usize] = true;
    }
}

fn clear_icon_pixel(shape: &mut [bool; ICON_SIZE * ICON_SIZE], x: i32, y: i32) {
    if (0..ICON_SIZE as i32).contains(&x) && (0..ICON_SIZE as i32).contains(&y) {
        shape[y as usize * ICON_SIZE + x as usize] = false;
    }
}

fn fill_icon_rect(
    shape: &mut [bool; ICON_SIZE * ICON_SIZE],
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) {
    for y in top..=bottom {
        for x in left..=right {
            set_icon_pixel(shape, x, y);
        }
    }
}

fn fill_icon_rounded_rect(
    shape: &mut [bool; ICON_SIZE * ICON_SIZE],
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    radius: i32,
) {
    if radius <= 0 {
        fill_icon_rect(shape, left, top, right, bottom);
        return;
    }

    let radius_x = radius.min(((right - left + 1) / 2).max(1));
    let radius_y = radius.min(((bottom - top + 1) / 2).max(1));
    for y in top..=bottom {
        for x in left..=right {
            let dx = if x < left + radius_x {
                left + radius_x - x
            } else if x > right - radius_x {
                x - (right - radius_x)
            } else {
                0
            };
            let dy = if y < top + radius_y {
                top + radius_y - y
            } else if y > bottom - radius_y {
                y - (bottom - radius_y)
            } else {
                0
            };
            if dx * dx * radius_y * radius_y + dy * dy * radius_x * radius_x
                <= radius_x * radius_x * radius_y * radius_y
            {
                set_icon_pixel(shape, x, y);
            }
        }
    }
}

#[derive(Clone, Copy)]
struct Point(i32, i32);

fn fill_icon_triangle(
    shape: &mut [bool; ICON_SIZE * ICON_SIZE],
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
) {
    draw_icon_line(shape, x0, y0, x1, y1);
    draw_icon_line(shape, x1, y1, x2, y2);
    draw_icon_line(shape, x2, y2, x0, y0);
    for y in 0..ICON_SIZE as i32 {
        for x in 0..ICON_SIZE as i32 {
            if point_in_triangle(Point(x, y), Point(x0, y0), Point(x1, y1), Point(x2, y2)) {
                set_icon_pixel(shape, x, y);
            }
        }
    }
}

fn draw_icon_line(
    shape: &mut [bool; ICON_SIZE * ICON_SIZE],
    mut ax: i32,
    mut ay: i32,
    bx: i32,
    by: i32,
) {
    let dx = (bx - ax).abs();
    let dy = -(by - ay).abs();
    let sx = if ax < bx { 1 } else { -1 };
    let sy = if ay < by { 1 } else { -1 };
    let mut error = dx + dy;
    loop {
        set_icon_pixel(shape, ax, ay);
        if ax == bx && ay == by {
            break;
        }
        let doubled = 2 * error;
        if doubled >= dy {
            error += dy;
            ax += sx;
        }
        if doubled <= dx {
            error += dx;
            ay += sy;
        }
    }
}

fn point_in_triangle(point: Point, a: Point, b: Point, c: Point) -> bool {
    let Point(x, y) = point;
    let Point(x0, y0) = a;
    let Point(x1, y1) = b;
    let Point(x2, y2) = c;
    let d1 = ((x - x1) * (y0 - y1) - (x0 - x1) * (y - y1)).signum();
    let d2 = ((x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)).signum();
    let d3 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)).signum();
    let has_negative = d1 < 0 || d2 < 0 || d3 < 0;
    let has_positive = d1 > 0 || d2 > 0 || d3 > 0;
    !(has_negative && has_positive)
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    let handled = TOOLBAR.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            // Shell calls can synchronously dispatch window messages while a
            // toolbar operation owns the state. Let the default window proc
            // handle those nested messages without re-entering the RefCell.
            return None;
        };
        let toolbar = slot.as_mut()?;
        if toolbar.hwnd != hwnd || toolbar.cleaned {
            return None;
        }

        if message == WM_COMMAND {
            if let Some(action) = action_from_command(wparam) {
                toolbar.send_action(action);
                return Some(LRESULT(0));
            }
        } else if message == INITIALIZE_MESSAGE {
            toolbar.initialize();
            return Some(LRESULT(0));
        } else if toolbar.taskbar_created_message != 0 && message == toolbar.taskbar_created_message
        {
            toolbar.taskbar_created();
            return Some(LRESULT(0));
        } else if message == WM_NCDESTROY {
            toolbar.shutdown(false);
        }

        None
    });

    // Never keep the thread-local toolbar borrowed while the original window
    // procedure runs. Tao can synchronously dispatch close events from here.
    handled.unwrap_or_else(|| unsafe { DefSubclassProc(hwnd, message, wparam, lparam) })
}

fn append_log(path: &Path, message: &str) {
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "[taskbar] {message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_playback_state() {
        assert_eq!(parse_playback_state("1|1"), Some((true, true)));
        assert_eq!(parse_playback_state("1|0"), Some((true, false)));
        assert_eq!(parse_playback_state("0|0"), Some((false, false)));
        assert_eq!(parse_playback_state("yes|1"), None);
        assert_eq!(parse_playback_state("1"), None);
    }

    #[test]
    fn maps_taskbar_commands() {
        assert_eq!(
            action_from_command(WPARAM((THBN_CLICKED << 16 | BUTTON_PREVIOUS) as usize)),
            Some(TaskbarAction::Previous)
        );
        assert_eq!(
            action_from_command(WPARAM((THBN_CLICKED << 16 | BUTTON_TOGGLE) as usize)),
            Some(TaskbarAction::Toggle)
        );
        assert_eq!(
            action_from_command(WPARAM((THBN_CLICKED << 16 | BUTTON_NEXT) as usize)),
            Some(TaskbarAction::Next)
        );
        assert_eq!(action_from_command(WPARAM(BUTTON_TOGGLE as usize)), None);
        assert_eq!(
            action_from_command(WPARAM((THBN_CLICKED << 16 | 0x1234) as usize)),
            None
        );
    }

    #[test]
    fn buttons_follow_playback_state() {
        let icons = TaskbarIcons {
            previous: HICON(0x11 as _),
            play: HICON(0x22 as _),
            pause: HICON(0x33 as _),
            next: HICON(0x44 as _),
        };
        let playing = make_buttons(true, true, &icons);
        assert_eq!(playing[0].iId, BUTTON_PREVIOUS);
        assert_eq!(playing[1].iId, BUTTON_TOGGLE);
        assert_eq!(playing[2].iId, BUTTON_NEXT);
        assert_eq!(playing[1].hIcon, icons.pause);
        assert!(playing.iter().all(|button| button.dwFlags == THBF_ENABLED));

        let disabled = make_buttons(false, false, &icons);
        assert_eq!(disabled[1].hIcon, icons.play);
        assert!(disabled
            .iter()
            .all(|button| button.dwFlags == THBF_DISABLED));
    }

    #[test]
    fn native_thumb_button_layout_matches_windows() {
        let expected = if core::mem::size_of::<usize>() == 8 {
            552
        } else {
            544
        };
        assert_eq!(core::mem::size_of::<THUMBBUTTON>(), expected);
    }

    #[test]
    fn renders_visible_play_icon() {
        let (and_bits, xor_bits) = render_monochrome_icon(IconKind::Play);
        assert!(and_bits.iter().any(|value| *value != 0xFF));
        assert!(xor_bits.iter().any(|value| *value != 0));
    }

    #[test]
    fn renders_rounded_taskbar_icon_corners() {
        let pixel_is_visible = |kind, x: usize, y: usize| {
            let (and_bits, _) = render_monochrome_icon(kind);
            let row = ICON_SIZE - 1 - y;
            let mask = 0x80 >> (x % 8);
            and_bits[row * ICON_STRIDE + x / 8] & mask == 0
        };

        assert!(!pixel_is_visible(IconKind::Play, 13, 8));
        assert!(pixel_is_visible(IconKind::Play, 12, 8));
        assert!(!pixel_is_visible(IconKind::Pause, 3, 2));
        assert!(!pixel_is_visible(IconKind::Pause, 5, 2));
        assert!(pixel_is_visible(IconKind::Pause, 4, 3));
        assert!(!pixel_is_visible(IconKind::Previous, 11, 2));
    }

    #[test]
    fn control_script_targets_frontend_bridge() {
        let script = control_script(TaskbarAction::Next);
        assert!(script.contains("window.musicDlTaskbarControl"));
        assert!(script.contains("\"next\""));
        assert!(INITIALIZATION_SCRIPT.contains("window.ipc.postMessage"));
    }
}
