#![cfg(windows)]
//! Explicit smoke test: creates only synthetic source windows, never reads user apps.
use std::io::{BufRead, Write};
use std::process::{Child, Command, Stdio};
use std::{sync::mpsc, thread, time::Duration};
use translation_desktop_lib::selected_text::windows::WindowsInputRuntime;
use translation_desktop_lib::selected_text::windows::WindowsSelection;
use translation_desktop_lib::selected_text::{
    read_selected_text, SelectionMethod, SelectionPlatform,
};
use windows_sys::Win32::{
    Foundation::*,
    System::{
        LibraryLoader::GetModuleHandleW,
        Threading::{AttachThreadInput, GetCurrentThreadId},
    },
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

unsafe extern "system" fn source_proc(hwnd: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if message == WM_KEYUP && w == VK_CONTROL as usize {
        if std::env::var_os("POLYTRANSLATE_SYNTHETIC_SOURCE").is_some() {
            println!("SOURCE_CTRL_RELEASED");
        }
    }
    if message == WM_APP + 1 {
        let child = GetWindow(hwnd, GW_CHILD);
        if !child.is_null() {
            DestroyWindow(child);
        }
        SetFocus(hwnd);
        return 0;
    }
    if message == WM_KEYDOWN && w == 0x43 && GetKeyState(VK_CONTROL as i32) < 0 {
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            clipboard.set_text("copied synthetic 世界").unwrap();
        }
        return 0;
    }
    DefWindowProcW(hwnd, message, w, l)
}

#[test]
#[ignore = "requires an interactive Windows desktop; creates a synthetic source window"]
fn native_hooks_forward_injected_ctrl_without_triggering_translation_and_can_restart() {
    // The fixture runs in another process: the production own-process exclusion
    // cannot mask a broken injected-key filter in this test.
    if std::env::var_os("POLYTRANSLATE_SYNTHETIC_SOURCE").is_some() {
        let source = SourceWindow::open(false);
        println!("SOURCE_READY {}", source.hwnd);
        let mut command = String::new();
        std::io::stdin().read_line(&mut command).unwrap();
        return;
    }
    let source = ExternalSource::open();
    let mut clipboard = arboard::Clipboard::new().unwrap();
    for _ in 0..2 {
        clipboard.set_text("hook clipboard sentinel").unwrap();
        let (send, receive) = mpsc::channel();
        let runtime = WindowsInputRuntime::start(move |_, _| {
            let _ = send.send(());
        })
        .unwrap();
        assert_eq!(unsafe { GetForegroundWindow() } as isize, source.hwnd);
        let inputs: Vec<INPUT> = [0, KEYEVENTF_KEYUP]
            .into_iter()
            .map(|flags| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_CONTROL,
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            })
            .collect();
        unsafe {
            assert_eq!(
                SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32),
                2
            );
        }
        let release = source.events.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(release.contains("SOURCE_CTRL_RELEASED"));
        assert!(receive.recv_timeout(Duration::from_secs(2)).is_err());
        assert_eq!(clipboard.get_text().unwrap(), "hook clipboard sentinel");
        drop(runtime);
    }
}

struct ExternalSource {
    child: Child,
    hwnd: isize,
    events: mpsc::Receiver<String>,
}

impl ExternalSource {
    fn open() -> Self {
        use std::os::windows::process::CommandExt;
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "native_hooks_forward_injected_ctrl_without_triggering_translation_and_can_restart",
                "--nocapture",
            ])
            .env("POLYTRANSLATE_SYNTHETIC_SOURCE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW: no extra console.
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, events) = mpsc::channel();
        thread::spawn(move || {
            for line in std::io::BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
            {
                if line.contains("SOURCE_") {
                    let _ = send.send(line);
                }
            }
        });
        let ready = events.recv_timeout(Duration::from_secs(5)).unwrap();
        let hwnd = ready
            .split("SOURCE_READY ")
            .nth(1)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        Self {
            child,
            hwnd,
            events,
        }
    }
}

impl Drop for ExternalSource {
    fn drop(&mut self) {
        if let Some(stdin) = self.child.stdin.as_mut() {
            let _ = stdin.write_all(b"quit\n");
        }
        let _ = self.child.wait();
    }
}

