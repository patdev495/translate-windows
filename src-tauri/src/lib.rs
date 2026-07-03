use std::borrow::Cow;
use std::io::Cursor;
use std::sync::Mutex;
use std::time::Duration;
use std::{fs, path::PathBuf};
use arboard::{Clipboard, ImageData};
use tauri::{Emitter, Manager, WebviewWindowBuilder};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose};
use image::{
    codecs::png::{CompressionType, FilterType, PngEncoder},
    ImageEncoder,
};
use serde::{Deserialize, Serialize};

// ── Shared state types ────────────────────────────────────────────────────

#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<String>>);

/// Data passed from the crop overlay to the tooltip window.
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TooltipData {
    pub text: String,
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
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub primary_target_lang: String,
    pub secondary_target_lang: String,
    pub reverse_target_lang: String,
    pub auto_translate: bool,
    pub ocr_shortcut: String,
    pub ocr_model_tier: String,
    pub ocr_language: String,
    pub tts_enabled: bool,
    pub provider: String,
    pub deepl_api_key: String,
    pub tooltip_font_size: String,
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
            ocr_shortcut: "alt-space".to_string(),
            ocr_model_tier: "medium".to_string(),
            ocr_language: "ch".to_string(),
            tts_enabled: true,
            provider: "google".to_string(),
            deepl_api_key: String::new(),
            tooltip_font_size: "16".to_string(),
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
    pub auto_translate: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    pub ocr_pin_image: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
}

#[derive(Clone, Copy)]
struct TrayMenuSpec {
    id: &'static str,
    label: &'static str,
}

