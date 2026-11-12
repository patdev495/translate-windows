//! App-owned pools, separated by transport policy. Credentials belong to requests.
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct HttpClients {
    desktop: Mutex<Option<reqwest::Client>>,
    deepl: Mutex<Option<reqwest::Client>>,
    invocations: Mutex<VecDeque<(String, Instant)>>,
}

fn client(
    slot: &Mutex<Option<reqwest::Client>>,
    build: impl FnOnce() -> Result<reqwest::Client, reqwest::Error>,
) -> Result<reqwest::Client, reqwest::Error> {
    let mut slot = slot.lock().unwrap();
    if let Some(value) = slot.as_ref() {
        return Ok(value.clone());
    }
    let value = build()?; // A failed initialization leaves the slot empty for retry.
    *slot = Some(value.clone());
    Ok(value)
}

impl HttpClients {
    /// Navigation can make WebView2 replay an already submitted IPC command.
    /// Retain only IDs, never request/response data; independent calls remain independent.
    pub fn claim_invocation(&self, scope: &str, id: Option<&str>) -> Result<(), String> {
        let Some(id) = id else {
            return Ok(());
        };
        if id.is_empty() || id.len() > 80 {
            return Err("Invalid HTTP invocation ID".into());
        }
        let key = format!("{scope}:{id}");
        let mut invocations = self.invocations.lock().unwrap();
        while invocations
            .front()
            .is_some_and(|(_, time)| time.elapsed() > Duration::from_secs(60))
        {
            invocations.pop_front();
        }
        if invocations.iter().any(|(previous, _)| previous == &key) {
            return Err(
                "HTTP invocation was already submitted before IPC reconnect. Please try again."
                    .into(),
            );
        }
        if invocations.len() >= 1024 {
            return Err("HTTP invocation limit reached. Please try again shortly.".into());
        }
        invocations.push_back((key, Instant::now()));
        Ok(())
    }

    pub fn desktop(&self) -> Result<reqwest::Client, reqwest::Error> {
        client(&self.desktop, || {
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .user_agent("PolyTranslate-Desktop/1.0")
                .build()
        })
    }

    pub fn deepl(&self) -> Result<reqwest::Client, reqwest::Error> {
        client(&self.deepl, || {
            reqwest::Client::builder()
                .user_agent("PolyTranslate-Desktop/1.0")
                .build()
        })
    }
}
