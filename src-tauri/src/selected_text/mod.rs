//! Native entry points for translating text selected in another application.

#[cfg(windows)]
pub mod windows;
mod input;
pub use input::{DesktopTranslationInput, TranslationAction};

pub trait ReplacementPlatform {
    fn selection_is_current(&self) -> bool;
    fn replace_selection(&mut self, translation: &str) -> Result<(), String>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReplacementOutcome {
    Replaced,
    Fallback { translation: String, notice: String },
}

pub fn apply_input_translation(platform: &mut impl ReplacementPlatform, translation: &str) -> ReplacementOutcome {
    if platform.selection_is_current() && platform.replace_selection(translation).is_ok() { return ReplacementOutcome::Replaced; }
    ReplacementOutcome::Fallback { translation: translation.into(), notice: "Không thay được chữ trong ứng dụng này".into() }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SelectionError {
    NoText,
    SourceChanged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectionMethod {
    Uia,
    Clipboard,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SelectedText {
    pub text: String,
    pub method: SelectionMethod,
}

/// The external Windows boundary. Feature logic is shared by production and tests.
pub trait SelectionPlatform {
    fn source_is_current(&self) -> bool;
    fn uia_text(&mut self) -> Result<Option<String>, SelectionError>;
    fn clipboard_sequence(&self) -> u32;
    fn send_copy(&mut self) -> Result<(), SelectionError>;
    fn clipboard_text(&mut self) -> Option<String>;
    fn elapsed_ms(&self) -> u64;
    fn pause(&mut self);
}

/// Automatic translation never injects Copy or consumes clipboard contents.
pub fn read_automatic_selected_text(
    platform: &mut impl SelectionPlatform,
) -> Result<SelectedText, SelectionError> {
    if !platform.source_is_current() { return Err(SelectionError::SourceChanged); }
    let text = platform.uia_text()?;
    if !platform.source_is_current() { return Err(SelectionError::SourceChanged); }
    text.filter(|text| !text.trim().is_empty())
        .map(|text| SelectedText { text, method: SelectionMethod::Uia })
        .ok_or(SelectionError::NoText)
}

pub fn read_selected_text(
    platform: &mut impl SelectionPlatform,
) -> Result<SelectedText, SelectionError> {
    if !platform.source_is_current() {
        return Err(SelectionError::SourceChanged);
    }
    let uia = platform.uia_text();
    if !platform.source_is_current() {
        return Err(SelectionError::SourceChanged);
    }
    if let Ok(Some(text)) = uia {
        if !text.trim().is_empty() {
            return Ok(SelectedText {
                text,
                method: SelectionMethod::Uia,
            });
        }
    }
    let previous = platform.clipboard_sequence();
    platform.send_copy()?;
    let deadline = platform.elapsed_ms().saturating_add(800);
    while platform.elapsed_ms() < deadline {
        if !platform.source_is_current() {
            return Err(SelectionError::SourceChanged);
        }
        let sequence = platform.clipboard_sequence();
        if sequence != previous {
            if let Some(text) = platform
                .clipboard_text()
                .filter(|text| !text.trim().is_empty())
            {
                if platform.clipboard_sequence() == sequence && platform.source_is_current() {
                    return Ok(SelectedText {
                        text,
                        method: SelectionMethod::Clipboard,
                    });
                }
            }
        }
        platform.pause();
    }
    Err(SelectionError::NoText)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    ControlLeft,
    ControlRight,
    Other(u32),
}

#[derive(Clone, Copy, Debug)]
pub enum InputEvent {
    KeyDown(Key),
    KeyUp(Key),
    PointerAction,
}

#[derive(Default)]
pub struct CtrlTrigger {
    down: Vec<Key>,
    candidate: Option<Key>,
}

impl CtrlTrigger {
    /// Returns true once, on release of a standalone Ctrl gesture.
    pub fn handle(&mut self, event: InputEvent) -> bool {
        match event {
            InputEvent::KeyDown(key) => {
                if self.down.contains(&key) {
                    return false;
                }
                self.candidate = if self.down.is_empty()
                    && matches!(key, Key::ControlLeft | Key::ControlRight)
                {
                    Some(key)
                } else {
                    None
                };
                self.down.push(key);
                false
            }
            InputEvent::KeyUp(key) => {
                self.down.retain(|held| *held != key);
                if self.candidate == Some(key) {
                    self.candidate = None;
                    true
                } else {
                    false
                }
            }
            InputEvent::PointerAction => {
                self.candidate = None;
                false
            }
        }
    }
}
