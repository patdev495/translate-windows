use std::sync::Mutex;
use translation_desktop_lib::ocr::*;

fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize().unwrap())
}

#[test]
fn request_before_host_ready_receives_its_own_result() {
    let mut broker = OcrBroker::default();
    let (mut response, job) = broker
        .request(
            "tooltip",
            "capture-1",
            "data:image/png;base64,AA==",
            "medium",
            "ch",
        )
        .unwrap();
    assert!(job.is_none());
    let job = broker.ready("main", "host-1").unwrap().unwrap();
    assert_eq!(job.data_url, "data:image/png;base64,AA==");
    broker
        .complete(
            "main",
            &job.generation,
            &job.job_id,
            Ok(OcrResult {
                full_text: "你好".into(),
                blocks: vec![],
            }),
        )
        .unwrap();
    assert_eq!(response.try_recv().unwrap().unwrap().full_text, "你好");
}

#[test]
fn explicit_pdf_ocr_is_available_when_screen_crop_auto_translation_is_off() {
    let mut broker = OcrBroker::default();
    broker.configure(false,"medium","ch");
    broker.ready("main","host").unwrap();
    let (_response,job) = broker.request("pdf","page-region","image","medium","ch").unwrap();
    let delivered=serde_json::to_value(job.unwrap()).unwrap();
    assert_eq!(delivered["allowDisabled"],true);
    assert!(broker.request("tooltip","capture","image","medium","ch").is_err());
}

#[test]
fn queue_is_bounded_and_completion_dispatches_the_next_capture() {
    let mut broker = OcrBroker::default();
    broker.ready("main", "host-1").unwrap();
    let (_first, first) = broker
        .request("tooltip", "one", "image-one", "medium", "ch")
        .unwrap();
    let (_second, second) = broker
        .request("overlay", "two", "image-two", "medium", "ch")
        .unwrap();
    assert!(second.is_none());
    assert!(broker
        .request("tooltip", "three", "image-three", "medium", "ch")
        .is_err());
    let first = first.unwrap();
    let next = broker
        .complete(
            "main",
            "host-1",
            &first.job_id,
            Ok(OcrResult {
                full_text: "one".into(),
                blocks: vec![],
            }),
        )
        .unwrap()
        .unwrap();
    assert_eq!(next.data_url, "image-two");
}

#[test]
fn canceling_a_capture_does_not_free_the_running_slot_or_deliver_its_result_to_a_new_tooltip() {
    let mut broker = OcrBroker::default();
    broker.ready("main", "host").unwrap();
    let (mut old_reply, old) = broker
        .request("tooltip", "old", "old-image", "medium", "ch")
        .unwrap();
    broker.cancel("tooltip", "old", "OCR canceled");
    assert_eq!(old_reply.try_recv().unwrap().unwrap_err(), "OCR canceled");
    let (mut new_reply, new) = broker
        .request("tooltip", "new", "new-image", "medium", "ch")
        .unwrap();
    assert!(new.is_none());
    let old = old.unwrap();
    let new = broker
        .complete(
            "main",
            "host",
            &old.job_id,
            Ok(OcrResult {
                full_text: "old text".into(),
                blocks: vec![],
            }),
        )
        .unwrap()
        .unwrap();
    assert_eq!(new.data_url, "new-image");
    assert!(new_reply.try_recv().is_err());
    broker
        .complete(
            "main",
            "host",
            &old.job_id,
            Ok(OcrResult {
                full_text: "duplicate old".into(),
                blocks: vec![],
            }),
        )
        .unwrap();
    assert!(new_reply.try_recv().is_err());
    broker
        .complete(
            "main",
            "host",
            &new.job_id,
            Ok(OcrResult {
                full_text: "new text".into(),
                blocks: vec![],
            }),
        )
        .unwrap();
    assert_eq!(new_reply.try_recv().unwrap().unwrap().full_text, "new text");
}

#[test]
fn only_main_can_register_or_complete_ocr_work() {
    let mut broker = OcrBroker::default();
    assert!(broker.ready("tooltip", "fake").is_err());
    broker.ready("main", "host").unwrap();
    let (mut reply, job) = broker
        .request("tooltip", "one", "image", "medium", "ch")
        .unwrap();
    let job = job.unwrap();
    assert!(broker
        .complete(
            "tooltip",
            "host",
            &job.job_id,
            Ok(OcrResult {
                full_text: "forged".into(),
                blocks: vec![]
            })
        )
        .is_err());
    assert!(reply.try_recv().is_err());
}

#[test]
fn host_restart_fails_old_requests_and_ignores_old_completions() {
    let mut broker = OcrBroker::default();
    broker.ready("main", "old-host").unwrap();
    let (mut old_reply, old) = broker
        .request("tooltip", "one", "old", "tiny", "ch")
        .unwrap();
    broker.ready("main", "new-host").unwrap();
    assert!(old_reply.try_recv().unwrap().unwrap_err().contains("host"));
    let (mut reply, new) = broker
        .request("tooltip", "two", "new", "tiny", "ch")
        .unwrap();
    assert!(new.is_some());
    broker
        .complete(
            "main",
            "old-host",
            &old.unwrap().job_id,
            Ok(OcrResult {
                full_text: "stale".into(),
                blocks: vec![],
            }),
        )
        .unwrap();
    assert!(reply.try_recv().is_err());
}

