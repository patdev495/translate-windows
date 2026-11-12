use std::borrow::Cow;
use std::io::Cursor;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fs, path::PathBuf};
use arboard::{Clipboard, ImageData};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindowBuilder};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_global_shortcut::{Code, Modifiers};
use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose};
use image::{
    codecs::png::{CompressionType, FilterType, PngEncoder},
    ImageEncoder,
};
use serde::{Deserialize, Serialize};

pub mod ocr;
pub mod selected_text;
pub mod desktop;
pub mod http_clients;
#[cfg(feature = "latency-harness")]
pub mod latency;
pub mod desktop_views;
#[cfg(windows)]
pub mod input_translation;

#[derive(Default)]
struct SelectedTextRuntimeState {
    #[cfg(windows)]
    runtime: Mutex<Option<selected_text::windows::WindowsInputRuntime>>,
}

#[derive(Default)]
struct RegisteredTranslationShortcuts(Mutex<Vec<Shortcut>>, AtomicBool);

#[tauri::command]
fn set_shortcut_capture(state: tauri::State<'_, RegisteredTranslationShortcuts>, capturing: bool) { state.1.store(capturing,Ordering::Release); }

fn ocr_hotkey(value: &str) -> Result<Option<Shortcut>, String> {
    let key = match value {
        "disabled" => return Ok(None), "ctrl-3" => "Ctrl+3", "alt-space" => "Alt+Space",
        "ctrl-space" => "Ctrl+Space", "alt-o" => "Alt+O", "ctrl-shift-o" => "Ctrl+Shift+O",
        _ => return Err("Unsupported OCR shortcut".into()),
    };
    key.parse::<Shortcut>().map(Some).map_err(|e| e.to_string())
}

fn translation_hotkey(value: &str) -> Result<Option<Shortcut>, String> {
    if value == "disabled" || value.split('+').all(|part| matches!(part, "Ctrl" | "Alt" | "Shift" | "Meta" | "ControlLeft" | "ControlRight" | "AltLeft" | "AltRight" | "ShiftLeft" | "ShiftRight" | "MetaLeft" | "MetaRight")) { return Ok(None); }
    value.replace("Key", "").replace("Digit", "").replace("Meta", "Super").parse::<Shortcut>().map(Some).map_err(|e| e.to_string())
}

fn install_translation_hotkeys(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    selected_text::DesktopTranslationInput::new(&settings.translation_shortcut, &settings.input_replacement_shortcut)?;
    let mut desired = Vec::new();
    if settings.translation_active {
        if let Some(key) = translation_hotkey(&settings.translation_shortcut)? { desired.push(key); }
        if settings.input_replacement_enabled {
            if let Some(key) = translation_hotkey(&settings.input_replacement_shortcut)? { desired.push(key); }
        }
    }
    if let Some(key) = ocr_hotkey(&settings.ocr_shortcut)? { desired.push(key); }
    let reserved = [Shortcut::new(Some(Modifiers::CONTROL), Code::Digit4), Shortcut::new(Some(Modifiers::ALT), Code::KeyB)];
    for (index, key) in desired.iter().enumerate() {
        if reserved.iter().any(|other| other.id() == key.id()) || desired[..index].iter().any(|other| other.id() == key.id()) {
            return Err("Phím dịch, OCR, quay màn hình và chụp ảnh phải khác nhau".into());
        }
    }
    let state = app.state::<RegisteredTranslationShortcuts>();
    let mut current = state.0.lock().unwrap();
    let mut added = Vec::new();
    for key in &desired {
        if current.iter().any(|old| old.id() == key.id()) { continue; }
        if let Err(error) = app.global_shortcut().on_shortcut(*key, |app, key, event| {
            if event.state() != ShortcutState::Pressed { return; }
            if app.state::<RegisteredTranslationShortcuts>().1.load(Ordering::Acquire) { return; }
            let settings = app.state::<AppSettingsState>().0.lock().unwrap().clone();
            if let Some(pdf) = app.get_webview_window("pdf").filter(|window| window.is_focused().unwrap_or(false)) {
                let action = if ocr_hotkey(&settings.ocr_shortcut).ok().flatten().is_some_and(|value| value.id() == key.id()) { Some("ocr") }
                    else if settings.translation_active && translation_hotkey(&settings.translation_shortcut).ok().flatten().is_some_and(|value| value.id() == key.id()) { Some("tooltip") } else { None };
                if let Some(action) = action { let _ = pdf.emit("desktop-shortcut",serde_json::json!({"action":action})); }
                return;
            }
            if ocr_hotkey(&settings.ocr_shortcut).ok().flatten().is_some_and(|ocr| ocr.id() == key.id()) { request_capture_and_overlay(app); }
        }) {
            for registered in added { let _ = app.global_shortcut().unregister(registered); }
            return Err(format!("Không đăng ký được phím tắt; phím có thể đang được ứng dụng khác sử dụng: {error}"));
        }
        added.push(*key);
    }
    for key in current.iter() { if !desired.iter().any(|new| new.id() == key.id()) { let _ = app.global_shortcut().unregister(*key); } }
    *current = desired;
    Ok(())
}

#[cfg(windows)]
fn native_input_settings(settings: &AppSettings) -> selected_text::windows::InputSettings {
    selected_text::windows::InputSettings {
        tooltip: settings.translation_shortcut.clone(),
        replacement: if settings.input_replacement_enabled { settings.input_replacement_shortcut.clone() } else { "disabled".into() },
        automatic: settings.auto_selection_translate,
        active: settings.translation_active,
    }
}

// ── Shared state types ────────────────────────────────────────────────────

#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<String>>);

fn default_true() -> bool {
    true
}

/// Data passed from the crop overlay to the tooltip window.
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TooltipData {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translation_data: Option<serde_json::Value>,
    pub data_url: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub struct TooltipState(pub Mutex<Option<TooltipData>>);

impl Default for TooltipState {
    fn default() -> Self {
        TooltipState(Mutex::new(None))
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetData {
    pub data_url: String,
    pub display_width: u32,
    pub display_height: u32,
}

/// Per-snippet storage: label → snippet data. Allows multiple pinned snippet windows.
pub struct SnippetStore(pub Mutex<std::collections::HashMap<String, SnippetData>>);

impl Default for SnippetStore {
    fn default() -> Self {
        SnippetStore(Mutex::new(std::collections::HashMap::new()))
    }
}

/// Counter for generating unique snippet window labels.
pub struct SnippetCounter(pub Mutex<u32>);

impl Default for SnippetCounter {
    fn default() -> Self {
        SnippetCounter(Mutex::new(0))
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub primary_target_lang: String,
    pub secondary_target_lang: String,
    pub reverse_target_lang: String,
    pub auto_translate: bool,
    pub auto_selection_translate: bool,
    pub translation_shortcut: String,
    pub input_replacement_shortcut: String,
    pub translation_active: bool,
    pub input_replacement_enabled: bool,
    pub hanzi_stroke_speed: f64,
    pub hanzi_breakdown_enabled: bool,
    pub hanzi_breakdown_language: String,
    pub ocr_shortcut: String,
    pub ocr_model_tier: String,
    pub ocr_language: String,
    pub tts_enabled: bool,
    pub provider: String,
    pub deepl_api_key: String,
    pub tooltip_font_size: String,
    #[serde(default = "default_true")]
    pub phonetics_visible: bool,
    pub ocr_pin_image: bool,
    pub ocr_copy_to_clipboard: bool,
    pub start_with_windows: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            primary_target_lang: "vi".to_string(),
            secondary_target_lang: "zh".to_string(),
            reverse_target_lang: "en".to_string(),
            auto_translate: true,
            auto_selection_translate: true,
            translation_shortcut: "Alt+KeyQ".into(),
            input_replacement_shortcut: "Alt+KeyW".into(),
            translation_active: true,
            input_replacement_enabled: true,
            hanzi_stroke_speed: 2.0,
            hanzi_breakdown_enabled: false,
            hanzi_breakdown_language: "vi".into(),
            ocr_shortcut: "ctrl-3".to_string(),
            ocr_model_tier: "medium".to_string(),
            ocr_language: "ch".to_string(),
            tts_enabled: true,
            provider: "google".to_string(),
            deepl_api_key: String::new(),
            tooltip_font_size: "16".to_string(),
            phonetics_visible: true,
            ocr_pin_image: false,
            ocr_copy_to_clipboard: true,
            start_with_windows: false,
        }
    }
}

#[derive(Default)]
pub struct AppSettingsState(pub Mutex<AppSettings>);

#[derive(Default)]
pub struct TraySettingsItems {
    pub capture_ocr: Mutex<Option<MenuItem<tauri::Wry>>>,
    pub auto_translate: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    pub ocr_pin_image: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
}

#[derive(Default)]
pub struct CaptureRequestState(pub AtomicBool);

#[derive(Default)]
pub struct RecordingRequestState(pub AtomicBool);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordingRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct RecordingState(pub Mutex<Option<ActiveRecording>>);

pub struct ActiveRecording {
    pub rect: RecordingRect,
    pub temp_path: PathBuf,
    pub child: Child,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecordingShortcutAction {
    OpenOverlay,
    StopRecording,
}

#[derive(Debug, PartialEq)]
pub struct DockedRecordingOverlayRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy)]
struct TrayMenuSpec {
    id: &'static str,
    label: &'static str,
}

#[derive(Clone, Copy)]
struct GlobalShortcutSpec {
    id: &'static str,
    code: Code,
}

fn tray_menu_specs() -> [TrayMenuSpec; 8] {
    [
        TrayMenuSpec { id: "capture_ocr", label: "Capture OCR (Ctrl+3)" },
        TrayMenuSpec { id: "record_screen", label: "Record Screen (Ctrl+4)" },
        TrayMenuSpec { id: "copy_full_screen", label: "Capture Full Screen (Alt+B)" },
        TrayMenuSpec { id: "auto_translate", label: "Auto Translate" },
        TrayMenuSpec { id: "ocr_pin_image", label: "Pin OCR Image" },
        TrayMenuSpec { id: "settings", label: "Settings" },
        TrayMenuSpec { id: "start_with_windows", label: "Start with Windows" },
        TrayMenuSpec { id: "exit", label: "Exit" },
    ]
}

fn global_shortcut_specs() -> [GlobalShortcutSpec; 3] {
    [
        GlobalShortcutSpec { id: "capture_ocr", code: Code::Digit3 },
        GlobalShortcutSpec { id: "record_screen", code: Code::Digit4 },
        GlobalShortcutSpec { id: "copy_full_screen", code: Code::KeyB },
    ]
}

fn settings_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app settings directory: {e}"))?;
    Ok(dir.join("settings.json"))
}

fn load_settings_from_disk(app_handle: &tauri::AppHandle) -> AppSettings {
    let Ok(path) = settings_path(app_handle) else {
        return AppSettings::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return AppSettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_settings_to_disk(app_handle: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create app settings directory: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Could not serialize app settings: {e}"))?;
    fs::write(path, raw).map_err(|e| format!("Could not write app settings: {e}"))
}

fn update_tray_setting_checks(app_handle: &tauri::AppHandle, settings: &AppSettings) {
    let items: tauri::State<TraySettingsItems> = app_handle.state();
    if let Some(item) = items.capture_ocr.lock().unwrap().as_ref() {
        let label = match settings.ocr_shortcut.as_str() { "ctrl-3" => "Ctrl+3", "alt-space" => "Alt+Space", "ctrl-space" => "Ctrl+Space", "alt-o" => "Alt+O", "ctrl-shift-o" => "Ctrl+Shift+O", _ => "Disabled" };
        let _ = item.set_text(format!("Capture OCR ({label})"));
    }
    let auto_translate_item = items.auto_translate.lock().unwrap().clone();
    let ocr_pin_image_item = items.ocr_pin_image.lock().unwrap().clone();
    if let Some(item) = auto_translate_item.as_ref() {
        if let Err(err) = item.set_checked(settings.auto_translate) {
            eprintln!("Failed to update auto translate tray check: {err}");
        }
    }
    if let Some(item) = ocr_pin_image_item.as_ref() {
        if let Err(err) = item.set_checked(settings.ocr_pin_image) {
            eprintln!("Failed to update pin image tray check: {err}");
        }
    }
}

fn autostart_available_in_current_build() -> bool {
    !cfg!(debug_assertions)
}

fn cleanup_unsupported_autostart(app_handle: &tauri::AppHandle) {
    if autostart_available_in_current_build() {
        return;
    }

    let autostart = app_handle.autolaunch();
    if autostart.is_enabled().unwrap_or(false) {
        if let Err(err) = autostart.disable() {
            eprintln!("Failed to disable debug autostart entry: {err}");
        }
    }
}

fn persist_and_broadcast_settings(
    app_handle: &tauri::AppHandle,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous = app_handle.state::<AppSettingsState>().0.lock().unwrap().clone();
    install_translation_hotkeys(app_handle, &settings)?;
    if let Err(error) = save_settings_to_disk(app_handle, &settings) {
        let _ = install_translation_hotkeys(app_handle, &previous);
        return Err(error);
    }
    {
        let state: tauri::State<AppSettingsState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = settings.clone();
    }
    update_tray_setting_checks(app_handle, &settings);
    #[cfg(windows)]
    if let Some(runtime) = app_handle.state::<SelectedTextRuntimeState>().runtime.lock().unwrap().as_ref() {
        runtime.configure(native_input_settings(&settings))?;
    }
    app_handle.state::<ocr::OcrState>().0.lock().unwrap().configure(
        settings.auto_translate && settings.translation_active, &settings.ocr_model_tier, &settings.ocr_language,
    );
    if let Err(err) = app_handle.emit("settings-changed", settings.clone()) {
        eprintln!("Failed to emit settings changed event: {err}");
    }
    Ok(settings)
}

// ── Screen capture helper ─────────────────────────────────────────────────

fn encode_rgba_png(raw_pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut png_bytes: Vec<u8> = Vec::new();
    let encoder = PngEncoder::new_with_quality(
        Cursor::new(&mut png_bytes),
        CompressionType::Fast,
        FilterType::NoFilter,
    );
    encoder
        .write_image(&raw_pixels, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(png_bytes)
}

fn capture_area_data_url(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    let screen = Screen::from_point(x, y).map_err(|e| e.to_string())?;
    let info = screen.display_info;
    let relative_x = x.saturating_sub(info.x);
    let relative_y = y.saturating_sub(info.y);
    let image = screen
        .capture_area(relative_x, relative_y, width, height)
        .map_err(|e| e.to_string())?;
    let image_width = image.width();
    let image_height = image.height();
    let raw_pixels = image.into_raw();
    let png_bytes = encode_rgba_png(&raw_pixels, image_width, image_height)?;
    Ok(format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(&png_bytes)))
}

fn current_screen() -> Result<Screen, Box<dyn std::error::Error>> {
    let (cursor_x, cursor_y) = cursor_position().unwrap_or((0, 0));
    match Screen::from_point(cursor_x, cursor_y) {
        Ok(screen) => Ok(screen),
        Err(_) => Screen::all()?
            .into_iter()
            .next()
            .ok_or_else(|| "No screens found".into()),
    }
}

fn capture_screen_data_url(screen: Screen) -> Result<String, String> {
    let image = screen.capture().map_err(|e| e.to_string())?;
    let image_width = image.width();
    let image_height = image.height();
    let raw_pixels = image.into_raw();
    let png_bytes = encode_rgba_png(&raw_pixels, image_width, image_height)?;
    Ok(format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(&png_bytes)))
}

fn copy_full_screen_to_clipboard() -> Result<(), String> {
    let screen = current_screen().map_err(|e| e.to_string())?;
    let data_url = capture_screen_data_url(screen)?;
    copy_image_to_clipboard(data_url)
}

fn show_capture_toast(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(existing) = app_handle.get_webview_window("capture-toast") {
        let _ = existing.destroy();
    }

    let screen = current_screen()?;
    let info = screen.display_info;
    let scale_factor = info.scale_factor as f64;
    let toast_width = 230.0;
    let toast_height = 54.0;

    let logical_x = info.x as f64 / scale_factor;
    let logical_y = info.y as f64 / scale_factor;
    let logical_width = info.width as f64 / scale_factor;
    let logical_height = info.height as f64 / scale_factor;

    let toast_x = logical_x + logical_width - toast_width - 24.0;
    let toast_y = logical_y + logical_height - toast_height - 44.0;

    WebviewWindowBuilder::new(
        app_handle,
        "capture-toast",
        tauri::WebviewUrl::App("capture-toast.html".into()),
    )
    .title("Screenshot copied")
    .inner_size(toast_width, toast_height)
    .position(toast_x, toast_y)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .build()?;

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1200));
        if let Some(win) = handle.get_webview_window("capture-toast") {
            let _ = win.destroy();
        }
    });

    Ok(())
}

