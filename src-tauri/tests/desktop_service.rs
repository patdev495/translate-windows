use tauri::Listener;
use translation_desktop_lib::desktop::DesktopServiceState;

fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|value| value.deserialize().unwrap())
}

#[test]
fn a_tooltip_receives_only_the_reply_for_its_own_learning_request_from_main() {
    let app = tauri::test::mock_builder()
        .manage(DesktopServiceState::default())
        .invoke_handler(tauri::generate_handler![
            translation_desktop_lib::desktop::desktop_request,
            translation_desktop_lib::desktop::desktop_reply,
            translation_desktop_lib::desktop::desktop_service_ready
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let tooltip = tauri::WebviewWindowBuilder::new(&app, "tooltip", Default::default())
        .build()
        .unwrap();
    let (send, receive) = std::sync::mpsc::channel();
    main.listen("desktop-request", move |event| {
        send.send(event.payload().to_owned()).unwrap();
    });
    invoke(&main, "desktop_service_ready", serde_json::json!({})).unwrap();
    let request = std::thread::spawn(move || {
        invoke(
            &tooltip,
            "desktop_request",
            serde_json::json!({"message":{"type":"GET_ACCOUNT_LINK_STATUS"}}),
        )
    });
    let job: serde_json::Value = serde_json::from_str(
        &receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(job["message"]["type"], "GET_ACCOUNT_LINK_STATUS");
    invoke(&main,"desktop_reply",serde_json::json!({"id":job["id"],"response":{"success":true,"status":{"state":"unlinked"}}})).unwrap();
    assert_eq!(
        request.join().unwrap().unwrap(),
        serde_json::json!({"success":true,"status":{"state":"unlinked"}})
    );
}
