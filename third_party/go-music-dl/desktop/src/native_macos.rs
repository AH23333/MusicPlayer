use std::ffi::{c_char, CStr};

extern "C" {
    fn music_dl_install_native_menu();
    fn music_dl_pick_folder() -> *mut c_char;
    fn music_dl_free_string(value: *mut c_char);
}

const FOLDER_PICK_PREFIX: &str = "folder-pick:";

pub const INITIALIZATION_SCRIPT: &str = r#"
(() => {
  const callbacks = new Map();
  let nextId = 1;

  Object.defineProperty(window, "musicDlPickDownloadFolder", {
    configurable: true,
    value: function () {
      return new Promise((resolve, reject) => {
        const id = String(nextId++);
        callbacks.set(id, { resolve, reject });
        try {
          window.ipc.postMessage("folder-pick:" + id);
        } catch (error) {
          callbacks.delete(id);
          reject(error);
        }
      });
    },
  });

  Object.defineProperty(window, "__musicDlCompleteFolderPick", {
    configurable: true,
    value: function (id, path, error) {
      const key = String(id);
      const callback = callbacks.get(key);
      if (!callback) return;
      callbacks.delete(key);
      if (error) callback.reject(new Error(error));
      else callback.resolve(path || "");
    },
  });
})();
"#;

pub fn install_native_menu() {
    unsafe {
        music_dl_install_native_menu();
    }
}

pub fn pick_folder() -> Option<String> {
    let path = unsafe { music_dl_pick_folder() };
    if path.is_null() {
        return None;
    }

    let value = unsafe { CStr::from_ptr(path) }
        .to_string_lossy()
        .into_owned();
    unsafe {
        music_dl_free_string(path);
    }
    Some(value)
}

pub fn parse_folder_pick_request(payload: &str) -> Option<u64> {
    payload
        .strip_prefix(FOLDER_PICK_PREFIX)?
        .parse()
        .ok()
        .filter(|id| *id > 0)
}

pub fn folder_pick_result_script(id: u64, path: Option<&str>) -> String {
    let path = path
        .map(js_string_literal)
        .unwrap_or_else(|| "null".to_string());
    format!(
        r#"(function(){{var complete=window.__musicDlCompleteFolderPick;if(typeof complete==="function"){{complete({id},{path},null);}}}})();"#
    )
}

fn js_string_literal(value: &str) -> String {
    let mut result = String::with_capacity(value.len() + 2);
    result.push('"');
    for character in value.chars() {
        match character {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            '\u{08}' => result.push_str("\\b"),
            '\u{0c}' => result.push_str("\\f"),
            '\u{2028}' => result.push_str("\\u2028"),
            '\u{2029}' => result.push_str("\\u2029"),
            value if value.is_control() => {
                result.push_str(&format!("\\u{:04x}", value as u32));
            }
            value => result.push(value),
        }
    }
    result.push('"');
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_folder_pick_requests() {
        assert_eq!(parse_folder_pick_request("folder-pick:42"), Some(42));
        assert_eq!(parse_folder_pick_request("folder-pick:0"), None);
        assert_eq!(parse_folder_pick_request("folder-pick:-1"), None);
        assert_eq!(parse_folder_pick_request("folder-pick:"), None);
        assert_eq!(parse_folder_pick_request("playback|1|0"), None);
    }

    #[test]
    fn completion_script_escapes_native_paths() {
        let script =
            folder_pick_result_script(7, Some("/Users/me/Music \"mix\"\\folder\n\u{2028}"));
        assert!(script.contains("complete(7,"));
        assert!(script.contains(r#""/Users/me/Music \"mix\"\\folder\n\u2028""#));
    }

    #[test]
    fn cancelled_picker_resolves_without_a_path() {
        let script = folder_pick_result_script(9, None);
        assert!(script.contains("complete(9,null,null)"));
    }
}
