use std::sync::Mutex;
use std::io::Cursor;
use tauri::{Manager, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose};
use image::{ImageEncoder, codecs::png::PngEncoder};

#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<String>>);

fn capture_active_screen() -> Result<(Vec<u8>, u32, u32), String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;
    // Capture the first monitor (or primary screen)
    let screen = screens.into_iter().next().ok_or("No screens found")?;
    let image = screen.capture().map_err(|e| e.to_string())?;
    let width = image.width();
    let height = image.height();
    let raw_pixels = image.into_raw();
    let mut png_bytes: Vec<u8> = Vec::new();
    let encoder = PngEncoder::new(Cursor::new(&mut png_bytes));
    encoder
        .write_image(&raw_pixels, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok((png_bytes, width, height))
}

fn trigger_capture_and_overlay(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (img_bytes, _width, _height) = capture_active_screen()?;
    let base64_image = general_purpose::STANDARD.encode(&img_bytes);
    let data_url = format!("data:image/png;base64,{}", base64_image);

    let state: tauri::State<CaptureState> = app_handle.state();
    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(data_url);
    }

    if let Some(existing) = app_handle.get_webview_window("overlay") {
        let _ = existing.destroy();
    }

    let _overlay_win = WebviewWindowBuilder::new(
        app_handle,
        "overlay",
        tauri::WebviewUrl::App("index.html".into())
    )
    .title("Selection Overlay")
    .fullscreen(true)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .build()?;

    Ok(())
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(CaptureState::default())
        .setup(|app| {
            let shortcut = Shortcut::new(
                Some(tauri_plugin_global_shortcut::Modifiers::CONTROL),
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
        .invoke_handler(tauri::generate_handler![get_capture_image, close_overlay])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