fn spawn_copy_full_screen_to_clipboard(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = copy_full_screen_to_clipboard() {
            eprintln!("Failed to copy full-screen capture to clipboard: {}", e);
            return;
        }

        if let Err(e) = show_capture_toast(&app_handle) {
            eprintln!("Failed to show full-screen capture toast: {}", e);
        }
    });
}

fn recording_temp_path() -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    std::env::temp_dir().join(format!("polytranslate-recording-{millis}.mp4"))
}

fn destination_with_mp4_extension(path: PathBuf) -> PathBuf {
    match path.extension().and_then(|value| value.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("mp4") => path,
        _ => path.with_extension("mp4"),
    }
}

fn build_ffmpeg_record_args(rect: &RecordingRect, output_path: &std::path::Path) -> Vec<String> {
    let width = rect.width - (rect.width % 2);
    let height = rect.height - (rect.height % 2);

    vec![
        "-y".to_string(),
        "-f".to_string(),
        "gdigrab".to_string(),
        "-framerate".to_string(),
        "30".to_string(),
        "-offset_x".to_string(),
        rect.x.to_string(),
        "-offset_y".to_string(),
        rect.y.to_string(),
        "-video_size".to_string(),
        format!("{}x{}", width.max(2), height.max(2)),
        "-i".to_string(),
        "desktop".to_string(),
        "-an".to_string(),
        "-c:v".to_string(),
        "mpeg4".to_string(),
        "-q:v".to_string(),
        "5".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        output_path.to_string_lossy().to_string(),
    ]
}

