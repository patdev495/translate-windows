//! Windows adapters. COM stays on one bounded worker; input is never blocked by UIA.
use super::{
    apply_input_translation, read_automatic_selected_text, read_selected_text,
    DesktopTranslationInput, ReplacementOutcome, ReplacementPlatform, SelectedText, SelectionError,
    SelectionPlatform, TranslationAction,
};
use ::windows::Win32::{Foundation::HWND as ComHwnd, System::Com::*, UI::Accessibility::*};
use std::{
    cell::RefCell,
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    System::{
        LibraryLoader::GetModuleHandleW,
        Threading::{GetCurrentProcessId, GetCurrentThreadId},
    },
};
use windows_sys::Win32::{
    System::DataExchange::GetClipboardSequenceNumber,
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

const UIA_WAIT: Duration = Duration::from_millis(750);
const COPY_TAG: usize = 0x5054_4350;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Source {
    hwnd: isize,
    pid: u32,
}

fn foreground_source() -> Result<Source, SelectionError> {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if hwnd.is_null() || pid == 0 {
            Err(SelectionError::SourceChanged)
        } else {
            Ok(Source {
                hwnd: hwnd as isize,
                pid,
            })
        }
    }
}

enum UiaJob {
    Read {
        source: Source,
        response: mpsc::Sender<Option<String>>,
    },
    Capture {
        source: Source,
        response: mpsc::Sender<Option<(String, String)>>,
    },
    Replace {
        token: String,
        text: String,
        guard: DeliveryContext,
        permit: Arc<AtomicBool>,
        response: mpsc::Sender<bool>,
    },
}
struct EditSnapshot {
    token: String,
    element: IUIAutomationElement,
    range: IUIAutomationTextRange,
    text: String,
    source: Source,
}
struct UiaClient {
    sender: mpsc::SyncSender<UiaJob>,
    busy: Arc<AtomicBool>,
}

unsafe fn editable_snapshot(
    api: &IUIAutomation2,
    source: Source,
    token: String,
) -> Option<EditSnapshot> {
    if foreground_source().ok() != Some(source) {
        return None;
    }
    let element = api.GetFocusedElement().ok()?;
    if element.CurrentProcessId().ok()? != source.pid as i32
        || element.CurrentIsPassword().ok()?.as_bool()
        || !element.CurrentIsEnabled().ok()?.as_bool()
    {
        return None;
    }
    let pattern: IUIAutomationTextPattern = element.GetCurrentPatternAs(UIA_TextPatternId).ok()?;
    let selections = pattern.GetSelection().ok()?;
    if selections.Length().ok()? != 1 {
        return None;
    }
    let range = selections.GetElement(0).ok()?;
    let text = range.GetText(-1).ok()?.to_string();
    if text.trim().is_empty() {
        return None;
    }
    let writable_value = element
        .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
        .ok()
        .and_then(|value| value.CurrentIsReadOnly().ok())
        .is_some_and(|readonly| !readonly.as_bool());
    let writable_text = range
        .GetAttributeValue(UIA_IsReadOnlyAttributeId)
        .ok()
        .and_then(|value| bool::try_from(&value).ok())
        .is_some_and(|readonly| !readonly);
    if !writable_value && !writable_text {
        return None;
    }
    Some(EditSnapshot {
        token,
        element,
        range,
        text,
        source,
    })
}