struct SourceWindow {
    hwnd: isize,
    thread_id: u32,
    thread: Option<thread::JoinHandle<()>>,
}
impl SourceWindow {
    fn open(edit: bool) -> Self {
        let (ready, receiver) = mpsc::sync_channel(1);
        let thread = thread::spawn(move || unsafe {
            let class = wide("PolyTranslateSyntheticSource");
            let instance = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                lpfnWndProc: Some(source_proc),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                ..std::mem::zeroed()
            };
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                wide("PolyTranslate synthetic selection test").as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                40,
                40,
                500,
                180,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            assert!(!hwnd.is_null());
            let foreground_thread =
                GetWindowThreadProcessId(GetForegroundWindow(), std::ptr::null_mut());
            let attached = AttachThreadInput(GetCurrentThreadId(), foreground_thread, 1) != 0;
            SetForegroundWindow(hwnd);
            let focus = if edit {
                let field = CreateWindowExW(
                    0,
                    wide("EDIT").as_ptr(),
                    wide("x hello 世界").as_ptr(),
                    WS_CHILD | WS_VISIBLE | ES_MULTILINE as u32,
                    10,
                    10,
                    450,
                    80,
                    hwnd,
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                SetFocus(field);
                SendMessageW(field, 0x00B1 /* EM_SETSEL */, 2, 10);
                field
            } else {
                SetFocus(hwnd);
                hwnd
            };
            assert!(!focus.is_null());
            assert_eq!(
                GetForegroundWindow(),
                hwnd,
                "synthetic source must own foreground before acquisition"
            );
            assert_eq!(
                GetFocus(),
                focus,
                "synthetic source must own keyboard focus"
            );
            ready.send((GetCurrentThreadId(), hwnd as isize)).unwrap();
            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            if attached {
                AttachThreadInput(GetCurrentThreadId(), foreground_thread, 0);
            }
            DestroyWindow(hwnd);
            UnregisterClassW(class.as_ptr(), instance);
        });
        let (thread_id, hwnd) = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        Self {
            hwnd,
            thread_id,
            thread: Some(thread),
        }
    }
    fn copy_mode(&self) {
        unsafe {
            SendMessageW(self.hwnd as HWND, WM_APP + 1, 0, 0);
        }
    }
}
impl Drop for SourceWindow {
    fn drop(&mut self) {
        unsafe {
            PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
        }
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

#[test]
#[ignore = "requires an interactive Windows desktop; creates synthetic source windows"]
fn real_windows_selection_uses_uia_then_copy_without_reusing_stale_clipboard() {
    let mut clipboard = arboard::Clipboard::new().unwrap();
    clipboard.set_text("clipboard sentinel").unwrap();
    let source = SourceWindow::open(true);
    {
        let mut desktop = WindowsSelection::foreground().unwrap();
        let selected = read_selected_text(&mut desktop).unwrap();
        assert_eq!(
            (selected.text.as_str(), selected.method),
            ("hello 世界", SelectionMethod::Uia)
        );
        assert_eq!(clipboard.get_text().unwrap(), "clipboard sentinel");
    }
    source.copy_mode();
    {
        let mut desktop = WindowsSelection::foreground().unwrap();
        let selected = read_selected_text(&mut desktop).unwrap();
        assert_eq!(
            (selected.text.as_str(), selected.method),
            ("copied synthetic 世界", SelectionMethod::Clipboard)
        );
        assert_eq!(clipboard.get_text().unwrap(), "copied synthetic 世界");
        let mut repeated = WindowsSelection::foreground().unwrap();
        assert_eq!(
            read_selected_text(&mut repeated).unwrap().text,
            "copied synthetic 世界"
        );
    }
}

#[test]
#[ignore = "requires an interactive Windows desktop; creates a synthetic source window"]
fn native_copy_waits_for_the_ctrl_release_to_reach_windows() {
    let _source = SourceWindow::open(false);
    let mut desktop = WindowsSelection::foreground().unwrap();
    unsafe {
        send_ctrl(0);
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(1);
    while unsafe { GetAsyncKeyState(VK_CONTROL as i32) } >= 0
        && std::time::Instant::now() < deadline
    {
        thread::sleep(Duration::from_millis(1));
    }
    let releasing = thread::spawn(|| {
        thread::sleep(Duration::from_millis(20));
        unsafe {
            send_ctrl(KEYEVENTF_KEYUP);
        }
    });
    let copied = desktop.send_copy();
    releasing.join().unwrap();
    assert_eq!(copied, Ok(()));
}

unsafe fn send_ctrl(flags: u32) {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_CONTROL,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    assert_eq!(SendInput(1, &input, std::mem::size_of::<INPUT>() as i32), 1);
}
