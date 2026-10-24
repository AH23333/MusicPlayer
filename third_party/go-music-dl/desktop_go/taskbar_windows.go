//go:build windows

package main

import (
	"errors"
	"fmt"
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const (
	taskbarButtonPrevious uint32 = 0xE001
	taskbarButtonToggle   uint32 = 0xE002
	taskbarButtonNext     uint32 = 0xE003

	thbIcon    uint32 = 0x2
	thbTooltip uint32 = 0x4
	thbFlags   uint32 = 0x8

	thbfEnabled  uint32 = 0x0
	thbfDisabled uint32 = 0x1

	thbnClicked uint32 = 0x1800
	wmCommand   uint32 = 0x0111
	wmNCDestroy uint32 = 0x0082
	wmApp       uint32 = 0x8000

	taskbarToolbarSubclassID = 0xE001
	taskbarToolbarInitMsg    = wmApp + 0x421
)

var (
	taskbarUser32   = windows.NewLazySystemDLL("user32.dll")
	taskbarComctl32 = windows.NewLazySystemDLL("comctl32.dll")
	taskbarOle32    = windows.NewLazySystemDLL("ole32.dll")

	procCreateIcon           = taskbarUser32.NewProc("CreateIcon")
	procDestroyIcon          = taskbarUser32.NewProc("DestroyIcon")
	procPostMessageW         = taskbarUser32.NewProc("PostMessageW")
	procRegisterWindowMsgW   = taskbarUser32.NewProc("RegisterWindowMessageW")
	procIsWindow             = taskbarUser32.NewProc("IsWindow")
	procSetWindowSubclass    = taskbarComctl32.NewProc("SetWindowSubclass")
	procRemoveWindowSubclass = taskbarComctl32.NewProc("RemoveWindowSubclass")
	procDefSubclassProc      = taskbarComctl32.NewProc("DefSubclassProc")
	procCoInitializeEx       = taskbarOle32.NewProc("CoInitializeEx")
	procCoCreateInstance     = taskbarOle32.NewProc("CoCreateInstance")
	procCoUninitialize       = taskbarOle32.NewProc("CoUninitialize")

	taskbarSubclassProc uintptr
	taskbarByWindow     sync.Map

	clsidTaskbarList = windows.GUID{
		Data1: 0x56FDF344,
		Data2: 0xFD6D,
		Data3: 0x11D0,
		Data4: [8]byte{0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90},
	}
	iidTaskbarList3 = windows.GUID{
		Data1: 0xEA1AFB91,
		Data2: 0x9E28,
		Data3: 0x4B86,
		Data4: [8]byte{0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xEF, 0xAF},
	}
)

func init() {
	taskbarSubclassProc = syscall.NewCallback(taskbarWindowProc)
}

type taskbarAction string

const (
	taskbarActionPrevious taskbarAction = "previous"
	taskbarActionToggle   taskbarAction = "toggle"
	taskbarActionNext     taskbarAction = "next"
)

type taskbarIcons struct {
	previous uintptr
	play     uintptr
	pause    uintptr
	next     uintptr
}

type taskbarToolbar struct {
	webview webview2.WebView
	hwnd    uintptr

	icons         taskbarIcons
	com           unsafe.Pointer
	vtable        unsafe.Pointer
	coInitialized bool
	initialized   bool
	closed        atomic.Bool

	stateMu   sync.Mutex
	hasTracks bool
	playing   bool

	taskbarCreatedMessage uint32
	closeOnce             sync.Once
}

func installTaskbarToolbar(w webview2.WebView) (*taskbarToolbar, error) {
	if w == nil {
		return nil, errors.New("webview is nil")
	}

	hwnd := uintptr(w.Window())
	if hwnd == 0 {
		return nil, errors.New("native window handle is unavailable")
	}

	icons, err := createTaskbarIcons()
	if err != nil {
		return nil, err
	}

	toolbar := &taskbarToolbar{
		webview: w,
		hwnd:    hwnd,
		icons:   icons,
	}

	if err := w.Bind("musicDlTaskbarState", toolbar.onPlaybackState); err != nil {
		icons.destroy()
		return nil, fmt.Errorf("bind playback state: %w", err)
	}

	ok, _, callErr := procSetWindowSubclass.Call(
		hwnd,
		taskbarSubclassProc,
		taskbarToolbarSubclassID,
		0,
	)
	if ok == 0 {
		icons.destroy()
		return nil, fmt.Errorf("SetWindowSubclass: %w", callErr)
	}

	taskbarByWindow.Store(hwnd, toolbar)
	toolbar.taskbarCreatedMessage = registerTaskbarCreatedMessage()

	// The shell may not have created the taskbar button at construction time.
	// Try immediately and retry once the webview message loop is running.
	toolbar.initialize()
	_, _, _ = procPostMessageW.Call(hwnd, uintptr(taskbarToolbarInitMsg), 0, 0)
	return toolbar, nil
}

func (t *taskbarToolbar) Close() {
	t.cleanup()
}

func (t *taskbarToolbar) cleanup() {
	t.closeOnce.Do(func() {
		t.closed.Store(true)
		taskbarByWindow.Delete(t.hwnd)

		if t.hwnd != 0 {
			if visible, _, _ := procIsWindow.Call(t.hwnd); visible != 0 {
				_, _, _ = procRemoveWindowSubclass.Call(
					t.hwnd,
					taskbarSubclassProc,
					taskbarToolbarSubclassID,
				)
			}
		}
		t.releaseTaskbar()
		t.icons.destroy()
		t.hwnd = 0
	})
}

func (t *taskbarToolbar) initialize() {
	if t.closed.Load() || t.initialized {
		return
	}

	if t.com == nil {
		if err := t.createTaskbarList(); err != nil {
			log.Printf("taskbar thumbnail toolbar initialization failed: %v", err)
			return
		}
	}

	hasTracks, playing := t.playbackState()
	buttons := makeThumbButtons(hasTracks, playing, t.icons)
	hr := t.callTaskbar(15, t.hwnd, uintptr(len(buttons)), uintptr(unsafe.Pointer(&buttons[0])))
	runtime.KeepAlive(buttons)
	if hr != 0 {
		log.Printf("ThumbBarAddButtons failed: %s", formatHRESULT(hr))
		t.releaseTaskbar()
		return
	}

	t.initialized = true
	log.Printf("taskbar thumbnail toolbar installed with %d buttons", len(buttons))
}

func (t *taskbarToolbar) createTaskbarList() error {
	hr, _, _ := procCoInitializeEx.Call(0, uintptr(windows.COINIT_APARTMENTTHREADED))
	switch uint32(hr) {
	case 0, uint32(windows.S_FALSE):
		t.coInitialized = true
	case uint32(windows.RPC_E_CHANGED_MODE):
		// WebView2 may already have initialized this thread. Continue with the
		// existing apartment mode and balance only the calls that succeeded.
	default:
		return fmt.Errorf("CoInitializeEx failed: %s", formatHRESULT(hr))
	}

	var instance unsafe.Pointer
	hr, _, _ = procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidTaskbarList)),
		0,
		uintptr(windows.CLSCTX_INPROC_SERVER),
		uintptr(unsafe.Pointer(&iidTaskbarList3)),
		uintptr(unsafe.Pointer(&instance)),
	)
	if uint32(hr) != 0 || instance == nil {
		t.uninitializeCOM()
		return fmt.Errorf("CoCreateInstance(ITaskbarList3) failed: %s", formatHRESULT(hr))
	}

	t.com = instance
	t.vtable = *(*unsafe.Pointer)(instance)
	hr = t.callTaskbar(3)
	if uint32(hr) != 0 {
		t.releaseTaskbar()
		return fmt.Errorf("ITaskbarList3.HrInit failed: %s", formatHRESULT(hr))
	}
	return nil
}