unsafe fn replace_snapshot(
    api: &IUIAutomation2,
    snapshot: EditSnapshot,
    text: &str,
    guard: &DeliveryContext,
    permit: &AtomicBool,
) -> bool {
    if !guard.is_current() || foreground_source().ok() != Some(snapshot.source) {
        return false;
    }
    let Ok(focused) = api.GetFocusedElement() else {
        return false;
    };
    if !api
        .CompareElements(&snapshot.element, &focused)
        .map(|same| same.as_bool())
        .unwrap_or(false)
    {
        return false;
    }
    let Ok(pattern) = focused.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
    else {
        return false;
    };
    let Ok(ranges) = pattern.GetSelection() else {
        return false;
    };
    if ranges.Length().ok() != Some(1) {
        return false;
    }
    let Ok(current) = ranges.GetElement(0) else {
        return false;
    };
    if current
        .GetText(-1)
        .ok()
        .map(|value| value.to_string())
        .as_deref()
        != Some(&snapshot.text)
        || current
            .CompareEndpoints(
                TextPatternRangeEndpoint_Start,
                &snapshot.range,
                TextPatternRangeEndpoint_Start,
            )
            .ok()
            != Some(0)
        || current
            .CompareEndpoints(
                TextPatternRangeEndpoint_End,
                &snapshot.range,
                TextPatternRangeEndpoint_End,
            )
            .ok()
            != Some(0)
    {
        return false;
    }
    if !guard.is_current() || !permit.load(Ordering::Acquire) {
        return false;
    }
    let Ok(mut clipboard) = arboard::Clipboard::new() else {
        return false;
    };
    if clipboard.set_text(text).is_err() {
        return false;
    }
    if !guard.is_current() || !permit.load(Ordering::Acquire) {
        return false;
    }
    if [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
        .iter()
        .any(|key| GetAsyncKeyState(*key as i32) < 0)
    {
        return false;
    }
    let keys = [
        (VK_CONTROL, 0),
        (0x56, 0),
        (0x56, KEYEVENTF_KEYUP),
        (VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let events: Vec<INPUT> = keys
        .into_iter()
        .map(|(key, flags)| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: COPY_TAG,
                },
            },
        })
        .collect();
    SendInput(
        events.len() as u32,
        events.as_ptr(),
        std::mem::size_of::<INPUT>() as i32,
    ) == events.len() as u32
}

impl UiaClient {
    fn new() -> Self {
        let (sender, receiver) = mpsc::sync_channel::<UiaJob>(1);
        let busy = Arc::new(AtomicBool::new(false));
        let worker_busy = busy.clone();
        let _ =
            thread::Builder::new()
                .name("selected-text-uia".into())
                .spawn(move || unsafe {
                    if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
                        return;
                    }
                    let automation: Option<IUIAutomation2> =
                        CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).ok();
                    if let Some(api) = &automation {
                        let _ = api.SetAutoSetFocus(false);
                        let _ = api.SetConnectionTimeout(200);
                        let _ = api.SetTransactionTimeout(200);
                    }
                    let mut snapshot: Option<EditSnapshot> = None;
                    let mut counter = 0u64;
                    while let Ok(job) = receiver.recv() {
                        match job {
                            UiaJob::Read { source, response } => {
                                let text = automation
                                    .as_ref()
                                    .and_then(|api| uia_selection(api, source));
                                worker_busy.store(false, Ordering::Release);
                                let _ = response.send(text);
                            }
                            UiaJob::Capture { source, response } => {
                                counter += 1;
                                snapshot = automation.as_ref().and_then(|api| {
                                    editable_snapshot(api, source, counter.to_string())
                                });
                                let result = snapshot.as_ref().map(|snapshot| {
                                    (snapshot.token.clone(), snapshot.text.clone())
                                });
                                worker_busy.store(false, Ordering::Release);
                                let _ = response.send(result);
                            }
                            UiaJob::Replace {
                                token,
                                text,
                                guard,
                                permit,
                                response,
                            } => {
                                let captured =
                                    snapshot.take().filter(|snapshot| snapshot.token == token);
                                let result = automation.as_ref().zip(captured).is_some_and(
                                    |(api, snapshot)| {
                                        replace_snapshot(api, snapshot, &text, &guard, &permit)
                                    },
                                );
                                worker_busy.store(false, Ordering::Release);
                                let _ = response.send(result);
                            }
                        }
                    }
                    drop(snapshot);
                    drop(automation);
                    CoUninitialize();
                });
        Self { sender, busy }
    }
    fn reserve(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
    fn read(&self, source: Source) -> Option<String> {
        if !self.reserve() {
            return None;
        }
        let (response, receiver) = mpsc::channel();
        if self
            .sender
            .try_send(UiaJob::Read { source, response })
            .is_err()
        {
            self.busy.store(false, Ordering::Release);
            return None;
        }
        receiver.recv_timeout(UIA_WAIT).ok().flatten()
    }
    fn capture(&self, source: Source) -> Option<(String, String)> {
        if !self.reserve() {
            return None;
        }
        let (response, receiver) = mpsc::channel();
        if self
            .sender
            .try_send(UiaJob::Capture { source, response })
            .is_err()
        {
            self.busy.store(false, Ordering::Release);
            return None;
        }
        receiver.recv_timeout(UIA_WAIT).ok().flatten()
    }
    fn replace(&self, token: String, text: String, guard: DeliveryContext) -> bool {
        if !self.reserve() {
            return false;
        }
        let permit = Arc::new(AtomicBool::new(true));
        let (response, receiver) = mpsc::channel();
        if self
            .sender
            .try_send(UiaJob::Replace {
                token,
                text,
                guard,
                permit: permit.clone(),
                response,
            })
            .is_err()
        {
            self.busy.store(false, Ordering::Release);
            return false;
        }
        let result = receiver.recv_timeout(UIA_WAIT).unwrap_or(false);
        permit.store(false, Ordering::Release);
        result
    }
}

