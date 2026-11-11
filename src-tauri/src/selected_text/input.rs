use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranslationAction {
    Tooltip,
    Replace,
    Automatic,
    Dismiss,
}

fn normalized(code: u32) -> u32 {
    match code {
        0xA0 | 0xA1 => 0x10,
        0xA2 | 0xA3 => 0x11,
        0xA4 | 0xA5 => 0x12,
        0x5C => 0x5B,
        value => value,
    }
}

fn chord(value: &str) -> Result<BTreeSet<u32>, String> {
    if value == "disabled" {
        return Ok(BTreeSet::new());
    }
    let mut keys = BTreeSet::new();
    for part in value.split('+') {
        let code = match part {
            "Ctrl" | "ControlLeft" | "ControlRight" => 0x11,
            "Shift" | "ShiftLeft" | "ShiftRight" => 0x10,
            "Alt" | "AltLeft" | "AltRight" => 0x12,
            "Meta" | "MetaLeft" | "MetaRight" => 0x5B,
            "Space" => 0x20,
            "Enter" => 0x0D,
            "Tab" => 0x09,
            "Escape" => 0x1B,
            "ArrowLeft" => 0x25,
            "ArrowUp" => 0x26,
            "ArrowRight" => 0x27,
            "ArrowDown" => 0x28,
            key if key.starts_with("Key") && key.len() == 4 => key.as_bytes()[3] as u32,
            key if key.starts_with("Digit") && key.len() == 6 => key.as_bytes()[5] as u32,
            key if key.starts_with('F') => key[1..]
                .parse::<u32>()
                .ok()
                .filter(|n| (1..=24).contains(n))
                .map(|n| 0x6F + n)
                .ok_or("Invalid function key")?,
            _ => return Err("Unsupported shortcut. Choose a key or key combination.".into()),
        };
        if !keys.insert(code) {
            return Err("A shortcut cannot repeat a key".into());
        }
    }
    if keys.is_empty() {
        return Err("Choose a key or key combination".into());
    }
    Ok(keys)
}

/// The production input-service boundary: OS keyboard/pointer events become translation requests.
pub struct DesktopTranslationInput {
    tooltip: BTreeSet<u32>,
    replacement: BTreeSet<u32>,
    down: BTreeSet<u32>,
    candidate: Option<TranslationAction>,
}
impl DesktopTranslationInput {
    pub fn new(tooltip: &str, replacement: &str) -> Result<Self, String> {
        let mut service = Self {
            tooltip: BTreeSet::new(),
            replacement: BTreeSet::new(),
            down: BTreeSet::new(),
            candidate: None,
        };
        service.configure(tooltip, replacement)?;
        Ok(service)
    }
    pub fn configure(&mut self, tooltip: &str, replacement: &str) -> Result<(), String> {
        let first = chord(tooltip)?;
        let second = chord(replacement)?;
        if !first.is_empty() && first == second {
            return Err("Translation shortcuts must be different".into());
        }
        self.tooltip = first;
        self.replacement = second;
        self.candidate = None;
        Ok(())
    }
    pub fn keyboard(&mut self, code: u32, pressed: bool) -> Option<TranslationAction> {
        if pressed {
            if !self.down.insert(code) {
                return None;
            }
            let down = self
                .down
                .iter()
                .map(|key| normalized(*key))
                .collect::<BTreeSet<_>>();
            self.candidate = if down == self.tooltip {
                Some(TranslationAction::Tooltip)
            } else if down == self.replacement {
                Some(TranslationAction::Replace)
            } else {
                None
            };
            None
        } else {
            self.down.remove(&code);
            if self.down.is_empty() {
                self.candidate.take()
            } else {
                None
            }
        }
    }
    pub fn pointer_activity(&mut self) {
        self.candidate = None;
    }
}
