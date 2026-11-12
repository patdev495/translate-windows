use crate::{
    selected_text::{windows::DeliveryContext, ReplacementOutcome},
    TooltipData,
};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};

pub struct Pending {
    text: String,
    context: DeliveryContext,
}
#[derive(Default)]
pub struct InputTranslationState {
    sequence: AtomicU64,
    pending: Mutex<HashMap<String, Pending>>,
}
impl InputTranslationState {
    pub fn cancel_all(&self) {
        self.pending.lock().unwrap().clear();
    }
}

pub fn request(
    app: &tauri::AppHandle,
    text: String,
    context: DeliveryContext,
) -> Result<(), String> {
    let state = app.state::<InputTranslationState>();
    let id = state.sequence.fetch_add(1, Ordering::AcqRel).to_string();
    {
        let mut pending = state.pending.lock().unwrap();
        pending.clear();
        pending.insert(
            id.clone(),
            Pending {
                text: text.clone(),
                context,
            },
        );
    }
    app.emit_to(
        "main",
        "input-translation-request",
        serde_json::json!({"id":id,"text":text}),
    )
    .map_err(|e| e.to_string())?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        app.state::<InputTranslationState>()
            .pending
            .lock()
            .unwrap()
            .remove(&id);
    });
    Ok(())
}

pub async fn complete_input_replacement(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, InputTranslationState>,
    id: String,
    data: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only main may complete Input Replacement Translation".into());
    }
    let Some(pending) = state.pending.lock().unwrap().remove(&id) else {
        return Ok(());
    };
    {
        let settings = app.state::<crate::AppSettingsState>();
        let settings = settings.0.lock().unwrap();
        if !settings.translation_active
            || !settings.input_replacement_enabled
            || settings.primary_target_lang == "none"
        {
            return Ok(());
        }
    }
    if !pending.context.is_current() {
        return Ok(());
    }
    let data = data.unwrap_or(Value::Null);
    let translation = data["translations"][0]["text"].as_str().map(str::to_string);
    let (notice, failure) = if let Some(translation) = translation {
        let context = pending.context.clone();
        let result =
            tauri::async_runtime::spawn_blocking(move || context.apply_translation(&translation))
                .await
                .map_err(|e| e.to_string())?;
        match result {
            ReplacementOutcome::Replaced => return Ok(()),
            ReplacementOutcome::Fallback { notice, .. } => (Some(notice), None),
        }
    } else {
        (None, Some(error.unwrap_or_else(|| "Dịch thất bại".into())))
    };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !pending.context.is_current() {
            return;
        }
        let payload = TooltipData {
            text: if failure.is_some() {
                String::new()
            } else {
                pending.text
            },
            error: failure,
            notice,
            translation_data: if data.is_null() { None } else { Some(data) },
            x: pending.context.x,
            y: pending.context.y,
            ..Default::default()
        };
        if let Err(error) =
            crate::open_tooltip_window_inner(&handle, payload)
        {
            eprintln!("Cannot show replacement fallback: {error}");
        }
    })
    .await
    .map_err(|e| e.to_string())
}