fn tray_menu_specs() -> [TrayMenuSpec; 6] {
    [
        TrayMenuSpec { id: "capture_ocr", label: "Capture OCR" },
        TrayMenuSpec { id: "auto_translate", label: "Auto Translate" },
        TrayMenuSpec { id: "ocr_pin_image", label: "Pin OCR Image" },
        TrayMenuSpec { id: "settings", label: "Settings" },
        TrayMenuSpec { id: "start_with_windows", label: "Start with Windows" },
        TrayMenuSpec { id: "exit", label: "Exit" },
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

fn persist_and_broadcast_settings(
    app_handle: &tauri::AppHandle,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    save_settings_to_disk(app_handle, &settings)?;
    {
        let state: tauri::State<AppSettingsState> = app_handle.state();
        let mut lock = state.0.lock().unwrap();
        *lock = settings.clone();
    }
    update_tray_setting_checks(app_handle, &settings);
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

    if let Some(existing) = app_handle.get_webview_window("overlay") {
        let _ = existing.destroy();
    }

    let (cursor_x, cursor_y) = cursor_position().unwrap_or((0, 0));
    let screen = match Screen::from_point(cursor_x, cursor_y) {
        Ok(screen) => screen,
        Err(_) => Screen::all()?
            .into_iter()
            .next()
            .ok_or("No screens found")?,
    };
    let info = screen.display_info;
    let overlay_url = format!(
        "index.html?overlay=1&screenX={}&screenY={}&screenWidth={}&screenHeight={}",
        info.x,
        info.y,
        info.width,
        info.height
    );

    WebviewWindowBuilder::new(
        app_handle,
        "overlay",
        tauri::WebviewUrl::App(overlay_url.into())
    )
    .title("Selection Overlay")
    .fullscreen(true)
    .position(info.x as f64, info.y as f64)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .build()?;

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
fn get_capture_image(state: tauri::State<'_, CaptureState>) -> Option<String> {
    let lock = state.0.lock().unwrap();
    lock.clone()
}

#[tauri::command]
fn close_overlay(app_handle: tauri::AppHandle) {
    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.destroy();
    }
}

#[tauri::command]
fn copy_image_to_clipboard(data_url: String) -> Result<(), String> {
    let png_bytes = decode_png_data_url(&data_url)?;
    let image = image::load_from_memory(&png_bytes)
        .map_err(|e| format!("Could not decode cropped image for clipboard: {e}"))?
        .to_rgba8();
    let (width, height) = image.dimensions();

    let clipboard_image = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(image.into_raw()),
    };

    Clipboard::new()
        .map_err(|e| format!("Could not open system clipboard: {e}"))?
        .set_image(clipboard_image)
        .map_err(|e| format!("Could not write cropped image to clipboard: {e}"))
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
            data_url: data_url.clone(),
            x,
            y,
            width,
            height,
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
            data_url: data_url.clone(),
            x,
            y,
            width,
            height,
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

    // Position tooltip near the crop region (offset slightly below)
    let tooltip_x = x;
    let tooltip_y = y + height as i32 + 8;

    let _tooltip_win = WebviewWindowBuilder::new(
        app_handle,
        "tooltip",
        tauri::WebviewUrl::App("tooltip.html".into()),
    )
    .title("PolyTranslate Tooltip")
    .inner_size(420.0, 280.0)
    .position(tooltip_x as f64, tooltip_y as f64)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .build()?;

    Ok(())
}

/// Command: spawn the tooltip window explicitly (called by the overlay frontend
/// after it has run OCR and wants to open a tooltip with specific text).
#[tauri::command]
async fn open_tooltip_window(
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
        *lock = Some(TooltipData { text, data_url: String::new(), x, y, width, height });
    }
    open_tooltip_window_inner(&app_handle, x, y, height)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn close_tooltip_window(app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window("tooltip") {
        let _ = win.destroy();
    }
}

#[tauri::command]
fn get_tooltip_data(state: tauri::State<'_, TooltipState>) -> Option<TooltipData> {
    let lock = state.0.lock().unwrap();
    lock.clone()
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
fn open_settings_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_settings_window_inner(&app_handle).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart_enabled(app_handle: tauri::AppHandle) -> Result<bool, String> {
    app_handle
        .autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart_enabled(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
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

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let specs = tray_menu_specs();
    let capture_item = MenuItem::with_id(app, specs[0].id, specs[0].label, true, None::<&str>)?;
    let settings_state: tauri::State<AppSettingsState> = app.handle().state();
    let current_settings = settings_state.0.lock().unwrap().clone();
    let auto_translate_item = CheckMenuItem::with_id(
        app,
        specs[1].id,
        specs[1].label,
        true,
        current_settings.auto_translate,
        None::<&str>,
    )?;
    let pin_image_item = CheckMenuItem::with_id(
        app,
        specs[2].id,
        specs[2].label,
        true,
        current_settings.ocr_pin_image,
        None::<&str>,
    )?;
    let autostart_enabled = app.handle().autolaunch().is_enabled().unwrap_or(false);
    let autostart_item = CheckMenuItem::with_id(
        app,
        specs[4].id,
        specs[4].label,
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let settings_item = MenuItem::with_id(app, specs[3].id, specs[3].label, true, None::<&str>)?;
    let exit_item = MenuItem::with_id(app, specs[5].id, specs[5].label, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&capture_item, &auto_translate_item, &pin_image_item, &settings_item, &autostart_item, &exit_item],
    )?;
    {
        let tray_items: tauri::State<TraySettingsItems> = app.handle().state();
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
                if let Err(err) = trigger_capture_and_overlay(app_handle) {
                    eprintln!("Failed to trigger capture overlay: {err}");
                }
            }
            "settings" => {
                if let Err(err) = open_settings_window_inner(app_handle) {
                    eprintln!("Failed to open settings window: {err}");
                }
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
                if let Err(err) = open_settings_window_inner(tray.app_handle()) {
                    eprintln!("Failed to open settings window: {err}");
                }
            }
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
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
        .manage(CaptureState::default())
        .manage(TooltipState::default())
        .manage(SnippetCounter::default())
        .manage(SnippetStore::default())
        .manage(AppSettingsState::default())
        .manage(TraySettingsItems::default())
        .setup(|app| {
            let settings = load_settings_from_disk(app.handle());
            {
                let state: tauri::State<AppSettingsState> = app.handle().state();
                let mut lock = state.0.lock().unwrap();
                *lock = settings;
            }
            setup_tray(app)?;
            let shortcut = Shortcut::new(
                Some(tauri_plugin_global_shortcut::Modifiers::ALT),
                tauri_plugin_global_shortcut::Code::Space
            );
            app.global_shortcut().on_shortcut(shortcut, move |app_handle, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Err(e) = trigger_capture_and_overlay(app_handle) {
                        eprintln!("Failed to trigger capture overlay: {}", e);
                    }
                }
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_capture_image,
            close_overlay,
            process_crop,
            process_crop_area,
            process_crop_image_actions,
            open_tooltip_window,
            close_tooltip_window,
            get_tooltip_data,
            open_snippet_window,
            close_snippet_window,
            get_snippet_data,
            copy_image_to_clipboard,
            get_app_settings,
            update_app_settings,
            open_settings_window,
            get_autostart_enabled,
            set_autostart_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{tray_menu_specs, TooltipData};

    #[test]
    fn tooltip_data_serializes_for_frontend_contract() {
        let data = TooltipData {
            text: String::new(),
            data_url: "data:image/png;base64,AAAA".to_string(),
            x: 10,
            y: 20,
            width: 30,
            height: 40,
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
            "auto_translate",
            "ocr_pin_image",
            "settings",
            "start_with_windows",
            "exit",
        ]);
    }
}
