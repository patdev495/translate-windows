use translation_desktop_lib::selected_text::{DesktopTranslationInput, TranslationAction};

#[test]
fn configured_translation_shortcuts_are_independent_and_plain_ctrl_copy_is_not_a_request() {
    let mut input = DesktopTranslationInput::new("Alt+KeyQ", "Alt+KeyW").unwrap();
    assert_eq!(input.keyboard(0x12, true), None);
    assert_eq!(input.keyboard(0x51, true), None);
    assert_eq!(input.keyboard(0x51, false), None);
    assert_eq!(
        input.keyboard(0x12, false),
        Some(TranslationAction::Tooltip)
    );
    input.configure("Ctrl+Shift+KeyR", "Alt+KeyW").unwrap();
    for (code, down) in [(0x11, true), (0x43, true), (0x43, false), (0x11, false)] {
        assert_eq!(input.keyboard(code, down), None);
    }
    for (code, down) in [
        (0x11, true),
        (0x10, true),
        (0x52, true),
        (0x52, false),
        (0x10, false),
    ] {
        assert_eq!(input.keyboard(code, down), None);
    }
    assert_eq!(
        input.keyboard(0x11, false),
        Some(TranslationAction::Tooltip)
    );
    for (code, down) in [(0x12, true), (0x57, true), (0x57, false)] {
        assert_eq!(input.keyboard(code, down), None);
    }
    assert_eq!(
        input.keyboard(0x12, false),
        Some(TranslationAction::Replace)
    );
}

#[test]
fn single_keys_trigger_on_release_and_ctrl_copy_does_not_trigger_a_plain_ctrl_shortcut() {
    let mut input = DesktopTranslationInput::new("Ctrl", "KeyQ").unwrap();
    assert_eq!(input.keyboard(0xA2, true), None);
    assert_eq!(
        input.keyboard(0xA2, false),
        Some(TranslationAction::Tooltip)
    );
    for (code, down) in [(0xA2, true), (0x43, true), (0x43, false), (0xA2, false)] {
        assert_eq!(input.keyboard(code, down), None);
    }
    assert_eq!(input.keyboard(0x51, true), None);
    assert_eq!(
        input.keyboard(0x51, false),
        Some(TranslationAction::Replace)
    );
}