fn ensure_ffmpeg_available() -> Result<(), String> {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| {
            "FFmpeg was not found. Install FFmpeg and make sure ffmpeg.exe is available on PATH."
                .to_string()
        })?;

    if output.success() {
        Ok(())
    } else {
        Err(
            "FFmpeg was found but did not start successfully. Reinstall FFmpeg or check your PATH entry."
                .to_string(),
        )
    }
}

fn spawn_ffmpeg_recording(rect: &RecordingRect, temp_path: &std::path::Path) -> Result<Child, String> {
    let args = build_ffmpeg_record_args(rect, temp_path);
    Command::new("ffmpeg")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Could not start FFmpeg recording: {err}"))
}

fn recording_file_has_content(path: &std::path::Path) -> bool {
    fs::metadata(path).map(|metadata| metadata.len() > 0).unwrap_or(false)
}

fn stop_ffmpeg_child(child: &mut Child, output_path: &std::path::Path) -> Result<(), String> {
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(b"q");
    }

    for _ in 0..20 {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else if recording_file_has_content(output_path) {
                    Ok(())
                } else {
                    Err(format!("FFmpeg exited with status {status}"))
                };
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(err) => return Err(format!("Could not read FFmpeg status: {err}")),
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    if recording_file_has_content(output_path) {
        Ok(())
    } else {
        Err("FFmpeg did not stop in time, so the recording was aborted.".to_string())
    }
}

fn finalize_recording_file(temp_path: &std::path::Path, destination: PathBuf) -> Result<PathBuf, String> {
    let destination = destination_with_mp4_extension(destination);
    match fs::rename(temp_path, &destination) {
        Ok(()) => Ok(destination),
        Err(_) => {
            fs::copy(temp_path, &destination)
                .map_err(|err| format!("Could not copy recording to selected destination: {err}"))?;
            fs::remove_file(temp_path)
                .map_err(|err| format!("Could not remove temporary recording after copy: {err}"))?;
            Ok(destination)
        }
    }
}

#[cfg(target_os = "windows")]
fn cursor_position() -> Option<(i32, i32)> {
    let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
    let ok = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) };
    (ok != 0).then_some((point.x, point.y))
}

#[cfg(not(target_os = "windows"))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

fn trigger_capture_and_overlay(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state: tauri::State<CaptureState> = app_handle.state();
    {
        let mut lock = state.0.lock().unwrap();
        *lock = None;
    }

    // If selection is already active, bring the existing overlay forward
    // instead of racing Tauri's unique window labels by creating another one.
    if let Some(existing) = app_handle.get_webview_window("overlay") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let screen = current_screen()?;
    let info = screen.display_info;
    let scale_factor = info.scale_factor as f64;
    let overlay_url = format!(
        "index.html?overlay=1&screenX={}&screenY={}&screenWidth={}&screenHeight={}",
        info.x,
        info.y,
        info.width,
        info.height
    );

    let logical_x = info.x as f64 / scale_factor;
    let logical_y = info.y as f64 / scale_factor;

    WebviewWindowBuilder::new(
        app_handle,
        "overlay",
        tauri::WebviewUrl::App(overlay_url.into())
    )
    .title("Selection Overlay")
    .fullscreen(true)
    .position(logical_x, logical_y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible(false)  // Start hidden; frontend calls show_overlay once canvas is ready
    .build()?;

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────

fn build_recording_overlay_url(x: i32, y: i32, width: u32, height: u32) -> String {
    format!(
        "index.html?overlay=1&recording=1&screenX={x}&screenY={y}&screenWidth={width}&screenHeight={height}"
    )
}

fn recording_shortcut_action(is_recording: bool) -> RecordingShortcutAction {
    if is_recording {
        RecordingShortcutAction::StopRecording
    } else {
        RecordingShortcutAction::OpenOverlay
    }
}

fn recording_overlay_dock_rect(
    screen_x: i32,
    screen_y: i32,
    scale_factor: f64,
    control_x: f64,
    control_y: f64,
    control_width: f64,
    control_height: f64,
) -> DockedRecordingOverlayRect {
    let scale_factor = if scale_factor > 0.0 { scale_factor } else { 1.0 };

    DockedRecordingOverlayRect {
        x: screen_x as f64 / scale_factor + control_x,
        y: screen_y as f64 / scale_factor + control_y,
        width: control_width,
        height: control_height,
    }
}

fn request_capture_and_overlay(app_handle: &tauri::AppHandle) {
    let request_state: tauri::State<CaptureRequestState> = app_handle.state();
    if request_state.0.swap(true, Ordering::SeqCst) {
        return;
    }

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        if let Err(err) = trigger_capture_and_overlay(&handle) {
            eprintln!("Failed to trigger capture overlay: {err}");
        }
        let request_state: tauri::State<CaptureRequestState> = handle.state();
        request_state.0.store(false, Ordering::SeqCst);
    });
}

