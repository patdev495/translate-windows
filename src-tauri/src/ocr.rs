use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::async_runtime::{channel, Receiver, Sender};
use tauri::{Emitter, Manager};

pub struct OcrState(pub Mutex<OcrBroker>, pub std::time::Duration);

impl Default for OcrState {
    fn default() -> Self {
        Self(
            Mutex::new(OcrBroker::default()),
            std::time::Duration::from_secs(120),
        )
    }
}

fn dispatch_job<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    job: Option<OcrJob>,
) -> Result<(), String> {
    if let Some(job) = job {
        if let Err(err) = app.emit_to("main", "ocr-job", job) {
            app.state::<OcrState>().0.lock().unwrap().host_lost();
            return Err(format!("OCR host unavailable: {err}"));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ocr_host_ready<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, OcrState>,
    generation: String,
) -> Result<(), String> {
    let job = state.0.lock().unwrap().ready(window.label(), &generation)?;
    dispatch_job(&app, job)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRequest {
    pub request_id: String,
    pub data_url: String,
    pub tier: String,
    pub language: String,
}

#[tauri::command]
pub async fn request_ocr<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, OcrState>,
    request: OcrRequest,
) -> Reply {
    if app.try_state::<crate::AppSettingsState>().is_some_and(|state| !state.0.lock().unwrap().translation_active) {
        return Err("Translation is disabled".into());
    }
    let OcrRequest {
        request_id,
        data_url,
        tier,
        language,
    } = request;
    let (mut receiver, job) = state.0.lock().unwrap().request(
        window.label(),
        &request_id,
        &data_url,
        &tier,
        &language,
    )?;
    drop(data_url);
    dispatch_job(&app, job)?;
    match tokio::time::timeout(state.1, receiver.recv()).await {
        Ok(Some(result)) => result,
        Ok(None) => Err("OCR host disconnected.".into()),
        Err(_) => {
            state.0.lock().unwrap().cancel(
                window.label(),
                &request_id,
                "OCR timed out. Capture again.",
            );
            Err("OCR timed out. Capture again.".into())
        }
    }
}

#[tauri::command]
pub fn complete_ocr<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, OcrState>,
    generation: String,
    job_id: String,
    result: Option<OcrResult>,
    error: Option<String>,
) -> Result<(), String> {
    let result = error.map_or_else(
        || result.ok_or_else(|| "OCR returned no result.".into()),
        Err,
    );
    let job = state
        .0
        .lock()
        .unwrap()
        .complete(window.label(), &generation, &job_id, result)?;
    dispatch_job(&app, job)
}

#[tauri::command]
pub fn cancel_ocr(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OcrState>,
    request_id: String,
) {
    state
        .0
        .lock()
        .unwrap()
        .cancel(window.label(), &request_id, "OCR canceled.");
}

#[derive(Clone, Serialize, Deserialize)]
pub struct OcrProgress {
    pub stage: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    request_id: String,
    progress: OcrProgress,
}

#[tauri::command]
pub fn ocr_progress<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, OcrState>,
    generation: String,
    job_id: String,
    progress: OcrProgress,
) -> Result<(), String> {
    let target = state
        .0
        .lock()
        .unwrap()
        .progress_target(window.label(), &generation, &job_id)?;
    if let Some((label, request_id)) = target {
        app.emit_to(
            label,
            "ocr-progress",
            ProgressEvent {
                request_id,
                progress,
            },
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub full_text: String,
    pub blocks: Vec<OcrBlock>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OcrBlock {
    pub text: String,
    pub bbox: OcrBox,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OcrBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrJob {
    pub job_id: String,
    pub generation: String,
    pub data_url: String,
    pub tier: String,
    pub language: String,
    pub allow_disabled: bool,
}

type Reply = Result<OcrResult, String>;
struct Pending {
    job: OcrJob,
    caller: String,
    request_id: String,
    reply: Option<Sender<Reply>>,
}

#[derive(Default)]
pub struct OcrBroker {
    generation: Option<String>,
    next_id: u64,
    waiting: VecDeque<Pending>,
    active: Option<Pending>,
    disabled: bool,
    model_key: Option<(String, String)>,
}

impl OcrBroker {
    #[cfg(feature = "latency-harness")]
    pub fn pending_count(&self) -> usize { self.waiting.len() + usize::from(self.active.is_some()) }
    pub fn request(
        &mut self,
        caller: &str,
        request_id: &str,
        data_url: &str,
        tier: &str,
        language: &str,
    ) -> Result<(Receiver<Reply>, Option<OcrJob>), String> {
        if self.disabled && caller != "pdf" {
            return Err("Automatic translation is disabled.".into());
        }
        if self
            .model_key
            .as_ref()
            .is_some_and(|key| key.0 != tier || key.1 != language)
        {
            return Err("OCR settings changed. Capture again.".into());
        }
        if !self.waiting.is_empty() {
            return Err("OCR is busy. Try again after the current capture.".into());
        }
        let (reply, receiver) = channel(1);
        self.next_id += 1;
        self.waiting.push_back(Pending {
            job: OcrJob {
                job_id: self.next_id.to_string(),
                generation: String::new(),
                data_url: data_url.into(),
                tier: tier.into(),
                language: language.into(),
                allow_disabled: caller == "pdf",
            },
            caller: caller.into(),
            request_id: request_id.into(),
            reply: Some(reply),
        });
        Ok((receiver, self.dispatch()))
    }

    pub fn ready(&mut self, caller: &str, generation: &str) -> Result<Option<OcrJob>, String> {
        if caller != "main" {
            return Err("Only main can own the OCR host.".into());
        }
        if self
            .generation
            .as_deref()
            .is_some_and(|old| old != generation)
        {
            self.host_lost();
        }
        self.generation = Some(generation.into());
        Ok(self.dispatch())
    }

    pub fn complete(
        &mut self,
        caller: &str,
        generation: &str,
        job_id: &str,
        result: Reply,
    ) -> Result<Option<OcrJob>, String> {
        if caller != "main" {
            return Err("Only main can complete OCR work.".into());
        }
        if self.active.as_ref().is_some_and(|active| {
            active.job.job_id == job_id && active.job.generation == generation
        }) {
            let active = self.active.take().unwrap();
            if let Some(reply) = active.reply {
                let _ = reply.try_send(result);
            }
        }
        Ok(self.dispatch())
    }

    pub fn cancel(&mut self, caller: &str, request_id: &str, reason: &str) {
        if let Some(index) = self
            .waiting
            .iter()
            .position(|job| job.caller == caller && job.request_id == request_id)
        {
            let mut pending = self.waiting.remove(index).unwrap();
            if let Some(reply) = pending.reply.take() {
                let _ = reply.try_send(Err(reason.into()));
            }
        }
        if let Some(active) = self
            .active
            .as_mut()
            .filter(|job| job.caller == caller && job.request_id == request_id)
        {
            if let Some(reply) = active.reply.take() {
                let _ = reply.try_send(Err(reason.into()));
            }
        }
    }

    pub fn host_lost(&mut self) {
        self.generation = None;
        for mut pending in self.active.take().into_iter().chain(self.waiting.drain(..)) {
            if let Some(reply) = pending.reply.take() {
                let _ = reply.try_send(Err("OCR host disconnected. Try capturing again.".into()));
            }
        }
    }

    pub fn main_reloading(&mut self) {
        if self.generation.is_some() {
            self.host_lost();
        }
    }

    pub fn configure(&mut self, enabled: bool, tier: &str, language: &str) {
        let key = (tier.to_string(), language.to_string());
        if !enabled || self.model_key.as_ref().is_some_and(|old| old != &key) {
            for pending in self.active.iter_mut().chain(self.waiting.iter_mut()) {
                if let Some(reply) = pending.reply.take() {
                    let _ = reply.try_send(Err("OCR settings changed. Capture again.".into()));
                }
            }
            self.waiting.clear();
        }
        self.disabled = !enabled;
        self.model_key = Some(key);
    }

    pub fn window_closed(&mut self, label: &str) {
        if label == "main" {
            self.host_lost();
            return;
        }
        let requests: Vec<_> = self
            .active
            .iter()
            .chain(self.waiting.iter())
            .filter(|pending| pending.caller == label)
            .map(|pending| pending.request_id.clone())
            .collect();
        for request_id in requests {
            self.cancel(label, &request_id, "OCR window closed.");
        }
    }

    pub fn progress_target(
        &self,
        caller: &str,
        generation: &str,
        job_id: &str,
    ) -> Result<Option<(String, String)>, String> {
        if caller != "main" {
            return Err("Only main can report OCR progress.".into());
        }
        Ok(self
            .active
            .as_ref()
            .filter(|pending| {
                pending.job.job_id == job_id
                    && pending.job.generation == generation
                    && pending.reply.is_some()
            })
            .map(|pending| (pending.caller.clone(), pending.request_id.clone())))
    }

    fn dispatch(&mut self) -> Option<OcrJob> {
        if self.active.is_some() {
            return None;
        }
        let generation = self.generation.as_ref()?;
        let mut pending = self.waiting.pop_front()?;
        pending.job.generation = generation.clone();
        let data_url = std::mem::take(&mut pending.job.data_url);
        let job = OcrJob {
            data_url,
            ..pending.job.clone()
        };
        self.active = Some(pending);
        Some(job)
    }
}