func (t *taskbarToolbar) releaseTaskbar() {
	if t.com != nil {
		t.callTaskbar(2)
		t.com = nil
		t.vtable = nil
	}
	t.initialized = false
	t.uninitializeCOM()
}

func (t *taskbarToolbar) uninitializeCOM() {
	if t.coInitialized {
		_, _, _ = procCoUninitialize.Call()
		t.coInitialized = false
	}
}

func (t *taskbarToolbar) callTaskbar(method uintptr, args ...uintptr) uintptr {
	if t.com == nil || t.vtable == nil {
		return 0x80004005
	}

	methods := unsafe.Slice((*uintptr)(t.vtable), 18)
	address := methods[method]
	callArgs := make([]uintptr, 0, len(args)+1)
	callArgs = append(callArgs, uintptr(t.com))
	callArgs = append(callArgs, args...)
	result, _, _ := syscall.SyscallN(address, callArgs...)
	runtime.KeepAlive(t.com)
	return result
}

func (t *taskbarToolbar) onPlaybackState(hasTracks, playing bool) {
	if t.closed.Load() {
		return
	}
	t.webview.Dispatch(func() {
		t.stateMu.Lock()
		changed := t.hasTracks != hasTracks || t.playing != playing
		t.hasTracks = hasTracks
		t.playing = hasTracks && playing
		t.stateMu.Unlock()
		if changed {
			log.Printf("taskbar playback state: tracks=%v playing=%v", hasTracks, t.playing)
			t.updateButtons()
		}
	})
}

