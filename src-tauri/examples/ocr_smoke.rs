//! Hidden WebView2 integration harness. Start Vite, then run:
//! cargo run --manifest-path src-tauri/Cargo.toml --example ocr_smoke
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use translation_desktop_lib::{ocr, AppSettings, AppSettingsState};

#[tauri::command]
fn get_app_settings(state: tauri::State<'_, AppSettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn smoke_settings(
    app: tauri::AppHandle,
    enabled: bool,
    tier: String,
    language: String,
) -> Result<(), String> {
    let settings = {
        let state = app.state::<AppSettingsState>();
        let mut settings = state.0.lock().unwrap();
        settings.auto_translate = enabled;
        settings.ocr_model_tier = tier;
        settings.ocr_language = language;
        settings.clone()
    };
    app.state::<ocr::OcrState>().0.lock().unwrap().configure(
        enabled,
        &settings.ocr_model_tier,
        &settings.ocr_language,
    );
    app.emit("settings-changed", settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn smoke_memory() -> Result<serde_json::Value, String> {
    use std::os::windows::process::CommandExt;
    let script = r#"
      $all = Get-CimInstance Win32_Process
      $started = (Get-Process -Id __PID__).StartTime
      $all = @($all | Where-Object { $_.CreationDate -ge $started })
      $ids = @(__PID__)
      for ($i = 0; $i -lt 5; $i++) { $ids += @($all | Where-Object { $ids -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId) }
      $processes = @(Get-Process -Id ($ids | Select-Object -Unique) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('ocr_smoke', 'msedgewebview2') })
      @{ workingSetBytes = ($processes | Measure-Object WorkingSet64 -Sum).Sum; privateBytes = ($processes | Measure-Object PrivateMemorySize64 -Sum).Sum; processCount = $processes.Count } | ConvertTo-Json -Compress
    "#.replace("__PID__", &std::process::id().to_string());
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

#[tauri::command]
fn smoke_report(app: tauri::AppHandle, result: serde_json::Value) -> Result<(), String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.scratch/persistent-ocr/runtime-results.json");
    std::fs::write(path, serde_json::to_vec_pretty(&result).unwrap())
        .map_err(|error| error.to_string())?;
    println!("OCR_SMOKE_RESULT {result}");
    app.exit(if result.get("error").is_some() { 1 } else { 0 });
    Ok(())
}

#[derive(Default)]
struct CaptureState(Mutex<Option<Capture>>);
struct Capture {
    job: serde_json::Value,
    reply: tauri::async_runtime::Sender<serde_json::Value>,
}

#[tauri::command]
async fn smoke_capture(
    app: tauri::AppHandle,
    job: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (send, mut reply) = tauri::async_runtime::channel(1);
    *app.state::<CaptureState>().0.lock().unwrap() = Some(Capture { job, reply: send });
    tauri::WebviewWindowBuilder::new(
        &app,
        "tooltip",
        tauri::WebviewUrl::External(
            "http://localhost:1420/tests/runtime/ocr-client.html"
                .parse()
                .unwrap(),
        ),
    )
    .data_directory(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.scratch/tmp/ocr-smoke-profile"),
    )
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(120), reply.recv())
        .await
        .map_err(|_| "Smoke client timed out")?
        .ok_or("Smoke client disconnected")?;
    if let Some(window) = app.get_webview_window("tooltip") {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
fn smoke_job(state: tauri::State<'_, CaptureState>) -> serde_json::Value {
    state.0.lock().unwrap().as_ref().unwrap().job.clone()
}

#[tauri::command]
fn smoke_capture_done(state: tauri::State<'_, CaptureState>, result: serde_json::Value) {
    if let Some(capture) = state.0.lock().unwrap().take() {
        let _ = capture.reply.try_send(result);
    }
}

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .manage(ocr::OcrState::default()).manage(AppSettingsState::default()).manage(CaptureState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<ocr::OcrState>().0.lock().unwrap().window_closed(window.label());
            }
        })
        .on_page_load(|webview, event| {
            if webview.label() == "main" && event.event() == tauri::webview::PageLoadEvent::Finished {
                webview.eval("import('/tests/runtime/ocr-smoke.ts').catch(e => window.__TAURI_INTERNALS__.invoke('smoke_report', {result: {error: String(e)}}))").unwrap();
            }
        })
        .setup(|app| {
            app.state::<AppSettingsState>().0.lock().unwrap().auto_translate = false;
            app.state::<ocr::OcrState>().0.lock().unwrap().configure(false, "medium", "ch");
            let profile = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.scratch/tmp/ocr-smoke-profile");
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External("http://localhost:1420".parse().unwrap()))
                .data_directory(profile).visible(false).build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_settings, smoke_settings, smoke_report, smoke_memory,
            smoke_capture, smoke_job, smoke_capture_done,
            ocr::request_ocr, ocr::ocr_host_ready, ocr::complete_ocr, ocr::cancel_ocr, ocr::ocr_progress,
        ])
        .run(context).expect("OCR smoke harness failed");
}
