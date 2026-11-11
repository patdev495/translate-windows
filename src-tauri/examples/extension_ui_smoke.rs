//! Run via `npm run test:ui`. Uses built assets, a separate profile and synthetic data only.
use base64::Engine;
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, Manager};
use translation_desktop_lib::{desktop, ocr, AppSettings, AppSettingsState};

#[derive(Default)]
struct Smoke {
    reports: Mutex<HashMap<String, serde_json::Value>>,
    clipboard: Mutex<String>,
    breakdown: Mutex<serde_json::Value>,
    link: Mutex<(bool, bool)>,
}

// OS/browser and remote HTTP boundaries only; account/RPC/storage stay production code.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if url == "https://example.test/?link=smoke-request" {
        Ok(())
    } else {
        Err("Smoke test must not open a real website".into())
    }
}
#[tauri::command]
fn smoke_approve_link(state: tauri::State<'_, Smoke>) {
    state.link.lock().unwrap().0 = true;
}
#[tauri::command]
fn desktop_http(state: tauri::State<'_, Smoke>, url: String) -> Result<serde_json::Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    let account = serde_json::json!({"id":"smoke-learner","username":"Synthetic learner"});
    let (status, body) = match parsed.path() {
        "/api/link/start" => {
            *state.link.lock().unwrap() = (false, false);
            let expires = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 300;
            (
                200,
                serde_json::json!({"request_id":"smoke-request","poll_secret":"synthetic","approve_url":"https://example.test/?link=smoke-request","expires_at":expires}),
            )
        }
        "/api/link/poll" => {
            let mut link = state.link.lock().unwrap();
            if link.1 {
                (
                    410,
                    serde_json::json!({"detail":"Link request expired or used"}),
                )
            } else if link.0 {
                link.1 = true;
                (
                    200,
                    serde_json::json!({"state":"linked","token":"synthetic-token","account":account}),
                )
            } else {
                (200, serde_json::json!({"state":"pending"}))
            }
        }
        "/api/extension/me" => (200, account),
        "/api/extension/folders" => (200, serde_json::json!([])),
        _ => return Err(format!("Unexpected smoke HTTP path: {}", parsed.path())),
    };
    Ok(serde_json::json!({"status":status,"body":body.to_string()}))
}
fn profile() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../.scratch/tmp/extension-ui-smoke-{}",
        std::process::id()
    ))
}
fn open(app: &tauri::AppHandle, label: &str, path: &str) -> Result<(), String> {
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::External(format!("http://127.0.0.1:1438/{path}").parse().unwrap()),
    );
    if label == "tooltip" {
        builder = builder.decorations(false).shadow(false).transparent(true).resizable(false);
    }
    builder.inner_size(1080.0, 780.0)
    .data_directory(profile())
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}
#[tauri::command]
fn get_app_settings(state: tauri::State<'_, AppSettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}
#[tauri::command]
fn update_app_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    patch: serde_json::Value,
) -> AppSettings {
    let mut lock = state.0.lock().unwrap();
    let mut value = serde_json::to_value(&*lock).unwrap();
    value
        .as_object_mut()
        .unwrap()
        .extend(patch.as_object().unwrap().clone());
    *lock = serde_json::from_value(value).unwrap();
    let settings = lock.clone();
    drop(lock);
    app.emit("settings-changed", settings.clone()).unwrap();
    settings
}
#[tauri::command]
fn get_autostart_enabled() -> bool {
    false
}
#[tauri::command]
fn set_autostart_enabled() {}
#[tauri::command]
fn set_shortcut_capture() {}
#[tauri::command]
fn get_tooltip_data() -> serde_json::Value {
    serde_json::json!({"text":"你好","translationData":{"detectedLang":"zh","sourcePhonetics":"你好 nǐ hǎo","translations":[{"lang":"vi","text":"xin chào","phonetics":""}]}})
}
#[tauri::command]
fn pick_pdf_file() -> serde_json::Value {
    serde_json::json!({"name":"Synthetic PDF","data":base64::engine::general_purpose::STANDARD.encode(include_bytes!("../../tests/fixtures/hello.pdf"))})
}
#[tauri::command]
fn copy_text_to_clipboard(state: tauri::State<'_, Smoke>, text: String) {
    *state.clipboard.lock().unwrap() = text;
}
#[tauri::command]
fn smoke_clipboard(state: tauri::State<'_, Smoke>) -> String {
    state.clipboard.lock().unwrap().clone()
}
#[tauri::command]
async fn open_hanzi_breakdown(
    app: tauri::AppHandle,
    state: tauri::State<'_, Smoke>,
    character: String,
    path: Vec<String>,
    reading: String,
) -> Result<(), String> {
    *state.breakdown.lock().unwrap() =
        serde_json::json!({"character":character,"path":path,"reading":reading});
    if app.get_webview_window("hanzi-breakdown").is_none() {
        open(&app, "hanzi-breakdown", "hanzi.html")?;
    }
    Ok(())
}
#[tauri::command]
fn get_hanzi_breakdown_data(state: tauri::State<'_, Smoke>) -> serde_json::Value {
    state.breakdown.lock().unwrap().clone()
}
#[tauri::command]
fn close_hanzi_breakdown() {}
#[tauri::command]
fn close_tooltip_window() {}
#[tauri::command]
fn dismiss_tooltip_if_external() {}
#[tauri::command]
async fn smoke_page_done(
    app: tauri::AppHandle,
    state: tauri::State<'_, Smoke>,
    label: String,
    result: serde_json::Value,
) -> Result<(), String> {
    let failed = result.get("error").is_some();
    println!("UI_SMOKE_PAGE {label}: {result}");
    state.reports.lock().unwrap().insert(label.clone(), result);
    if !failed {
        match label.as_str() {
            "main" => open(&app, "settings", "settings.html")?,
            "settings" => open(&app, "pdf", "pdf.html")?,
            "pdf" => open(&app, "tooltip", "tooltip.html")?,
            _ => {}
        }
    }
    if failed || state.reports.lock().unwrap().len() == 5 {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.scratch/extension-parity/ui-smoke-results.json");
        std::fs::write(
            path,
            serde_json::to_vec_pretty(&*state.reports.lock().unwrap()).unwrap(),
        )
        .map_err(|error| error.to_string())?;
        app.exit(if failed { 1 } else { 0 });
    }
    Ok(())
}
fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1438".parse().unwrap());
    let data = desktop::DesktopData::open(profile().join("desktop-values.json")).unwrap();
    tauri::Builder::default().manage(AppSettingsState::default()).manage(Smoke::default())
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("opener").invoke_handler(tauri::generate_handler![open_url]).build())
        .manage(desktop::DesktopDataState(Mutex::new(Some(data)))).manage(desktop::DesktopServiceState::default()).manage(ocr::OcrState::default())
        .on_page_load(|view,event| { if event.event()==tauri::webview::PageLoadEvent::Finished {
            view.eval(&format!("import('/smoke-driver.mjs').then(m=>m.verify({:?})).catch(e=>window.__TAURI_INTERNALS__.invoke('smoke_page_done',{{label:{:?},result:{{error:String(e)}}}}))",view.label(),view.label())).unwrap();
        } })
        .setup(|app| {
            { let state=app.state::<AppSettingsState>(); let mut settings=state.0.lock().unwrap(); settings.auto_translate=false; settings.auto_selection_translate=false; settings.hanzi_breakdown_enabled=true; settings.hanzi_breakdown_language="en".into(); settings.tts_enabled=false; }
            app.state::<ocr::OcrState>().0.lock().unwrap().configure(false,"medium","ch");
            open(app.handle(),"main","")?;
            let handle=app.handle().clone();
            std::thread::spawn(move|| { std::thread::sleep(std::time::Duration::from_secs(100)); handle.exit(2); });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_app_settings,update_app_settings,get_autostart_enabled,set_autostart_enabled,set_shortcut_capture,
            get_tooltip_data,pick_pdf_file,copy_text_to_clipboard,smoke_clipboard,open_hanzi_breakdown,get_hanzi_breakdown_data,close_hanzi_breakdown,close_tooltip_window,dismiss_tooltip_if_external,smoke_page_done,desktop_http,smoke_approve_link,
            desktop::get_desktop_values,desktop::set_desktop_values,desktop::desktop_request,desktop::desktop_reply,desktop::desktop_service_ready,
            ocr::request_ocr,ocr::ocr_host_ready,ocr::complete_ocr,ocr::cancel_ocr,ocr::ocr_progress])
        .run(context).expect("UI smoke failed");
}
