use base64::Engine;
use std::sync::Mutex;
use tauri::{Emitter, Manager, Runtime, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct DesktopViewState(pub Mutex<Option<serde_json::Value>>);

#[tauri::command]
pub async fn open_pdf_window<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pdf") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, "pdf", tauri::WebviewUrl::App("pdf.html".into()))
        .title("PolyTranslate PDF")
        .inner_size(1080.0, 780.0)
        .min_inner_size(620.0, 400.0);
    #[cfg(feature = "latency-harness")]
    if let Some(diagnostics) = app.try_state::<crate::latency::LatencyState>() {
        builder = builder.data_directory(diagnostics.profile.clone()).initialization_script(format!(
            "globalThis.__TRANSLATION_DIAGNOSTICS__=true;globalThis.__TRANSLATION_TRACE_ID__={:?};",
            diagnostics.trace_id.load(std::sync::atomic::Ordering::Acquire).to_string()));
    }
    builder.build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_hanzi_breakdown<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, DesktopViewState>,
    character: String,
    path: Vec<String>,
    reading: String,
) -> Result<(), String> {
    if !matches!(window.label(), "tooltip" | "pdf") {
        return Err("Only a translation view may open Hanzi breakdown".into());
    }
    if character.chars().count() != 1 || path.is_empty() || path.len() > 64 {
        return Err("Invalid Hanzi breakdown".into());
    }
    let data = serde_json::json!({"character":character,"path":path,"reading":reading,"owner":window.label()});
    *state.0.lock().unwrap() = Some(data.clone());
    if let Some(window) = app.get_webview_window("hanzi-breakdown") {
        window
            .emit("hanzi-breakdown-changed", data)
            .map_err(|e| e.to_string())?;
        return window.show().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(
        &app,
        "hanzi-breakdown",
        tauri::WebviewUrl::App("hanzi.html".into()),
    )
    .title("Hanzi breakdown")
    .inner_size(480.0, 620.0)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_hanzi_breakdown_data(
    state: tauri::State<'_, DesktopViewState>,
) -> Option<serde_json::Value> {
    state.0.lock().unwrap().clone()
}

pub fn close_for_owner<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    let state = app.state::<DesktopViewState>();
    let close = state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|data| data["owner"].as_str() == Some(label));
    if close {
        *state.0.lock().unwrap() = None;
        if let Some(window) = app.get_webview_window("hanzi-breakdown") {
            let _ = window.destroy();
        }
    }
}

#[tauri::command]
pub fn close_hanzi_breakdown<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if window.label() == "hanzi-breakdown" {
        return window.destroy().map_err(|e| e.to_string());
    }
    close_for_owner(&app, window.label());
    Ok(())
}

#[tauri::command]
pub async fn pick_pdf_file(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().add_filter("PDF", &["pdf"]).blocking_pick_file() else { return Ok(None); };
        let path = file.into_path().map_err(|_| "Choose a local PDF file")?;
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if !bytes.starts_with(b"%PDF-") { return Err("The selected file is not a PDF".into()); }
        Ok(Some(serde_json::json!({"name":path.file_name().unwrap_or_default().to_string_lossy(),"data":base64::engine::general_purpose::STANDARD.encode(bytes)})))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_hanzi_backup(app: tauri::AppHandle, json: String) -> Result<bool, String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name("hanzi-learning-backup.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        std::fs::write(
            file.into_path().map_err(|_| "Choose a local destination")?,
            json,
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