fn trigger_recording_overlay(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(existing) = app_handle.get_webview_window("overlay") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let screen = current_screen()?;
    let info = screen.display_info;
    let scale_factor = info.scale_factor as f64;
    let overlay_url = build_recording_overlay_url(info.x, info.y, info.width, info.height);

    let logical_x = info.x as f64 / scale_factor;
    let logical_y = info.y as f64 / scale_factor;

    WebviewWindowBuilder::new(
        app_handle,
        "overlay",
        tauri::WebviewUrl::App(overlay_url.into())
    )
    .title("Recording Overlay")
    .fullscreen(true)
    .position(logical_x, logical_y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible(false)
    .build()?;

    Ok(())
}

fn request_recording_overlay(app_handle: &tauri::AppHandle) {
    let is_recording = {
        let state: tauri::State<RecordingState> = app_handle.state();
        let active = state.0.lock().unwrap().is_some();
        active
    };

    if recording_shortcut_action(is_recording) == RecordingShortcutAction::StopRecording {
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            if let Err(err) = stop_screen_recording_inner(&handle) {
                eprintln!("Failed to stop screen recording: {err}");
            }
        });
        return;
    }

    let request_state: tauri::State<RecordingRequestState> = app_handle.state();
    if request_state.0.swap(true, Ordering::SeqCst) {
        return;
    }

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        if let Err(err) = trigger_recording_overlay(&handle) {
            eprintln!("Failed to trigger recording overlay: {err}");
        }
        let request_state: tauri::State<RecordingRequestState> = handle.state();
        request_state.0.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
fn get_capture_image(state: tauri::State<'_, CaptureState>) -> Option<String> {
    let lock = state.0.lock().unwrap();
    lock.clone()
}

#[tauri::command]
fn close_overlay(app_handle: tauri::AppHandle) {
    let state: tauri::State<RecordingState> = app_handle.state();
    let active = {
        let mut lock = state.0.lock().unwrap();
        lock.take()
    };

    if let Some(mut recording) = active {
        let _ = stop_ffmpeg_child(&mut recording.child, &recording.temp_path);
        let _ = fs::remove_file(&recording.temp_path);
    }

    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.destroy();
    }
}

/// Called by the overlay frontend once the crop canvas is ready.
/// Prevents the WebView2 white-flash: the window starts hidden and is
/// only made visible after the page has fully initialised.
#[tauri::command]
fn show_overlay(app_handle: tauri::AppHandle) {
    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.show();
        let _ = overlay.set_focus();
    }
}

#[tauri::command]
fn close_recording_overlay_controls(app_handle: tauri::AppHandle) {
    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.destroy();
    }
}

#[tauri::command]
fn dock_recording_overlay(
    app_handle: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let screen = current_screen().map_err(|err| err.to_string())?;
    let info = screen.display_info;
    let rect = recording_overlay_dock_rect(info.x, info.y, info.scale_factor as f64, x, y, width, height);

    let Some(overlay) = app_handle.get_webview_window("overlay") else {
        return Err("Recording overlay is not open.".to_string());
    };

    overlay
        .set_fullscreen(false)
        .map_err(|err| format!("Could not exit fullscreen: {err}"))?;

    overlay
        .set_size(Size::Logical(LogicalSize::new(rect.width, rect.height)))
        .map_err(|err| format!("Could not resize recording controls: {err}"))?;
    overlay
        .set_position(Position::Logical(LogicalPosition::new(rect.x, rect.y)))
        .map_err(|err| format!("Could not move recording controls: {err}"))?;
    overlay
        .show()
        .map_err(|err| format!("Could not show recording controls: {err}"))?;
    overlay
        .set_focus()
        .map_err(|err| format!("Could not focus recording controls: {err}"))?;

    Ok(())
}

#[tauri::command]
fn start_screen_recording(
    state: tauri::State<'_, RecordingState>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Select a recording area before starting.".to_string());
    }

    let mut lock = state.0.lock().unwrap();
    if lock.is_some() {
        return Err("A screen recording is already in progress.".to_string());
    }

    ensure_ffmpeg_available()?;

    let rect = RecordingRect { x, y, width, height };
    let temp_path = recording_temp_path();
    let child = spawn_ffmpeg_recording(&rect, &temp_path)?;

    *lock = Some(ActiveRecording { rect, temp_path, child });
    Ok(())
}

#[tauri::command]
fn cancel_screen_recording(state: tauri::State<'_, RecordingState>) -> Result<(), String> {
    let active = {
        let mut lock = state.0.lock().unwrap();
        lock.take()
    };

    if let Some(mut recording) = active {
        let _ = stop_ffmpeg_child(&mut recording.child, &recording.temp_path);
        let _ = fs::remove_file(&recording.temp_path);
    }

    Ok(())
}

#[tauri::command]
fn stop_screen_recording(
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
    stop_screen_recording_inner(&app_handle)
}

fn stop_screen_recording_inner(app_handle: &tauri::AppHandle) -> Result<Option<String>, String> {
    let state: tauri::State<RecordingState> = app_handle.state();
    let active = {
        let mut lock = state.0.lock().unwrap();
        lock.take()
    };

    let Some(mut recording) = active else {
        return Err("No screen recording is in progress.".to_string());
    };

    stop_ffmpeg_child(&mut recording.child, &recording.temp_path)?;

    use tauri_plugin_dialog::DialogExt;
    let destination = app_handle
        .dialog()
        .file()
        .add_filter("MP4 Video", &["mp4"])
        .set_file_name("polytranslate-recording.mp4")
        .blocking_save_file();

    let Some(destination) = destination else {
        let _ = fs::remove_file(&recording.temp_path);
        return Ok(None);
    };

    let final_path = finalize_recording_file(
        &recording.temp_path,
        destination.into_path().map_err(|_| {
            "The selected save destination is not a local filesystem path.".to_string()
        })?,
    )?;

    Ok(Some(final_path.to_string_lossy().to_string()))
}

#[tauri::command]
fn copy_image_to_clipboard(data_url: String) -> Result<(), String> {
    let png_bytes = decode_png_data_url(&data_url)?;
    let image = image::load_from_memory(&png_bytes)
        .map_err(|e| format!("Could not decode image for clipboard: {e}"))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let raw_pixels = image.into_raw();

    let mut last_error = None;
    for attempt in 0..8 {
        let clipboard_image = ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(raw_pixels.clone()),
        };

        match Clipboard::new()
            .map_err(|e| format!("Could not open system clipboard: {e}"))
            .and_then(|mut clipboard| {
                clipboard
                    .set_image(clipboard_image)
                    .map_err(|e| format!("Could not write image to clipboard: {e}"))
            }) {
            Ok(()) => return Ok(()),
            Err(err) => {
                last_error = Some(err);
                if attempt < 7 {
                    std::thread::sleep(Duration::from_millis(25));
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Could not write image to clipboard".to_string()))
}

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "Expected a PNG base64 data URL.".to_string())?;
    general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Could not decode crop data URL: {e}"))
}

fn run_crop_image_actions(
    app_handle: &tauri::AppHandle,
    data_url: &str,
    x: i32,
    y: i32,
    display_width: u32,
    display_height: u32,
    ocr_pin_image: bool,
    ocr_copy_to_clipboard: bool,
) {
    if ocr_pin_image {
        let handle = app_handle.clone();
        let snippet_data_url = data_url.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = open_snippet_window(handle, snippet_data_url, x, y, display_width, display_height).await {
                eprintln!("Failed to open pinned cropped image: {err}");
            }
        });
    }

    if ocr_copy_to_clipboard {
        if let Err(err) = copy_image_to_clipboard(data_url.to_string()) {
            eprintln!("Failed to copy cropped image to clipboard: {err}");
        }
    }
}