unsafe fn range_text(element: &IUIAutomationElement, deadline: Instant) -> Option<String> {
    if element
        .CurrentIsPassword()
        .map(|value| value.as_bool())
        .unwrap_or(true)
    {
        return None;
    }
    let pattern: IUIAutomationTextPattern = element.GetCurrentPatternAs(UIA_TextPatternId).ok()?;
    let ranges = pattern.GetSelection().ok()?;
    let count = ranges.Length().ok()?;
    let mut spans = Vec::new();
    for i in 0..count {
        if Instant::now() >= deadline {
            return None;
        }
        let text = ranges.GetElement(i).ok()?.GetText(-1).ok()?.to_string();
        if !text.trim().is_empty() {
            spans.push(text);
        }
    }
    if spans.is_empty() {
        None
    } else {
        Some(spans.join("\n"))
    }
}

unsafe fn uia_selection(api: &IUIAutomation2, source: Source) -> Option<String> {
    if foreground_source().ok() != Some(source) {
        return None;
    }
    let deadline = Instant::now() + UIA_WAIT;
    let root = api.ElementFromHandle(ComHwnd(source.hwnd as *mut _)).ok()?;
    let walker = api.ControlViewWalker().ok()?;
    // Focus often belongs to an editor's child; walk toward its document first.
    if let Ok(mut element) = api.GetFocusedElement() {
        for _ in 0..12 {
            if Instant::now() >= deadline || foreground_source().ok() != Some(source) {
                return None;
            }
            if element.CurrentProcessId().ok() != Some(source.pid as i32) {
                break;
            }
            if let Some(text) = range_text(&element, deadline) {
                return Some(text);
            }
            if api
                .CompareElements(&element, &root)
                .map(|same| same.as_bool())
                .unwrap_or(false)
            {
                break;
            }
            match walker.GetParentElement(&element) {
                Ok(parent) => element = parent,
                Err(_) => break,
            }
        }
    }
    // Some applications keep focus outside the selected document. Restrict the
    // fallback traversal to this foreground window, with a node/time budget.
    let mut queue = VecDeque::from([root]);
    let mut budget = 48;
    while let Some(element) = queue.pop_front() {
        if budget == 0 || Instant::now() >= deadline || foreground_source().ok() != Some(source) {
            break;
        }
        budget -= 1;
        if let Some(text) = range_text(&element, deadline) {
            return Some(text);
        }
        if let Ok(mut child) = walker.GetFirstChildElement(&element) {
            loop {
                if queue.len() >= budget || Instant::now() >= deadline {
                    break;
                }
                queue.push_back(child.clone());
                match walker.GetNextSiblingElement(&child) {
                    Ok(next) => child = next,
                    Err(_) => break,
                }
            }
        }
    }
    None
}

pub struct WindowsSelection {
    source: Source,
    uia: Arc<UiaClient>,
    started: Instant,
    guard: Option<DeliveryContext>,
}

impl WindowsSelection {
    /// Captures the foreground identity; subsequent focus changes invalidate it.
    pub fn foreground() -> Result<Self, SelectionError> {
        Ok(Self {
            source: foreground_source()?,
            uia: Arc::new(UiaClient::new()),
            started: Instant::now(),
            guard: None,
        })
    }
}

