//! Opt-in benchmark bootstrap state; absent from release builds.
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Instant,
};
use tauri::{Emitter, Manager};

pub struct LatencyState {
    pub profile: PathBuf,
    pub transport_endpoint: Option<String>,
    pub samples: Mutex<Vec<serde_json::Value>>,
    pub trace_id: AtomicU64,
    pub started: Mutex<Instant>,
}

#[tauri::command]
pub fn latency_resources(app: tauri::AppHandle, listeners: usize, trace_id: String) {
    let state = app.state::<LatencyState>();
    let rpc = app.state::<crate::desktop::DesktopServiceState>().pending_count();
    let ocr = app.state::<crate::ocr::OcrState>().0.lock().unwrap().pending_count();
    let mailbox = usize::from(app.state::<crate::TooltipState>().1.lock().unwrap().is_some());
    state.samples.lock().unwrap().push(serde_json::json!({"stage":"resources","traceId":trace_id,"listeners":listeners,"pendingRpc":rpc,"ocrJobs":ocr,"tooltipMailbox":mailbox}));
}

#[tauri::command]
pub fn latency_event(
    app: tauri::AppHandle,
    stage: String,
    duration_ms: f64,
    trace_id: Option<String>,
) {
    if ![
        "request-error",
        "view-ready",
        "result-ready",
        "correct-paint",
        "content-verified",
        "provider",
        "ipa",
        "dictionary-load",
        "dictionary-hit",
        "dictionary-wait",
        "dictionary-miss",
        "dictionary-fetch",
        "dictionary-parse",
        "host-dispatch",
        "host-start",
        "host-rpc",
    ]
    .contains(&stage.as_str())
        || !duration_ms.is_finite()
    {
        return;
    }
    let state = app.state::<LatencyState>();
    let trace_id = trace_id.filter(|id| id.len() <= 20 && id.parse::<u64>().is_ok());
    let current = state.trace_id.load(Ordering::Acquire).to_string();
    let elapsed = state.started.lock().unwrap().elapsed().as_secs_f64() * 1000.0;
    if stage == "content-verified" {
        let _ = app.emit_to("main", "latency-content-verified", ());
    }
    if stage == "correct-paint" || stage == "request-error" {
        let _ = app.emit_to("main", "latency-painted", &stage);
    }
    state.samples.lock().unwrap().push(serde_json::json!({"traceId":trace_id,"stage":stage,"durationMs":duration_ms,"elapsedMs":if trace_id.as_deref()==Some(&current) {Some(elapsed)} else {None}}));
}