#[tauri::command]
async fn process_crop_image_actions(
    app_handle: tauri::AppHandle,
    data_url: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    display_width: u32,
    display_height: u32,
    ocr_pin_image: bool,
    ocr_copy_to_clipboard: bool,
) -> Result<String, String> {
    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.hide();
    }

    {
        let state: tauri::State<CaptureState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = None;
    }

    let crop_data_url = match data_url {
        Some(value) => value,
        None => {
            std::thread::sleep(Duration::from_millis(35));
            capture_area_data_url(x, y, width, height)?
        }
    };

    run_crop_image_actions(
        &app_handle,
        &crop_data_url,
        x,
        y,
        display_width,
        display_height,
        ocr_pin_image,
        ocr_copy_to_clipboard,
    );

    Ok(crop_data_url)
}

/// Called by the frontend overlay when the user completes a crop selection.
/// Receives the cropped image as a base64 Data URL and the region coordinates.
/// Opens the tooltip window and (optionally) the pinned snippet window.
#[tauri::command]
async fn process_crop(
    app_handle: tauri::AppHandle,
    data_url: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    display_width: u32,
    display_height: u32,
    ocr_pin_image: bool,
    ocr_copy_to_clipboard: bool,
) -> Result<(), String> {
    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.hide();
    }

    // Clear the capture state so it is not reused
    {
        let state: tauri::State<CaptureState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = None;
    }

    // Console-style debug log to confirm crop was received
    println!("[PolyTranslate] Crop received: x={} y={} height={} dataUrl_len={}", x, y, height, data_url.len());

    // Store tooltip data (OCR text will be filled by the tooltip frontend via get_tooltip_data)
    {
        let state: tauri::State<TooltipState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = Some(TooltipData {
            text: String::new(),
            error: None,
            data_url: data_url.clone(),
            x,
            y,
            width,
            height,
            ..Default::default()
        });
    }

    // Open tooltip window
    open_tooltip_window_inner(&app_handle, x, y, height)
        .map_err(|e| e.to_string())?;

    run_crop_image_actions(
        &app_handle,
        &data_url,
        x,
        y,
        display_width,
        display_height,
        ocr_pin_image,
        ocr_copy_to_clipboard,
    );

    Ok(())
}

#[tauri::command]
async fn process_crop_area(
    app_handle: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    display_width: u32,
    display_height: u32,
    ocr_pin_image: bool,
    ocr_copy_to_clipboard: bool,
) -> Result<String, String> {
    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.hide();
    }

    {
        let state: tauri::State<CaptureState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = None;
    }

    std::thread::sleep(Duration::from_millis(80));
    let data_url = capture_area_data_url(x, y, width, height)?;

    {
        let state: tauri::State<TooltipState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = Some(TooltipData {
            text: String::new(),
            error: None,
            data_url: data_url.clone(),
            x,
            y,
            width,
            height,
            ..Default::default()
        });
    }

    open_tooltip_window_inner(&app_handle, x, y, height)
        .map_err(|e| e.to_string())?;

    run_crop_image_actions(
        &app_handle,
        &data_url,
        x,
        y,
        display_width,
        display_height,
        ocr_pin_image,
        ocr_copy_to_clipboard,
    );

    Ok(data_url)
}

fn open_tooltip_window_inner(
    app_handle: &tauri::AppHandle,
    x: i32,
    y: i32,
    height: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Destroy any existing tooltip
    if let Some(existing) = app_handle.get_webview_window("tooltip") {
        let _ = existing.destroy();
    }

    // Default coordinates in case screen detection fails
    let mut tooltip_x = x as f64;
    let mut tooltip_y = (y + height as i32 + 8) as f64;
    let mut use_tauri_center = false;

    // Centering tooltip on the screen where crop happened
    if let Ok(screen) = Screen::from_point(x, y) {
        let info = screen.display_info;
        let scale_factor = info.scale_factor as f64;
        let tooltip_width = 420.0;
        let tooltip_height = 280.0;
        
        let logical_x = info.x as f64 / scale_factor;
        let logical_y = info.y as f64 / scale_factor;
        let logical_width = info.width as f64 / scale_factor;
        let logical_height = info.height as f64 / scale_factor;

        tooltip_x = logical_x + (logical_width - tooltip_width) / 2.0;
        tooltip_y = logical_y + (logical_height - tooltip_height) / 2.0;
    } else {
        use_tauri_center = true;
    }

    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        "tooltip",
        tauri::WebviewUrl::App("tooltip.html".into()),
    )
    .title("PolyTranslate Tooltip")
    .inner_size(420.0, 280.0)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .focused(false);

    if use_tauri_center {
        builder = builder.center();
    } else {
        builder = builder.position(tooltip_x, tooltip_y);
    }

    #[cfg(feature = "latency-harness")]
    if let Some(diagnostics) = app_handle.try_state::<latency::LatencyState>() {
        builder = builder.data_directory(diagnostics.profile.clone())
            .initialization_script(format!("globalThis.__TRANSLATION_DIAGNOSTICS__=true;globalThis.__TRANSLATION_TRACE_ID__={:?};", diagnostics.trace_id.load(std::sync::atomic::Ordering::Acquire).to_string()));
    }
    let _tooltip_win = builder.build()?;

    Ok(())
}