func (t *taskbarToolbar) playbackState() (bool, bool) {
	t.stateMu.Lock()
	defer t.stateMu.Unlock()
	return t.hasTracks, t.playing
}

func (t *taskbarToolbar) updateButtons() {
	if t.closed.Load() || !t.initialized || t.com == nil {
		return
	}

	hasTracks, playing := t.playbackState()
	buttons := makeThumbButtons(hasTracks, playing, t.icons)
	hr := t.callTaskbar(16, t.hwnd, uintptr(len(buttons)), uintptr(unsafe.Pointer(&buttons[0])))
	runtime.KeepAlive(buttons)
	if hr != 0 {
		log.Printf("ThumbBarUpdateButtons failed: %s", formatHRESULT(hr))
	}
}

func (t *taskbarToolbar) handleCommand(wParam uintptr) {
	action := taskbarActionFromCommand(wParam)
	if action == "" {
		return
	}

	t.webview.Eval(taskbarControlScript(action))
	log.Printf("taskbar thumbnail control: %s", action)
}

func (t *taskbarToolbar) handleTaskbarCreated() {
	t.releaseTaskbar()
	t.initialize()
}

func taskbarActionFromCommand(wParam uintptr) taskbarAction {
	if uint32(wParam>>16) != thbnClicked {
		return ""
	}
	switch uint32(wParam & 0xFFFF) {
	case taskbarButtonPrevious:
		return taskbarActionPrevious
	case taskbarButtonToggle:
		return taskbarActionToggle
	case taskbarButtonNext:
		return taskbarActionNext
	default:
		return ""
	}
}

func taskbarControlScript(action taskbarAction) string {
	return fmt.Sprintf(
		`(function(){var control=window.musicDlTaskbarControl;if(typeof control==="function"){control(%q);}})();`,
		action,
	)
}

func taskbarWindowProc(hwnd, message, wParam, lParam, _ uintptr, _ uintptr) uintptr {
	value, ok := taskbarByWindow.Load(hwnd)
	if !ok {
		return callDefSubclassProc(hwnd, message, wParam, lParam)
	}
	toolbar, ok := value.(*taskbarToolbar)
	if !ok {
		return callDefSubclassProc(hwnd, message, wParam, lParam)
	}

	switch uint32(message) {
	case wmCommand:
		if taskbarActionFromCommand(wParam) != "" {
			toolbar.handleCommand(wParam)
			return 0
		}
	case wmNCDestroy:
		toolbar.cleanup()
		return callDefSubclassProc(hwnd, message, wParam, lParam)
	case taskbarToolbarInitMsg:
		toolbar.initialize()
		return 0
	default:
		if toolbar.taskbarCreatedMessage != 0 &&
			uint32(message) == toolbar.taskbarCreatedMessage {
			toolbar.handleTaskbarCreated()
			return 0
		}
	}

	return callDefSubclassProc(hwnd, message, wParam, lParam)
}

func callDefSubclassProc(hwnd, message, wParam, lParam uintptr) uintptr {
	result, _, _ := procDefSubclassProc.Call(hwnd, message, wParam, lParam)
	return result
}