impl SelectionPlatform for WindowsSelection {
    fn source_is_current(&self) -> bool {
        foreground_source().ok() == Some(self.source)
            && self
                .guard
                .as_ref()
                .map(|guard| guard.is_current())
                .unwrap_or(true)
    }
    fn uia_text(&mut self) -> Result<Option<String>, SelectionError> {
        Ok(self.uia.read(self.source))
    }
    fn clipboard_sequence(&self) -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }
    fn send_copy(&mut self) -> Result<(), SelectionError> {
        if !self.source_is_current() {
            return Err(SelectionError::SourceChanged);
        }
        unsafe {
            // A low-level key-up notification arrives before Windows updates
            // asynchronous key state. Wait briefly; never release a held modifier.
            let release_deadline = Instant::now() + Duration::from_millis(50);
            loop {
                if !self.source_is_current() {
                    return Err(SelectionError::SourceChanged);
                }
                if ![VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
                    .iter()
                    .any(|key| GetAsyncKeyState(*key as i32) < 0)
                {
                    break;
                }
                if Instant::now() >= release_deadline {
                    return Err(SelectionError::SourceChanged);
                }
                self.pause();
            }
            let keys = [
                (VK_CONTROL, 0),
                (0x43, 0),
                (0x43, KEYEVENTF_KEYUP),
                (VK_CONTROL, KEYEVENTF_KEYUP),
            ];
            let inputs: Vec<INPUT> = keys
                .into_iter()
                .map(|(key, flags)| INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: key,
                            wScan: 0,
                            dwFlags: flags,
                            time: 0,
                            dwExtraInfo: COPY_TAG,
                        },
                    },
                })
                .collect();
            if SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            ) != inputs.len() as u32
            {
                return Err(SelectionError::NoText);
            }
        }
        Ok(())
    }
    fn clipboard_text(&mut self) -> Option<String> {
        arboard::Clipboard::new().ok()?.get_text().ok()
    }
    fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
    fn pause(&mut self) {
        thread::sleep(Duration::from_millis(10));
    }
}

/// Rechecked on the UI thread before publishing a worker result.
#[derive(Clone)]
pub struct DeliveryContext {
    pub action: TranslationAction,
    edit_token: Option<String>,
    edit_host: Option<Arc<UiaClient>>,
    pub x: i32,
    pub y: i32,
    source: Source,
    activity: Arc<AtomicU64>,
    epoch: u64,
    stopped: Arc<AtomicBool>,
}

impl DeliveryContext {
    pub fn apply_translation(&self, translation: &str) -> ReplacementOutcome {
        struct Pending<'a>(&'a DeliveryContext);
        impl ReplacementPlatform for Pending<'_> {
            fn selection_is_current(&self) -> bool {
                self.0.is_current()
            }
            fn replace_selection(&mut self, translation: &str) -> Result<(), String> {
                let applied = self
                    .0
                    .edit_host
                    .as_ref()
                    .zip(self.0.edit_token.as_ref())
                    .is_some_and(|(host, token)| {
                        host.replace(token.clone(), translation.into(), self.0.clone())
                    });
                if applied {
                    Ok(())
                } else {
                    Err("Cannot replace selection".into())
                }
            }
        }
        apply_input_translation(&mut Pending(self), translation)
    }

    pub fn is_current(&self) -> bool {
        !self.stopped.load(Ordering::Acquire)
            && self.activity.load(Ordering::Acquire) == self.epoch
            && foreground_source().ok() == Some(self.source)
    }
}

#[derive(Clone)]
pub struct InputSettings {
    pub tooltip: String,
    pub replacement: String,
    pub automatic: bool,
    pub active: bool,
}

struct HookContext {
    trigger: DesktopTranslationInput,
    applied: (String, String),
    settings: Arc<Mutex<InputSettings>>,
    sender: mpsc::SyncSender<DeliveryContext>,
    activity: Arc<AtomicU64>,
    active: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
}
thread_local! { static HOOK: RefCell<Option<HookContext>> = const { RefCell::new(None) }; }

unsafe fn enqueue(context: &mut HookContext, action: TranslationAction) {
    if context.stopped.load(Ordering::Acquire) {
        return;
    }
    if let Ok(source) = foreground_source() {
        if source.pid == GetCurrentProcessId() {
            return;
        }
        if context
            .active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let mut point: POINT = std::mem::zeroed();
        GetCursorPos(&mut point);
        let delivery = DeliveryContext {
            action,
            edit_token: None,
            edit_host: None,
            x: point.x,
            y: point.y,
            source,
            activity: context.activity.clone(),
            epoch: context.activity.load(Ordering::Acquire),
            stopped: context.stopped.clone(),
        };
        if context.sender.try_send(delivery).is_err() {
            context.active.store(false, Ordering::Release);
        }
    }
}

