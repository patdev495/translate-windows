//! App-owned pools, separated by transport policy. Credentials belong to requests.
use std::{sync::Mutex, time::Duration};

#[derive(Default)]
pub struct HttpClients {
    desktop: Mutex<Option<reqwest::Client>>,
    deepl: Mutex<Option<reqwest::Client>>,
}

fn client(
    slot: &Mutex<Option<reqwest::Client>>,
    build: impl FnOnce() -> Result<reqwest::Client, reqwest::Error>,
) -> Result<reqwest::Client, reqwest::Error> {
    let mut slot = slot.lock().unwrap();
    if let Some(value) = slot.as_ref() { return Ok(value.clone()); }
    let value = build()?; // A failed initialization leaves the slot empty for retry.
    *slot = Some(value.clone());
    Ok(value)
}

impl HttpClients {
    pub fn desktop(&self) -> Result<reqwest::Client, reqwest::Error> {
        client(&self.desktop, || reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .user_agent("PolyTranslate-Desktop/1.0")
            .build())
    }

    pub fn deepl(&self) -> Result<reqwest::Client, reqwest::Error> {
        client(&self.deepl, || reqwest::Client::builder()
            .user_agent("PolyTranslate-Desktop/1.0")
            .build())
    }
}