func registerTaskbarCreatedMessage() uint32 {
	name, err := windows.UTF16PtrFromString("TaskbarCreated")
	if err != nil {
		return 0
	}
	result, _, _ := procRegisterWindowMsgW.Call(uintptr(unsafe.Pointer(name)))
	return uint32(result)
}

func makeThumbButtons(hasTracks, playing bool, icons taskbarIcons) [3]thumbButton {
	toggleIcon := icons.play
	toggleTip := "播放"
	if playing {
		toggleIcon = icons.pause
		toggleTip = "暂停"
	}
	return [3]thumbButton{
		newThumbButton(taskbarButtonPrevious, "上一首", icons.previous, hasTracks),
		newThumbButton(taskbarButtonToggle, toggleTip, toggleIcon, hasTracks),
		newThumbButton(taskbarButtonNext, "下一首", icons.next, hasTracks),
	}
}

func newThumbButton(id uint32, tip string, icon uintptr, enabled bool) thumbButton {
	button := thumbButton{
		Mask:  thbIcon | thbTooltip | thbFlags,
		ID:    id,
		Icon:  icon,
		Flags: thbfEnabled,
	}
	if !enabled {
		button.Flags = thbfDisabled
	}
	label, err := windows.UTF16FromString(tip)
	if err == nil {
		copy(button.Tip[:len(button.Tip)-1], label)
	}
	return button
}

func createTaskbarIcons() (taskbarIcons, error) {
	icons := taskbarIcons{}
	var err error
	if icons.previous, err = createMonochromeIcon(taskbarIconPrevious); err != nil {
		return icons, err
	}
	if icons.play, err = createMonochromeIcon(taskbarIconPlay); err != nil {
		icons.destroy()
		return taskbarIcons{}, err
	}
	if icons.pause, err = createMonochromeIcon(taskbarIconPause); err != nil {
		icons.destroy()
		return taskbarIcons{}, err
	}
	if icons.next, err = createMonochromeIcon(taskbarIconNext); err != nil {
		icons.destroy()
		return taskbarIcons{}, err
	}
	return icons, nil
}

func (icons *taskbarIcons) destroy() {
	for _, icon := range []uintptr{icons.previous, icons.play, icons.pause, icons.next} {
		if icon != 0 {
			_, _, _ = procDestroyIcon.Call(icon)
		}
	}
	*icons = taskbarIcons{}
}

type taskbarIconKind int

const (
	taskbarIconPrevious taskbarIconKind = iota
	taskbarIconPlay
	taskbarIconPause
	taskbarIconNext
)

func createMonochromeIcon(kind taskbarIconKind) (uintptr, error) {
	andBits, xorBits := renderMonochromeIcon(kind, 16)
	icon, _, callErr := procCreateIcon.Call(
		0,
		16,
		16,
		1,
		1,
		uintptr(unsafe.Pointer(&andBits[0])),
		uintptr(unsafe.Pointer(&xorBits[0])),
	)
	runtime.KeepAlive(andBits)
	runtime.KeepAlive(xorBits)
	if icon == 0 {
		return 0, fmt.Errorf("CreateIcon: %w", callErr)
	}
	return icon, nil
}

