//! Persistent desktop data shared by disposable application windows.
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, Runtime};

pub struct DesktopData {
    path: PathBuf,
    values: Mutex<Map<String, Value>>,
}
impl DesktopData {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let values = match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|error| format!("Cannot read desktop data: {error}"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
            Err(error) => return Err(error.to_string()),
        };
        Ok(Self {
            path,
            values: Mutex::new(values),
        })
    }
    pub fn get(&self, keys: Option<Vec<String>>) -> Result<Value, String> {
        let values = self.values.lock().map_err(|_| "Desktop data is busy")?;
        Ok(Value::Object(match keys {
            None => values.clone(),
            Some(keys) => keys
                .into_iter()
                .filter_map(|key| values.get(&key).map(|value| (key, value.clone())))
                .collect(),
        }))
    }
    pub fn set(&self, patch: Map<String, Value>) -> Result<Value, String> {
        let mut values = self.values.lock().map_err(|_| "Desktop data is busy")?;
        let mut updated = values.clone();
        let mut changes = Map::new();
        for (key, value) in patch {
            changes.insert(
                key.clone(),
                serde_json::json!({ "oldValue": values.get(&key), "newValue": value }),
            );
            updated.insert(key, value);
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temporary = self.path.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec(&updated).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *values = updated;
        Ok(Value::Object(changes))
    }
}

#[derive(Default)]
pub struct DesktopDataState(pub Mutex<Option<DesktopData>>);

fn with_store<R: Runtime, T>(
    app: &tauri::AppHandle<R>,
    state: &DesktopDataState,
    operation: impl FnOnce(&DesktopData) -> Result<T, String>,
) -> Result<T, String> {
    let mut store = state.0.lock().map_err(|_| "Desktop data is busy")?;
    if store.is_none() {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("desktop-values.json");
        *store = Some(DesktopData::open(path)?);
    }
    operation(store.as_ref().unwrap())
}

#[tauri::command]
pub fn get_desktop_values<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, DesktopDataState>,
    keys: Option<Value>,
) -> Result<Value, String> {
    let keys = match keys {
        None | Some(Value::Null) => None,
        Some(Value::String(key)) => Some(vec![key]),
        Some(Value::Array(keys)) => Some(
            keys.into_iter()
                .map(|key| {
                    key.as_str()
                        .map(str::to_string)
                        .ok_or("Invalid desktop data key")
                })
                .collect::<Result<_, _>>()?,
        ),
        _ => return Err("Invalid desktop data keys".into()),
    };
    with_store(&app, &state, |store| store.get(keys))
}

#[tauri::command]
pub fn set_desktop_values<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, DesktopDataState>,
    values: Map<String, Value>,
) -> Result<(), String> {
    let changes = with_store(&app, &state, |store| store.set(values))?;
    app.emit("desktop-values-changed", changes)
        .map_err(|e| e.to_string())
}

#[derive(Default)]
pub struct DesktopServiceState {
    ready: AtomicBool,
    sequence: AtomicU64,
    pending: Mutex<HashMap<String, (String, tauri::async_runtime::Sender<Value>)>>,
}
impl DesktopServiceState {
    pub fn disconnected(&self) {
        self.ready.store(false, Ordering::Release);
        for (_, (_, reply)) in self.pending.lock().unwrap().drain() {
            let _ = reply.try_send(serde_json::json!({ "success":false,"error":"Desktop host restarted. Please try again." }));
        }
    }
    pub fn window_closed(&self, label: &str) {
        self.pending
            .lock()
            .unwrap()
            .retain(|_, (caller, _)| caller != label);
    }
}

#[tauri::command]
pub fn desktop_service_ready<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, DesktopServiceState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only main may own the desktop host".into());
    }
    state.ready.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub async fn desktop_request<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, DesktopServiceState>,
    message: Value,
) -> Result<Value, String> {
    if !message.is_object() {
        return Err("Invalid desktop request".into());
    }
    let started = std::time::Instant::now();
    while !state.ready.load(Ordering::Acquire) {
        if started.elapsed() > Duration::from_secs(10) {
            return Err("Desktop host is not ready. Please try again.".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let id = state.sequence.fetch_add(1, Ordering::AcqRel).to_string();
    let (reply, mut receiver) = tauri::async_runtime::channel(1);
    {
        let mut pending = state.pending.lock().unwrap();
        if pending.len() >= 32 {
            return Err("Desktop host is busy".into());
        }
        pending.insert(id.clone(), (window.label().to_string(), reply));
    }
    if let Err(error) = app.emit_to(
        "main",
        "desktop-request",
        serde_json::json!({ "id":id,"message":message,"callerWindow":window.label() }),
    ) {
        state.pending.lock().unwrap().remove(&id);
        return Err(error.to_string());
    }
    let response = tokio::time::timeout(Duration::from_secs(30), receiver.recv()).await;
    state.pending.lock().unwrap().remove(&id);
    match response {
        Ok(Some(value)) => Ok(value),
        _ => Err("Desktop request timed out. Please try again.".into()),
    }
}

#[tauri::command]
pub fn desktop_reply<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, DesktopServiceState>,
    id: String,
    response: Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only main may complete desktop requests".into());
    }
    if let Some((_, reply)) = state.pending.lock().unwrap().remove(&id) {
        let _ = reply.try_send(response);
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_http(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let base = reqwest::Url::parse(
        option_env!("LEARNING_API_BASE").unwrap_or("https://learning.peebot.shop"),
    )
    .map_err(|e| e.to_string())?;
    let learning = parsed.origin() == base.origin() && parsed.path().starts_with("/api/");
    let deepl = url == "https://oneshot-free.www.deepl.com/v1/translate";
    if !learning && !deepl {
        return Err("This endpoint is not a desktop service".into());
    }
    if !matches!(method.as_str(), "GET" | "POST" | "PATCH" | "PUT" | "DELETE") {
        return Err("Unsupported HTTP method".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .user_agent("PolyTranslate-Desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.request(method.parse().map_err(|_| "Invalid HTTP method")?, parsed);
    for (key, value) in headers {
        if matches!(
            key.to_lowercase().as_str(),
            "authorization" | "content-type" | "accept"
        ) {
            request = request.header(key, value);
        }
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > 4_194_304)
    {
        return Err("Desktop service response is too large".into());
    }
    let body = response.text().await.map_err(|e| e.to_string())?;
    if body.len() > 4_194_304 {
        return Err("Desktop service response is too large".into());
    }
    Ok(serde_json::json!({"status":status,"body":body}))
}