unsafe extern "system" fn keyboard_hook(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let input = &*(data as *const KBDLLHOOKSTRUCT);
        if input.flags & LLKHF_INJECTED == 0 {
            HOOK.with(|slot| {
                if let Some(context) = slot.borrow_mut().as_mut() {
                    let pressed = match message as u32 {
                        WM_KEYDOWN | WM_SYSKEYDOWN => true,
                        WM_KEYUP | WM_SYSKEYUP => false,
                        _ => return,
                    };
                    context.activity.fetch_add(1, Ordering::AcqRel);
                    let settings = context.settings.lock().unwrap().clone();
                    if context.applied != (settings.tooltip.clone(), settings.replacement.clone()) {
                        if context
                            .trigger
                            .configure(&settings.tooltip, &settings.replacement)
                            .is_err()
                        {
                            return;
                        }
                        context.applied = (settings.tooltip, settings.replacement);
                    }
                    let request = context.trigger.keyboard(input.vkCode, pressed);
                    if !settings.active {
                        context.trigger.pointer_activity();
                        return;
                    }
                    if let Some(action) = request {
                        enqueue(context, action);
                    }
                }
            });
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, message, data)
}

unsafe extern "system" fn mouse_hook(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32
        && matches!(
            message as u32,
            WM_LBUTTONDOWN
                | WM_LBUTTONUP
                | WM_RBUTTONDOWN
                | WM_RBUTTONUP
                | WM_MBUTTONDOWN
                | WM_MBUTTONUP
                | WM_XBUTTONDOWN
                | WM_XBUTTONUP
                | WM_MOUSEWHEEL
                | WM_MOUSEHWHEEL
        )
    {
        let input = &*(data as *const MSLLHOOKSTRUCT);
        if input.flags & LLMHF_INJECTED == 0 {
            HOOK.with(|slot| {
                if let Some(context) = slot.borrow_mut().as_mut() {
                    context.activity.fetch_add(1, Ordering::AcqRel);
                    context.trigger.pointer_activity();
                    let settings = context.settings.lock().unwrap().clone();
                    if matches!(message as u32, WM_LBUTTONUP | WM_RBUTTONUP | WM_MBUTTONUP) {
                        enqueue(
                            context,
                            if message as u32 == WM_LBUTTONUP
                                && settings.active
                                && settings.automatic
                            {
                                TranslationAction::Automatic
                            } else {
                                TranslationAction::Dismiss
                            },
                        );
                    }
                }
            });
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, message, data)
}

pub struct WindowsInputRuntime {
    settings: Arc<Mutex<InputSettings>>,
    stopped: Arc<AtomicBool>,
    hook_thread_id: u32,
    hook_thread: Option<thread::JoinHandle<()>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl WindowsInputRuntime {
    /// Compatibility entrypoint for the existing native hook smoke tests.
    pub fn start(
        deliver: impl Fn(Result<SelectedText, SelectionError>, DeliveryContext) + Send + 'static,
    ) -> Result<Self, String> {
        Self::start_with_settings(
            InputSettings {
                tooltip: "ControlLeft".into(),
                replacement: "disabled".into(),
                automatic: false,
                active: true,
            },
            deliver,
        )
    }
    pub fn configure(&self, settings: InputSettings) -> Result<(), String> {
        DesktopTranslationInput::new(&settings.tooltip, &settings.replacement)?;
        *self
            .settings
            .lock()
            .map_err(|_| "Input settings are busy")? = settings;
        Ok(())
    }
    pub fn start_with_settings(
        settings: InputSettings,
        deliver: impl Fn(Result<SelectedText, SelectionError>, DeliveryContext) + Send + 'static,
    ) -> Result<Self, String> {
        let mut trigger = DesktopTranslationInput::new(&settings.tooltip, &settings.replacement)?;
        let applied = (settings.tooltip.clone(), settings.replacement.clone());
        let settings = Arc::new(Mutex::new(settings));
        let hook_settings = settings.clone();
        let stopped = Arc::new(AtomicBool::new(false));
        let activity = Arc::new(AtomicU64::new(0));
        let active = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::sync_channel::<DeliveryContext>(1);
        let worker_active = active.clone();
        let worker = thread::Builder::new()
            .name("selected-text-reader".into())
            .spawn(move || {
                let uia = Arc::new(UiaClient::new());
                let mut previous: Option<(Source, String, Instant)> = None;
                while let Ok(mut context) = receiver.recv() {
                    if context.action == TranslationAction::Automatic {
                        thread::sleep(Duration::from_millis(60));
                    }
                    if context.is_current() {
                        if context.action == TranslationAction::Dismiss {
                            deliver(Err(SelectionError::NoText), context);
                            worker_active.store(false, Ordering::Release);
                            continue;
                        }
                        let mut platform = WindowsSelection {
                            source: context.source,
                            uia: uia.clone(),
                            started: Instant::now(),
                            guard: Some(context.clone()),
                        };
                        let result = match context.action {
                            TranslationAction::Tooltip => read_selected_text(&mut platform),
                            TranslationAction::Replace => {
                                if let Some((token, text)) = uia.capture(context.source) {
                                    context.edit_token = Some(token);
                                    context.edit_host = Some(uia.clone());
                                    Ok(SelectedText {
                                        text,
                                        method: super::SelectionMethod::Uia,
                                    })
                                } else {
                                    read_automatic_selected_text(&mut platform)
                                }
                            }
                            _ => read_automatic_selected_text(&mut platform),
                        };
                        let automatic = context.action == TranslationAction::Automatic;
                        if automatic && result.is_err() && context.is_current() {
                            let mut dismissal = context.clone();
                            dismissal.action = TranslationAction::Dismiss;
                            deliver(Err(SelectionError::NoText), dismissal);
                        }
                        let duplicate = automatic
                            && result.as_ref().ok().is_some_and(|result| {
                                previous.as_ref().is_some_and(|(source, text, at)| {
                                    *source == context.source
                                        && *text == result.text
                                        && at.elapsed() < Duration::from_millis(800)
                                })
                            });
                        if context.is_current() && !duplicate && (!automatic || result.is_ok()) {
                            if let Ok(result) = &result {
                                previous =
                                    Some((context.source, result.text.clone(), Instant::now()));
                            }
                            deliver(result, context);
                        }
                    }
                    worker_active.store(false, Ordering::Release);
                }
            })
            .map_err(|e| e.to_string())?;
        let thread_stop = stopped.clone();
        let (ready, receive_ready) = mpsc::sync_channel(1);
        let hook_thread = thread::Builder::new()
            .name("selected-text-input".into())
            .spawn(move || unsafe {
                for code in 8..=254 {
                    if ![16, 17, 18].contains(&code) && GetAsyncKeyState(code) < 0 {
                        trigger.keyboard(code as u32, true);
                    }
                }
                trigger.pointer_activity();
                HOOK.with(|slot| {
                    *slot.borrow_mut() = Some(HookContext {
                        trigger,
                        applied,
                        settings: hook_settings,
                        sender,
                        activity,
                        active,
                        stopped: thread_stop,
                    })
                });
                let module = GetModuleHandleW(std::ptr::null());
                let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), module, 0);
                let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), module, 0);
                if keyboard.is_null() || mouse.is_null() {
                    let _ = ready.send(Err("Cannot install translation input hooks".to_string()));
                } else {
                    let mut message: MSG = std::mem::zeroed();
                    PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
                    let _ = ready.send(Ok(GetCurrentThreadId()));
                    while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                if !keyboard.is_null() {
                    UnhookWindowsHookEx(keyboard);
                }
                if !mouse.is_null() {
                    UnhookWindowsHookEx(mouse);
                }
                HOOK.with(|slot| *slot.borrow_mut() = None);
            })
            .map_err(|e| e.to_string())?;
        match receive_ready.recv() {
            Ok(Ok(hook_thread_id)) => Ok(Self {
                settings,
                stopped,
                hook_thread_id,
                hook_thread: Some(hook_thread),
                worker: Some(worker),
            }),
            failure => {
                stopped.store(true, Ordering::Release);
                let _ = hook_thread.join();
                let _ = worker.join();
                Err(format!("Cannot start translation input hooks: {failure:?}"))
            }
        }
    }
}

impl Drop for WindowsInputRuntime {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        unsafe {
            PostThreadMessageW(self.hook_thread_id, WM_QUIT, 0, 0);
        }
        if let Some(thread) = self.hook_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.worker.take() {
            let _ = thread.join();
        }
    }
}