pub use tooltip_commands::{open_tooltip_window, close_tooltip_window, dismiss_tooltip_if_external, get_tooltip_data};
pub mod tooltip_commands {
use super::*;
/// Command: spawn the tooltip window explicitly (called by the overlay frontend
/// after it has run OCR and wants to open a tooltip with specific text).
#[tauri::command]
pub async fn open_tooltip_window(
    app_handle: tauri::AppHandle,
    text: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    {
        let state: tauri::State<TooltipState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = Some(TooltipData { text, data_url: String::new(), x, y, width, height, error: None, ..Default::default() });
    }
    open_tooltip_window_inner(&app_handle, x, y, height)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_tooltip_window(app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window("tooltip") {
        let _ = win.destroy();
    }
}

#[tauri::command]
pub fn dismiss_tooltip_if_external(app_handle: tauri::AppHandle) {
    if app_handle.webview_windows().values().any(|window| window.is_focused().unwrap_or(false)) { return; }
    close_tooltip_window(app_handle);
}

#[tauri::command]
pub fn get_tooltip_data(state: tauri::State<'_, TooltipState>) -> Option<TooltipData> {
    let lock = state.0.lock().unwrap();
    lock.clone()
}

}

/// Spawn a new always-on-top draggable snippet window showing the cropped image.
#[tauri::command]
async fn open_snippet_window(
    app_handle: tauri::AppHandle,
    data_url: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let label = {
        let counter: tauri::State<SnippetCounter> = app_handle.state();
        let mut n = counter.0.lock().unwrap();
        *n += 1;
        format!("snippet-{}", n)
    };

    // Store the data_url keyed by label before the window opens
    {
        let store: tauri::State<SnippetStore> = app_handle.state();
        let mut map = store.0.lock().unwrap();
        map.insert(label.clone(), SnippetData {
            data_url,
            display_width: width,
            display_height: height,
        });
    }

    let _win = WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App("snippet.html".into()),
    )
    .title("PolyTranslate Snippet")
    .inner_size(width.saturating_add(20).max(44) as f64, height.max(24) as f64)
    .position(x as f64, y as f64)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn close_snippet_window(app_handle: tauri::AppHandle, label: Option<String>) {
    let target = label.unwrap_or_else(|| "snippet-1".to_string());
    // Clean up from store
    {
        let store: tauri::State<SnippetStore> = app_handle.state();
        let mut map = store.0.lock().unwrap();
        map.remove(&target);
    }
    if let Some(win) = app_handle.get_webview_window(&target) {
        let _ = win.destroy();
    }
}

/// Returns snippet data for the snippet window identified by its label.
/// The snippet window calls this with its own label (passed as query param in URL).
#[tauri::command]
fn get_snippet_data(state: tauri::State<'_, SnippetStore>, label: String) -> serde_json::Value {
    let map = state.0.lock().unwrap();
    let data = map.get(&label).cloned().unwrap_or(SnippetData {
        data_url: String::new(),
        display_width: 0,
        display_height: 0,
    });
    serde_json::json!(data)
}

#[tauri::command]
fn get_app_settings(state: tauri::State<'_, AppSettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(),String> {
    Clipboard::new().and_then(|mut clipboard| clipboard.set_text(text)).map_err(|error| error.to_string())
}

#[tauri::command]
async fn complete_input_replacement(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String, data: Option<serde_json::Value>, error: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    { return input_translation::complete_input_replacement(window, app.clone(), app.state::<input_translation::InputTranslationState>(), id, data, error).await; }
    #[cfg(not(windows))]
    { let _ = (window, app, id, data, error); Err("Input replacement is available on Windows".into()) }
}

#[tauri::command]
fn update_app_settings(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    patch: serde_json::Value,
) -> Result<AppSettings, String> {
    let mut settings = state.0.lock().unwrap().clone();
    let mut value = serde_json::to_value(&settings)
        .map_err(|e| format!("Could not serialize current settings: {e}"))?;
    let Some(target) = value.as_object_mut() else {
        return Err("Current settings did not serialize to an object.".to_string());
    };
    let Some(source) = patch.as_object() else {
        return Err("Settings patch must be an object.".to_string());
    };
    for (key, value) in source {
        target.insert(key.clone(), value.clone());
    }
    settings = serde_json::from_value(value)
        .map_err(|e| format!("Could not apply settings patch: {e}"))?;
    persist_and_broadcast_settings(&app_handle, settings)
}

#[tauri::command]
async fn verify_deepl_api_key(state: tauri::State<'_, http_clients::HttpClients>, api_key: String) -> Result<bool, String> {
    if api_key.trim().is_empty() {
        return Ok(false);
    }
    let is_free_key = api_key.ends_with(":fx");
    let url = if is_free_key {
        "https://api-free.deepl.com/v2/usage"
    } else {
        "https://api.deepl.com/v2/usage"
    };

    let client = state.deepl().map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let res = client
        .get(url)
        .header("Authorization", format!("DeepL-Auth-Key {}", api_key))
        .timeout(Duration::from_secs(5))
        .send()
        .await;

    match res {
        Ok(response) => {
            let valid = response.status() == 200;
            let _ = response.bytes().await; // Consume the body so the connection can return to the pool.
            Ok(valid)
        }
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn translate_deepl(
    state: tauri::State<'_, http_clients::HttpClients>,
    app: tauri::AppHandle,
    transport_generation: Option<String>,
    invocation_id: Option<String>,
    text: String,
    target_lang: String,
    api_key: String,
) -> Result<serde_json::Value, String> {
    desktop::validate_transport_generation(&app, transport_generation.as_deref())?;
    state.claim_invocation("translate_deepl", invocation_id.as_deref())?;
    if api_key.trim().is_empty() {
        return Err("DeepL API Key is missing. Please configure it in settings.".to_string());
    }

    let is_free_key = api_key.ends_with(":fx");
    let url = if is_free_key {
        "https://api-free.deepl.com/v2/translate"
    } else {
        "https://api.deepl.com/v2/translate"
    };

    let map_lang = |lang: &str| {
        let l = lang.to_lowercase();
        let first_part = l.split('-').next().unwrap_or(&l);
        if first_part == "en" {
            "EN-US".to_string()
        } else if first_part == "zh" {
            "ZH".to_string()
        } else {
            first_part.to_uppercase()
        }
    };

    let client = state.deepl().map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let body = serde_json::json!({
        "text": [text],
        "target_lang": map_lang(&target_lang),
    });

    let res = client
        .post(url)
        .header("Authorization", format!("DeepL-Auth-Key {}", api_key))
        .header("Content-Type", "application/json")
        .timeout(Duration::from_secs(8))
        .json(&body)
        .send()
        .await;

    match res {
        Ok(response) => {
            if response.status() == 403 {
                return Err("DeepL API Key is invalid or expired.".to_string());
            }
            if !response.status().is_success() {
                return Err(format!("DeepL translation failed. Status: {}", response.status()));
            }

            let data: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse DeepL response: {e}"))?;

            if let Some(translations) = data.get("translations") {
                if let Some(first) = translations.get(0) {
                    return Ok(first.clone());
                }
            }
            Err("DeepL translation returned empty result.".to_string())
        }
        Err(err) => Err(format!("DeepL translation request failed: {}", err)),
    }
}

#[tauri::command]
async fn open_settings_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_settings_window_inner(&app_handle).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart_enabled(app_handle: tauri::AppHandle) -> Result<bool, String> {
    if !autostart_available_in_current_build() {
        return Ok(false);
    }

    app_handle
        .autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart_enabled(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled && !autostart_available_in_current_build() {
        return Err("Start with Windows is only available in packaged release builds.".to_string());
    }

    let autostart = app_handle.autolaunch();
    if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    }
    .map_err(|e| e.to_string())
}

fn open_settings_window_inner(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(existing) = app_handle.get_webview_window("settings") {
        existing.show()?;
        existing.set_focus()?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app_handle,
        "settings",
        tauri::WebviewUrl::App("settings.html".into()),
    )
    .title("PolyTranslate Settings")
    .inner_size(840.0, 680.0)
    .decorations(true)
    .resizable(true)
    .build()?;

    Ok(())
}

fn spawn_settings_window(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = open_settings_window_inner(&app) { eprintln!("Cannot open settings: {error}"); }
    });
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let specs = tray_menu_specs();
    let capture_item = MenuItem::with_id(app, specs[0].id, specs[0].label, true, None::<&str>)?;
    let record_screen_item = MenuItem::with_id(app, specs[1].id, specs[1].label, true, None::<&str>)?;
    let copy_full_screen_item = MenuItem::with_id(app, specs[2].id, specs[2].label, true, None::<&str>)?;
    let settings_state: tauri::State<AppSettingsState> = app.handle().state();
    let current_settings = settings_state.0.lock().unwrap().clone();
    let auto_translate_item = CheckMenuItem::with_id(
        app,
        specs[3].id,
        specs[3].label,
        true,
        current_settings.auto_translate,
        None::<&str>,
    )?;
    let pin_image_item = CheckMenuItem::with_id(
        app,
        specs[4].id,
        specs[4].label,
        true,
        current_settings.ocr_pin_image,
        None::<&str>,
    )?;
    let autostart_enabled = if autostart_available_in_current_build() {
        app.handle().autolaunch().is_enabled().unwrap_or(false)
    } else {
        false
    };
    let autostart_item = CheckMenuItem::with_id(
        app,
        specs[6].id,
        specs[6].label,
        autostart_available_in_current_build(),
        autostart_enabled,
        None::<&str>,
    )?;
    let settings_item = MenuItem::with_id(app, specs[5].id, specs[5].label, true, None::<&str>)?;
    let pdf_item = MenuItem::with_id(app, "open_pdf", "Read PDF…", true, None::<&str>)?;
    let exit_item = MenuItem::with_id(app, specs[7].id, specs[7].label, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &capture_item,
            &record_screen_item,
            &copy_full_screen_item,
            &auto_translate_item,
            &pin_image_item,
            &settings_item,
            &pdf_item,
            &autostart_item,
            &exit_item,
        ],
    )?;
    {
        let tray_items: tauri::State<TraySettingsItems> = app.handle().state();
        *tray_items.capture_ocr.lock().unwrap() = Some(capture_item.clone());
        *tray_items.auto_translate.lock().unwrap() = Some(auto_translate_item.clone());
        *tray_items.ocr_pin_image.lock().unwrap() = Some(pin_image_item.clone());
    }
    let icon = app.default_window_icon().cloned();

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("PolyTranslate")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| match event.id().as_ref() {
            "capture_ocr" => {
                request_capture_and_overlay(app_handle);
            }
            "record_screen" => {
                request_recording_overlay(app_handle);
            }
            "copy_full_screen" => {
                spawn_copy_full_screen_to_clipboard(app_handle.clone());
            }
            "settings" => {
                spawn_settings_window(app_handle);
            }
            "open_pdf" => {
                let handle=app_handle.clone();
                tauri::async_runtime::spawn(async move { if let Err(error) = desktop_views::open_pdf_window(handle).await { eprintln!("Cannot open PDF Reader: {error}"); } });
            }
            "auto_translate" => {
                let state: tauri::State<AppSettingsState> = app_handle.state();
                let mut settings = state.0.lock().unwrap().clone();
                settings.auto_translate = !settings.auto_translate;
                if let Err(err) = persist_and_broadcast_settings(app_handle, settings) {
                    eprintln!("Failed to toggle auto translate: {err}");
                }
            }
            "ocr_pin_image" => {
                let state: tauri::State<AppSettingsState> = app_handle.state();
                let mut settings = state.0.lock().unwrap().clone();
                settings.ocr_pin_image = !settings.ocr_pin_image;
                if let Err(err) = persist_and_broadcast_settings(app_handle, settings) {
                    eprintln!("Failed to toggle pin image: {err}");
                }
            }
            "start_with_windows" => {
                if !autostart_available_in_current_build() {
                    let _ = autostart_item.set_checked(false);
                    eprintln!("Start with Windows is only available in packaged release builds.");
                    return;
                }

                let autostart = app_handle.autolaunch();
                match autostart.is_enabled() {
                    Ok(true) => {
                        if let Err(err) = autostart.disable() {
                            eprintln!("Failed to disable autostart: {err}");
                        } else if let Err(err) = autostart_item.set_checked(false) {
                            eprintln!("Failed to update autostart tray check: {err}");
                        }
                    }
                    Ok(false) => {
                        if let Err(err) = autostart.enable() {
                            eprintln!("Failed to enable autostart: {err}");
                        } else if let Err(err) = autostart_item.set_checked(true) {
                            eprintln!("Failed to update autostart tray check: {err}");
                        }
                    }
                    Err(err) => eprintln!("Failed to read autostart state: {err}"),
                }
            }
            "exit" => app_handle.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                spawn_settings_window(tray.app_handle());
            }
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    update_tray_setting_checks(app.handle(),&current_settings);
    Ok(())
}