#[test]
fn tauri_command_uses_the_actual_caller_window_for_host_authorization() {
    let app = tauri::test::mock_builder()
        .manage(OcrState::default())
        .invoke_handler(tauri::generate_handler![ocr_host_ready])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let tooltip = tauri::WebviewWindowBuilder::new(&app, "tooltip", Default::default())
        .build()
        .unwrap();
    let response = tauri::test::get_ipc_response(
        &tooltip,
        tauri::webview::InvokeRequest {
            cmd: "ocr_host_ready".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(
                serde_json::json!({ "generation": "forged", "caller": "main" }),
            ),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    );
    assert!(response
        .unwrap_err()
        .as_str()
        .unwrap()
        .contains("Only main"));
}

#[test]
fn disabling_ocr_cancels_waiting_work_and_rejects_new_captures() {
    let mut broker = OcrBroker::default();
    broker.ready("main", "host").unwrap();
    let (mut active, _) = broker
        .request("tooltip", "one", "one", "medium", "ch")
        .unwrap();
    let (mut queued, _) = broker
        .request("overlay", "two", "two", "medium", "ch")
        .unwrap();
    broker.configure(false, "medium", "ch");
    assert!(active.try_recv().unwrap().is_err());
    assert!(queued.try_recv().unwrap().is_err());
    assert!(broker
        .request("tooltip", "three", "three", "medium", "ch")
        .is_err());
    broker.configure(true, "small", "latin");
    assert!(broker
        .request("tooltip", "four", "four", "medium", "ch")
        .is_err());
    assert!(broker
        .request("tooltip", "five", "five", "small", "latin")
        .is_ok());
}

#[test]
fn tauri_request_times_out_without_a_host_and_frees_its_waiting_slot() {
    let app = tauri::test::mock_builder()
        .manage(OcrState(
            Mutex::new(OcrBroker::default()),
            std::time::Duration::from_millis(5),
        ))
        .invoke_handler(tauri::generate_handler![request_ocr])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let tooltip = tauri::WebviewWindowBuilder::new(&app, "tooltip", Default::default())
        .build()
        .unwrap();
    for request_id in ["one", "two"] {
        let response = tauri::test::get_ipc_response(
            &tooltip,
            tauri::webview::InvokeRequest {
                cmd: "request_ocr".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({ "request": {
                "requestId": request_id, "dataUrl": "data:image/png;base64,AA==", "tier": "medium", "language": "ch"
            } })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        );
        assert!(response
            .unwrap_err()
            .as_str()
            .unwrap()
            .contains("timed out"));
    }
}

#[test]
fn tauri_request_returns_the_result_completed_by_main() {
    use tauri::Listener;
    let app = tauri::test::mock_builder()
        .manage(OcrState::default())
        .invoke_handler(tauri::generate_handler![
            request_ocr,
            ocr_host_ready,
            complete_ocr
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let tooltip = tauri::WebviewWindowBuilder::new(&app, "tooltip", Default::default())
        .build()
        .unwrap();
    let (send, jobs) = std::sync::mpsc::channel();
    main.listen("ocr-job", move |event| {
        send.send(event.payload().to_string()).unwrap();
    });
    invoke(
        &main,
        "ocr_host_ready",
        serde_json::json!({ "generation": "host" }),
    )
    .unwrap();
    let pending = std::thread::spawn(move || {
        invoke(
            &tooltip,
            "request_ocr",
            serde_json::json!({ "request": {
        "requestId": "capture", "dataUrl": "data:image/png;base64,AA==", "tier": "medium", "language": "ch"
    } }),
        )
    });
    let job: serde_json::Value = serde_json::from_str(
        &jobs
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap(),
    )
    .unwrap();
    invoke(&main, "complete_ocr", serde_json::json!({
        "generation": "host", "jobId": job["jobId"], "result": { "fullText": "hello", "blocks": [] }, "error": null
    })).unwrap();
    assert_eq!(pending.join().unwrap().unwrap()["fullText"], "hello");
}

#[test]
fn closing_the_requesting_window_cancels_its_work_and_stops_its_progress() {
    let mut broker = OcrBroker::default();
    broker.ready("main", "host").unwrap();
    let (mut reply, job) = broker
        .request("tooltip", "capture", "image", "medium", "ch")
        .unwrap();
    let job = job.unwrap();
    assert_eq!(
        broker.progress_target("main", "host", &job.job_id).unwrap(),
        Some(("tooltip".into(), "capture".into()))
    );
    assert!(broker
        .progress_target("tooltip", "host", &job.job_id)
        .is_err());
    broker.window_closed("tooltip");
    assert!(reply.try_recv().unwrap().is_err());
    assert_eq!(
        broker.progress_target("main", "host", &job.job_id).unwrap(),
        None
    );
}
