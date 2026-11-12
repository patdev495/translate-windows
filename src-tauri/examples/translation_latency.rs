//! Real production tooltip creation and HTTP/RPC, isolated synthetic profile.
#[cfg(feature = "latency-harness")]
mod harness {
    use base64::Engine;
    use std::{
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex,
        },
        time::Instant,
    };
    use tauri::Manager;
    use translation_desktop_lib::{
        desktop,
        latency::{self, LatencyState},
        ocr, AppSettings, AppSettingsState, TooltipState,
    };

    #[tauri::command]
    fn latency_memory() -> Result<serde_json::Value, String> {
        use std::os::windows::process::CommandExt;
        let script = r#"
      $all = Get-CimInstance Win32_Process
      $started = (Get-Process -Id __PID__).StartTime
      $all = @($all | Where-Object { $_.CreationDate -ge $started })
      $ids = @(__PID__)
      for ($i = 0; $i -lt 5; $i++) { $ids += @($all | Where-Object { $ids -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId) }
      $processes = @(Get-Process -Id ($ids | Select-Object -Unique) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('translation_latency', 'msedgewebview2') })
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
    async fn latency_crash_tooltip(app: tauri::AppHandle) -> Result<(), String> {
        let observed = std::sync::Arc::new(AtomicU64::new(0));
        let proof = observed.clone();
        app.get_webview_window("tooltip").ok_or("Tooltip missing")?.with_webview(move |view| unsafe {
            if let Ok(core) = view.controller().CoreWebView2() {
                let observer = webview2_com::ProcessFailedEventHandler::create(Box::new(move |_, _| {
                    proof.fetch_add(1, Ordering::AcqRel);
                    Ok(())
                }));
                let mut token = 0;
                let _ = core.add_ProcessFailed(&observer, &mut token);
                let completed = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _|Ok(())));
                let _ = core.CallDevToolsProtocolMethod(windows::core::w!("Page.crash"), windows::core::w!("{}"), &completed);
            }
        }).map_err(|e|e.to_string())?;
        for _ in 0..200 {
            if app.get_webview_window("tooltip").is_none() { return Ok(()); }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        Err(if observed.load(Ordering::Acquire)>0 { "The crashed tooltip was not retired" } else { "Crash fixture did not receive ProcessFailed" }.into())
    }
    #[tauri::command]
    async fn latency_destroy_tooltip(app: tauri::AppHandle) -> Result<(), String> {
        if let Some(window) = app.get_webview_window("tooltip") { window.destroy().map_err(|e|e.to_string())?; }
        for _ in 0..100 {
            if app.get_webview_window("tooltip").is_none() { return Ok(()); }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        Err("Tooltip was not destroyed".into())
    }
    #[tauri::command]
    fn latency_reload_host(app: tauri::AppHandle) -> Result<(), String> {
        app.get_webview_window("main")
            .ok_or("Main is missing")?
            .eval("location.reload()")
            .map_err(|error| error.to_string())
    }
    #[tauri::command]
    fn pick_pdf_file() -> serde_json::Value {
        serde_json::json!({"name":"Synthetic PDF","data":base64::engine::general_purpose::STANDARD.encode(include_bytes!("../../tests/fixtures/hello.pdf"))})
    }
    #[tauri::command]
    fn get_app_settings(state: tauri::State<'_, AppSettingsState>) -> AppSettings {
        state.0.lock().unwrap().clone()
    }
    #[tauri::command]
    async fn latency_next(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
        translation_desktop_lib::tooltip_commands::close_tooltip_window(app.clone(), None);
        let state = app.state::<LatencyState>();
        let events = std::mem::take(&mut *state.samples.lock().unwrap());
        state.trace_id.fetch_add(1, Ordering::AcqRel);
        *state.started.lock().unwrap() = Instant::now();
        Ok(
            serde_json::json!({"traceId":(state.trace_id.load(Ordering::Acquire)-1).to_string(),"events":events,"windows":app.webview_windows().len()}),
        )
    }
    #[tauri::command]
    fn latency_done(app: tauri::AppHandle, result: serde_json::Value) -> Result<(), String> {
        let path = std::env::var("LATENCY_REPORT").map_err(|e| e.to_string())?;
        std::fs::write(path, serde_json::to_vec_pretty(&result).unwrap())
            .map_err(|e| e.to_string())?;
        app.exit(if result.get("error").is_some() { 1 } else { 0 });
        Ok(())
    }
    pub fn run() {
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().build.dev_url = Some("http://127.0.0.1:1438".parse().unwrap());
        let profile = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "../.scratch/tmp/latency-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let data = desktop::DesktopData::open(profile.join("desktop-values.json")).unwrap();
        tauri::Builder::default()
            .manage(translation_desktop_lib::http_clients::HttpClients::default())
            .manage(AppSettingsState::default())
            .manage(TooltipState::default())
            .manage(translation_desktop_lib::desktop_views::DesktopViewState::default())
            .manage(desktop::DesktopDataState(Mutex::new(Some(data))))
            .manage(desktop::DesktopServiceState::default())
            .manage(ocr::OcrState::default())
            .manage(LatencyState {
                trace_id: AtomicU64::new(0),
                transport_endpoint: if std::env::var("LATENCY_REAL").is_ok() {
                    None
                } else {
                    Some("http://127.0.0.1:1438/api/translate".into())
                },
                profile: profile.clone(),
                samples: Mutex::default(),
                started: Mutex::new(Instant::now()),
            })
            .on_page_load(|view, event| {
                if view.label() == "main" && event.event() == tauri::webview::PageLoadEvent::Started
                {
                    translation_desktop_lib::tooltip_commands::close_tooltip_window(view.app_handle().clone(), None);
                    view.state::<desktop::DesktopServiceState>().disconnected();
                    view.state::<ocr::OcrState>()
                        .0
                        .lock()
                        .unwrap()
                        .main_reloading();
                }
                if event.event() == tauri::webview::PageLoadEvent::Finished {
                    view.eval(&format!(
                        "import('/latency-driver.mjs').then(m=>m.run({:?}))",
                        view.label()
                    ))
                    .unwrap();
                }
            })
            .setup(move |app| {
                {
                    let state = app.state::<AppSettingsState>();
                    let mut s = state.0.lock().unwrap();
                    s.auto_translate = std::env::var("LATENCY_OCR").is_ok();
                    s.ocr_language = if s.auto_translate {
                        "latin".into()
                    } else {
                        "ch".into()
                    };
                    s.auto_selection_translate = false;
                    s.tts_enabled = false;
                    s.provider =
                        std::env::var("LATENCY_PROVIDER").unwrap_or_else(|_| "deepl-free".into());
                }
                app.state::<ocr::OcrState>().0.lock().unwrap().configure(
                    std::env::var("LATENCY_OCR").is_ok(),
                    "medium",
                    if std::env::var("LATENCY_OCR").is_ok() {
                        "latin"
                    } else {
                        "ch"
                    },
                );
                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .data_directory(profile)
                .visible(false)
                .initialization_script("globalThis.__TRANSLATION_DIAGNOSTICS__=true;")
                .build()?;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(180));
                    handle.exit(2);
                });
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                get_app_settings,
                latency_reload_host,
                latency_destroy_tooltip,
                latency_crash_tooltip,
                latency_next,
                latency_done,
                latency_memory,
                pick_pdf_file,
                translation_desktop_lib::desktop_views::open_pdf_window,
                latency::latency_event,
                latency::latency_resources,
                translation_desktop_lib::tooltip_commands::open_tooltip_window,
                translation_desktop_lib::tooltip_commands::get_tooltip_data,
                translation_desktop_lib::tooltip_commands::layout_tooltip_window,
                translation_desktop_lib::tooltip_commands::translate_tooltip_request,
                translation_desktop_lib::tooltip_commands::close_tooltip_window,
                translation_desktop_lib::tooltip_commands::dismiss_tooltip_if_external,
                desktop::desktop_http,
                desktop::get_desktop_values,
                desktop::set_desktop_values,
                desktop::desktop_request,
                desktop::desktop_reply,
                desktop::desktop_service_ready,
                ocr::request_ocr,
                ocr::cancel_ocr,
                ocr::ocr_host_ready,
                ocr::complete_ocr,
                ocr::ocr_progress
            ])
            .run(context)
            .expect("latency harness failed");
    }
}
fn main() {
    #[cfg(feature = "latency-harness")]
    harness::run();
    #[cfg(not(feature = "latency-harness"))]
    panic!("Enable latency-harness");
}
