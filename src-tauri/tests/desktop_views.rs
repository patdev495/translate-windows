use tauri::Manager;

#[test]
fn opening_the_desktop_pdf_reader_reuses_its_window_and_keeps_main_running() {
    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![
            translation_desktop_lib::desktop_views::open_pdf_window
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for _ in 0..2 {
        tauri::test::get_ipc_response(
            &main,
            tauri::webview::InvokeRequest {
                cmd: "open_pdf_window".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({})),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap();
    }
    assert!(app.get_webview_window("pdf").is_some());
    assert_eq!(app.webview_windows().len(), 2);
}