func renderMonochromeIcon(kind taskbarIconKind, size int) ([]byte, []byte) {
	if size <= 0 {
		size = 16
	}
	stride := ((size + 31) / 32) * 4
	andBits := make([]byte, stride*size)
	xorBits := make([]byte, stride*size)
	for i := range andBits {
		andBits[i] = 0xFF
	}

	shape := make([]bool, size*size)
	setPixel := func(x, y int) {
		if x >= 0 && x < size && y >= 0 && y < size {
			shape[y*size+x] = true
		}
	}
	clearPixel := func(x, y int) {
		if x >= 0 && x < size && y >= 0 && y < size {
			shape[y*size+x] = false
		}
	}
	fillTriangle := func(x0, y0, x1, y1, x2, y2 int) {
		line := func(ax, ay, bx, by int) {
			dx := absInt(bx - ax)
			dy := -absInt(by - ay)
			sx := -1
			if ax < bx {
				sx = 1
			}
			sy := -1
			if ay < by {
				sy = 1
			}
			err := dx + dy
			for {
				setPixel(ax, ay)
				if ax == bx && ay == by {
					return
				}
				e2 := 2 * err
				if e2 >= dy {
					err += dy
					ax += sx
				}
				if e2 <= dx {
					err += dx
					ay += sy
				}
			}
		}
		line(x0, y0, x1, y1)
		line(x1, y1, x2, y2)
		line(x2, y2, x0, y0)
		for y := 0; y < size; y++ {
			for x := 0; x < size; x++ {
				if pointInTriangle(x, y, x0, y0, x1, y1, x2, y2) {
					setPixel(x, y)
				}
			}
		}
	}
	fillRect := func(left, top, right, bottom int) {
		for y := top; y <= bottom; y++ {
			for x := left; x <= right; x++ {
				setPixel(x, y)
			}
		}
	}
	fillRoundedRect := func(left, top, right, bottom, radius int) {
		if radius <= 0 {
			fillRect(left, top, right, bottom)
			return
		}
		radiusX := min(radius, max((right-left+1)/2, 1))
		radiusY := min(radius, max((bottom-top+1)/2, 1))
		for y := top; y <= bottom; y++ {
			for x := left; x <= right; x++ {
				dx := 0
				if x < left+radiusX {
					dx = left + radiusX - x
				} else if x > right-radiusX {
					dx = x - (right - radiusX)
				}
				dy := 0
				if y < top+radiusY {
					dy = top + radiusY - y
				} else if y > bottom-radiusY {
					dy = y - (bottom - radiusY)
				}
				if dx*dx*radiusY*radiusY+dy*dy*radiusX*radiusX <=
					radiusX*radiusX*radiusY*radiusY {
					setPixel(x, y)
				}
			}
		}
	}

	switch kind {
	case taskbarIconPrevious:
		fillTriangle(3, 2, 3, 13, 10, 8)
		for _, point := range [][2]int{{3, 2}, {3, 13}, {10, 8}} {
			clearPixel(point[0], point[1])
		}
		fillRoundedRect(11, 2, 12, 13, 1)
	case taskbarIconNext:
		fillTriangle(4, 2, 4, 13, 11, 8)
		for _, point := range [][2]int{{4, 2}, {4, 13}, {11, 8}} {
			clearPixel(point[0], point[1])
		}
		fillRoundedRect(12, 2, 13, 13, 1)
	case taskbarIconPause:
		fillRoundedRect(3, 2, 5, 13, 1)
		fillRoundedRect(10, 2, 12, 13, 1)
	default:
		fillTriangle(4, 2, 4, 13, 13, 8)
		for _, point := range [][2]int{{4, 2}, {4, 13}, {13, 8}} {
			clearPixel(point[0], point[1])
		}
	}

	isShape := func(x, y int) bool {
		return x >= 0 && x < size && y >= 0 && y < size && shape[y*size+x]
	}
	for y := 0; y < size; y++ {
		row := size - 1 - y
		for x := 0; x < size; x++ {
			if !isShape(x, y) {
				continue
			}
			andIndex := row*stride + x/8
			xorIndex := row*stride + x/8
			mask := byte(0x80 >> (x % 8))
			andBits[andIndex] &^= mask
			edge := !isShape(x-1, y) || !isShape(x+1, y) ||
				!isShape(x, y-1) || !isShape(x, y+1)
			if !edge {
				xorBits[xorIndex] |= mask
			}
		}
	}
	return andBits, xorBits
}

func pointInTriangle(x, y, x0, y0, x1, y1, x2, y2 int) bool {
	d1 := signInt((x-x1)*(y0-y1) - (x0-x1)*(y-y1))
	d2 := signInt((x-x2)*(y1-y2) - (x1-x2)*(y-y2))
	d3 := signInt((x-x0)*(y2-y0) - (x2-x0)*(y-y0))
	hasNegative := d1 < 0 || d2 < 0 || d3 < 0
	hasPositive := d1 > 0 || d2 > 0 || d3 > 0
	return !(hasNegative && hasPositive)
}

func signInt(value int) int {
	switch {
	case value < 0:
		return -1
	case value > 0:
		return 1
	default:
		return 0
	}
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func formatHRESULT(value uintptr) string {
	return fmt.Sprintf("0x%08X", uint32(value))
}
