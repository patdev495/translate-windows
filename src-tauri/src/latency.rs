//! Opt-in benchmark bootstrap state; absent from release builds.
use std::{path::PathBuf, sync::{Mutex, atomic::{AtomicU64, Ordering}}, time::Instant};
use tauri::{Manager, Emitter};

pub struct LatencyState {
    pub profile: PathBuf,
    pub transport_endpoint: Option<String>,
    pub samples: Mutex<Vec<serde_json::Value>>,
    pub trace_id: AtomicU64,
    pub started: Mutex<Instant>,
}

#[tauri::command]
pub fn latency_event(app: tauri::AppHandle, stage: String, duration_ms: f64, trace_id: Option<String>) {
    if !["request-error", "view-ready", "result-ready", "correct-paint", "provider", "ipa", "dictionary-load", "dictionary-fetch", "dictionary-parse", "host-dispatch"].contains(&stage.as_str()) || !duration_ms.is_finite() { return; }
    let state = app.state::<LatencyState>();
    let current = state.trace_id.load(Ordering::Acquire).to_string();
    let elapsed = state.started.lock().unwrap().elapsed().as_secs_f64() * 1000.0;
    if stage == "correct-paint" || stage == "request-error" { let _ = app.emit_to("main", "latency-painted", &stage); }
    state.samples.lock().unwrap().push(serde_json::json!({"traceId":trace_id,"stage":stage,"durationMs":duration_ms,"elapsedMs":if trace_id.as_deref()==Some(&current) {Some(elapsed)} else {None}}));
}