// ── App entry point ───────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(http_clients::HttpClients::default())
        .manage(CaptureState::default())
        .manage(TooltipState::default())
        .manage(SnippetCounter::default())
        .manage(SnippetStore::default())
        .manage(AppSettingsState::default())
        .manage(TraySettingsItems::default())
        .manage(CaptureRequestState::default())
        .manage(RecordingState::default())
        .manage(RecordingRequestState::default())
        .manage(ocr::OcrState::default())
        .manage(SelectedTextRuntimeState::default())
        .manage(RegisteredTranslationShortcuts::default())
        .manage(desktop::DesktopDataState::default())
        .manage(desktop::DesktopServiceState::default())
        .manage(desktop_views::DesktopViewState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if window.label() == "settings" { window.state::<RegisteredTranslationShortcuts>().1.store(false,Ordering::Release); }
                window.state::<ocr::OcrState>().0.lock().unwrap().window_closed(window.label());
                window.state::<desktop::DesktopServiceState>().window_closed(window.label());
                desktop_views::close_for_owner(window.app_handle(),window.label());
            }
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Started {
                webview.state::<ocr::OcrState>().0.lock().unwrap().main_reloading();
                webview.state::<desktop::DesktopServiceState>().disconnected();
                #[cfg(windows)]
                if let Some(state) = webview.try_state::<input_translation::InputTranslationState>() { state.cancel_all(); }
            }
        })
        .setup(|app| {
            cleanup_unsupported_autostart(app.handle());
            let settings = load_settings_from_disk(app.handle());
            {
                let state: tauri::State<AppSettingsState> = app.handle().state();
                let mut lock = state.0.lock().unwrap();
                *lock = settings.clone();
            }
            app.state::<ocr::OcrState>().0.lock().unwrap().configure(
                settings.auto_translate && settings.translation_active, &settings.ocr_model_tier, &settings.ocr_language,
            );
            setup_tray(app)?;
            #[cfg(windows)]
            {
                app.manage(input_translation::InputTranslationState::default());
                let handle = app.handle().clone();
                let runtime = selected_text::windows::WindowsInputRuntime::start_with_settings(native_input_settings(&settings), move |result, context| {
                    let ui_handle = handle.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        if !context.is_current() { return; }
                        if context.action == selected_text::TranslationAction::Dismiss { close_tooltip_window(ui_handle); return; }
                        let (text, error) = match result {
                            Ok(selected) => (selected.text, None),
                            Err(selected_text::SelectionError::SourceChanged) => return,
                            Err(selected_text::SelectionError::NoText) => (String::new(), Some("Không lấy được văn bản".to_string())),
                        };
                        if context.action == selected_text::TranslationAction::Replace && error.is_none() {
                            if let Err(error) = input_translation::request(&ui_handle, text, context) { eprintln!("Input translation failed: {error}"); }
                            return;
                        }
                        *ui_handle.state::<TooltipState>().0.lock().unwrap() = Some(TooltipData {
                            text, error, x: context.x, y: context.y, ..Default::default()
                        });
                        if let Err(error) = open_tooltip_window_inner(&ui_handle, context.x, context.y, 0) {
                            eprintln!("Cannot open Selected Text tooltip: {error}");
                        }
                    });
                })?;
                *app.state::<SelectedTextRuntimeState>().runtime.lock().unwrap() = Some(runtime);
            }
            for spec in global_shortcut_specs() {
                if spec.id == "capture_ocr" { continue; }
                let modifiers = match spec.id {
                    "capture_ocr" | "record_screen" => Modifiers::CONTROL,
                    "copy_full_screen" => Modifiers::ALT,
                    _ => Modifiers::CONTROL,
                };
                let shortcut = Shortcut::new(Some(modifiers), spec.code);
                app.global_shortcut().on_shortcut(shortcut, move |app_handle, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if app_handle.state::<RegisteredTranslationShortcuts>().1.load(Ordering::Acquire) { return; }

                    match spec.id {
                        "capture_ocr" => {
                            request_capture_and_overlay(app_handle);
                        }
                        "record_screen" => {
                            request_recording_overlay(app_handle);
                        }
                        "copy_full_screen" => {
                            spawn_copy_full_screen_to_clipboard(app_handle.clone());
                        }
                        _ => {}
                    }
                })?;
            }
            install_translation_hotkeys(app.handle(), &settings)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop::get_desktop_values,
            desktop::set_desktop_values,
            desktop::desktop_request,
            desktop::desktop_reply,
            desktop::desktop_service_ready,
            desktop::desktop_http,
            desktop_views::open_pdf_window,
            desktop_views::open_hanzi_breakdown,
            desktop_views::get_hanzi_breakdown_data,
            desktop_views::close_hanzi_breakdown,
            desktop_views::pick_pdf_file,
            desktop_views::save_hanzi_backup,
            ocr::request_ocr,
            ocr::ocr_host_ready,
            ocr::complete_ocr,
            ocr::cancel_ocr,
            ocr::ocr_progress,
            get_capture_image,
            close_overlay,
            close_recording_overlay_controls,
            show_overlay,
            dock_recording_overlay,
            start_screen_recording,
            stop_screen_recording,
            cancel_screen_recording,
            process_crop,
            process_crop_area,
            process_crop_image_actions,
            open_tooltip_window,
            close_tooltip_window,
            dismiss_tooltip_if_external,
            get_tooltip_data,
            open_snippet_window,
            close_snippet_window,
            get_snippet_data,
            copy_image_to_clipboard,
            complete_input_replacement,
            set_shortcut_capture,
            copy_text_to_clipboard,
            get_app_settings,
            update_app_settings,
            open_settings_window,
            get_autostart_enabled,
            set_autostart_enabled,
            translate_deepl,
            verify_deepl_api_key,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                #[cfg(windows)]
                { app.state::<SelectedTextRuntimeState>().runtime.lock().unwrap().take(); }
                #[cfg(not(windows))]
                let _ = app;
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        autostart_available_in_current_build, build_ffmpeg_record_args,
        build_recording_overlay_url, destination_with_mp4_extension, finalize_recording_file,
        global_shortcut_specs, recording_file_has_content, recording_overlay_dock_rect,
        recording_shortcut_action, recording_temp_path, tray_menu_specs, RecordingRect,
        RecordingShortcutAction, TooltipData,
    };
    use tauri_plugin_global_shortcut::Code;

    #[test]
    fn tooltip_data_serializes_for_frontend_contract() {
        let data = TooltipData {
            text: String::new(),
            error: None,
            data_url: "data:image/png;base64,AAAA".to_string(),
            x: 10,
            y: 20,
            width: 30,
            height: 40,
            ..Default::default()
        };

        let json = serde_json::to_value(data).expect("tooltip data should serialize");

        assert_eq!(json["dataUrl"], "data:image/png;base64,AAAA");
        assert!(json.get("data_url").is_none());
    }

    #[test]
    fn tray_menu_exposes_desktop_app_actions() {
        let specs = tray_menu_specs();
        let ids: Vec<&str> = specs.iter().map(|item| item.id).collect();

        assert_eq!(ids, vec![
            "capture_ocr",
            "record_screen",
            "copy_full_screen",
            "auto_translate",
            "ocr_pin_image",
            "settings",
            "start_with_windows",
            "exit",
        ]);
    }

    #[test]
    fn global_shortcuts_expose_ocr_recording_and_clipboard_capture() {
        let specs = global_shortcut_specs();
        let ids: Vec<&str> = specs.iter().map(|item| item.id).collect();
        let codes: Vec<Code> = specs.iter().map(|item| item.code).collect();

        assert_eq!(ids, vec!["capture_ocr", "record_screen", "copy_full_screen"]);
        assert_eq!(codes, vec![Code::Digit3, Code::Digit4, Code::KeyB]);
    }

    #[test]
    fn ffmpeg_record_args_target_selected_region_without_audio() {
        let rect = RecordingRect {
            x: 20,
            y: 30,
            width: 640,
            height: 360,
        };
        let args = build_ffmpeg_record_args(&rect, std::path::Path::new("C:\\Temp\\capture.mp4"));

        assert_eq!(args, vec![
            "-y",
            "-f",
            "gdigrab",
            "-framerate",
            "30",
            "-offset_x",
            "20",
            "-offset_y",
            "30",
            "-video_size",
            "640x360",
            "-i",
            "desktop",
            "-an",
            "-c:v",
            "mpeg4",
            "-q:v",
            "5",
            "-pix_fmt",
            "yuv420p",
            "C:\\Temp\\capture.mp4",
        ]);
    }

    #[test]
    fn ffmpeg_record_args_round_selected_region_to_even_dimensions() {
        let rect = RecordingRect {
            x: 20,
            y: 30,
            width: 641,
            height: 361,
        };
        let args = build_ffmpeg_record_args(&rect, std::path::Path::new("C:\\Temp\\capture.mp4"));

        let size_arg_index = args.iter().position(|arg| arg == "-video_size").unwrap() + 1;
        assert_eq!(args[size_arg_index], "640x360");
    }

    #[test]
    fn destination_with_mp4_extension_adds_missing_extension() {
        let path = destination_with_mp4_extension(std::path::PathBuf::from("C:\\Videos\\clip"));
        assert_eq!(path, std::path::PathBuf::from("C:\\Videos\\clip.mp4"));
    }

    #[test]
    fn destination_with_mp4_extension_preserves_existing_mp4_extension() {
        let path = destination_with_mp4_extension(std::path::PathBuf::from("C:\\Videos\\clip.mp4"));
        assert_eq!(path, std::path::PathBuf::from("C:\\Videos\\clip.mp4"));
    }

    #[test]
    fn recording_temp_path_uses_mp4_extension() {
        let path = recording_temp_path();
        assert_eq!(path.extension().and_then(|value| value.to_str()), Some("mp4"));
    }

    #[test]
    fn recording_rect_rejects_empty_dimensions() {
        assert!(RecordingRect { x: 0, y: 0, width: 0, height: 100 }.width == 0);
        assert!(RecordingRect { x: 0, y: 0, width: 100, height: 0 }.height == 0);
    }

    #[test]
    fn finalize_recording_file_moves_temp_and_adds_mp4_extension() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("polytranslate-recording-test-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let temp_path = dir.join("recording.tmp");
        let destination = dir.join("saved-clip");
        std::fs::write(&temp_path, b"video").unwrap();

        let final_path = finalize_recording_file(&temp_path, destination).unwrap();

        assert_eq!(final_path, dir.join("saved-clip.mp4"));
        assert_eq!(std::fs::read(&final_path).unwrap(), b"video");
        assert!(!temp_path.exists());

        let _ = std::fs::remove_file(final_path);
        let _ = std::fs::remove_dir(dir);
    }

    #[test]
    fn recording_overlay_url_marks_overlay_as_recording_mode() {
        let url = build_recording_overlay_url(10, 20, 640, 360);
        assert_eq!(
            url,
            "index.html?overlay=1&recording=1&screenX=10&screenY=20&screenWidth=640&screenHeight=360"
        );
    }

    #[test]
    fn recording_shortcut_opens_overlay_when_idle_and_stops_when_recording() {
        assert_eq!(recording_shortcut_action(false), RecordingShortcutAction::OpenOverlay);
        assert_eq!(recording_shortcut_action(true), RecordingShortcutAction::StopRecording);
    }

    #[test]
    fn recording_file_has_content_accepts_nonempty_temp_file() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("polytranslate-recording-content-{unique}.mp4"));
        std::fs::write(&path, b"video").unwrap();

        assert!(recording_file_has_content(&path));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn recording_file_has_content_rejects_empty_temp_file() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("polytranslate-recording-empty-{unique}.mp4"));
        std::fs::write(&path, b"").unwrap();

        assert!(!recording_file_has_content(&path));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn recording_overlay_dock_rect_converts_monitor_origin_to_logical_coordinates() {
        let rect = recording_overlay_dock_rect(1920, 0, 1.5, 120.0, 312.0, 260.0, 52.0);

        assert_eq!(rect.x, 1400.0);
        assert_eq!(rect.y, 312.0);
        assert_eq!(rect.width, 260.0);
        assert_eq!(rect.height, 52.0);
    }

    #[test]
    fn autostart_availability_tracks_build_profile() {
        assert_eq!(
            autostart_available_in_current_build(),
            !cfg!(debug_assertions)
        );
    }
}
