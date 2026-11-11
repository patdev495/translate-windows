use translation_desktop_lib::selected_text::{
    read_selected_text, SelectionError, SelectionMethod, SelectionPlatform,
};
use translation_desktop_lib::selected_text::{CtrlTrigger, InputEvent, Key};
use translation_desktop_lib::selected_text::read_automatic_selected_text;

struct Desktop {
    uia: Result<Option<String>, SelectionError>,
    clipboard: String,
    sequence: u32,
    now: u64,
    copy_updates: bool,
    source_current: bool,
    uia_changes_source: bool,
}

impl SelectionPlatform for Desktop {
    fn source_is_current(&self) -> bool {
        self.source_current
    }
    fn uia_text(&mut self) -> Result<Option<String>, SelectionError> {
        if self.uia_changes_source {
            self.source_current = false;
        }
        self.uia.clone()
    }
    fn clipboard_sequence(&self) -> u32 {
        self.sequence
    }
    fn send_copy(&mut self) -> Result<(), SelectionError> {
        if self.copy_updates {
            self.clipboard = "copied text".into();
            self.sequence += 1;
        }
        Ok(())
    }
    fn clipboard_text(&mut self) -> Option<String> {
        Some(self.clipboard.clone())
    }
    fn elapsed_ms(&self) -> u64 {
        self.now
    }
    fn pause(&mut self) {
        self.now += 10;
    }
}

#[test]
fn automatic_selection_without_directly_readable_text_never_copies_old_clipboard() {
    let mut desktop = Desktop {
        uia: Ok(None), clipboard: "my copied paragraph".into(), sequence: 17, now: 0,
        copy_updates: true, source_current: true, uia_changes_source: false,
    };
    assert_eq!(read_automatic_selected_text(&mut desktop), Err(SelectionError::NoText));
    assert_eq!((desktop.clipboard.as_str(), desktop.sequence), ("my copied paragraph", 17));
}

#[test]
fn selected_text_from_uia_is_returned_without_changing_the_clipboard() {
    let mut desktop = Desktop {
        uia: Ok(Some("你好，世界".into())),
        clipboard: "keep me".into(),
        sequence: 7,
        now: 0,
        copy_updates: true,
        source_current: true,
        uia_changes_source: false,
    };
    let selected = read_selected_text(&mut desktop).unwrap();
    assert_eq!(
        (
            selected.text.as_str(),
            selected.method,
            desktop.clipboard.as_str()
        ),
        ("你好，世界", SelectionMethod::Uia, "keep me")
    );
}

#[test]
fn unavailable_uia_falls_back_to_copy_and_leaves_the_copied_text_available_for_paste() {
    for uia in [
        Ok(None),
        Ok(Some(" \n".into())),
        Err(SelectionError::NoText),
    ] {
        let mut desktop = Desktop {
            uia,
            clipboard: "old clipboard".into(),
            sequence: 3,
            now: 0,
            copy_updates: true,
            source_current: true,
            uia_changes_source: false,
        };
        let selected = read_selected_text(&mut desktop).unwrap();
        assert_eq!(
            (
                selected.text.as_str(),
                selected.method,
                desktop.clipboard.as_str()
            ),
            ("copied text", SelectionMethod::Clipboard, "copied text")
        );
    }
}

#[test]
fn copy_that_does_not_update_the_clipboard_never_translates_old_text() {
    let mut desktop = Desktop {
        uia: Ok(None),
        clipboard: "old clipboard".into(),
        sequence: 3,
        now: 0,
        copy_updates: false,
        source_current: true,
        uia_changes_source: false,
    };
    assert_eq!(
        read_selected_text(&mut desktop),
        Err(SelectionError::NoText)
    );
    assert!(desktop.now <= 1_000, "waiting for Copy must be bounded");
}

#[test]
fn changing_the_source_cancels_acquisition_without_copying_or_returning_late_uia_text() {
    for (source_current, uia_changes_source, uia) in [
        (false, false, Ok(None)),
        (true, true, Ok(Some("late text".into()))),
        (true, true, Err(SelectionError::NoText)),
    ] {
        let mut desktop = Desktop {
            uia,
            clipboard: "keep me".into(),
            sequence: 3,
            now: 0,
            copy_updates: true,
            source_current,
            uia_changes_source,
        };
        assert_eq!(
            (read_selected_text(&mut desktop), desktop.clipboard.as_str()),
            (Err(SelectionError::SourceChanged), "keep me")
        );
    }
}

#[test]
fn releasing_a_standalone_left_ctrl_requests_selected_text_translation_once() {
    let mut trigger = CtrlTrigger::default();
    assert!(!trigger.handle(InputEvent::KeyDown(Key::ControlLeft)));
    assert!(trigger.handle(InputEvent::KeyUp(Key::ControlLeft)));
    assert!(!trigger.handle(InputEvent::KeyUp(Key::ControlLeft)));
}

#[test]
fn ctrl_chords_and_mouse_actions_do_not_request_translation() {
    for middle in [
        InputEvent::KeyDown(Key::Other(0x43)),
        InputEvent::KeyDown(Key::Other(0x56)),
        InputEvent::KeyDown(Key::Other(0x33)),
        InputEvent::PointerAction,
    ] {
        let mut trigger = CtrlTrigger::default();
        trigger.handle(InputEvent::KeyDown(Key::ControlLeft));
        trigger.handle(middle);
        assert!(!trigger.handle(InputEvent::KeyUp(Key::ControlLeft)));
    }
}

#[test]
fn only_standalone_ctrl_gestures_translate_regardless_of_side_or_key_repeat() {
    use InputEvent::{KeyDown as Down, KeyUp as Up, PointerAction};
    use Key::{ControlLeft as Left, ControlRight as Right, Other};
    let cases = [
        (vec![Down(Right), Up(Right)], 1),
        (vec![Down(Left), Down(Left), Up(Left)], 1),
        (vec![Down(Left), Down(Other(67)), Down(Left), Up(Left)], 0),
        (
            vec![Down(Other(16)), Down(Left), Up(Left), Up(Other(16))],
            0,
        ),
        (vec![Down(Left), Down(Right), Up(Left), Up(Right)], 0),
        (vec![Down(Right), PointerAction, Up(Right)], 0),
    ];
    for (events, expected) in cases {
        let mut trigger = CtrlTrigger::default();
        let requests = events
            .into_iter()
            .filter(|event| trigger.handle(*event))
            .count();
        assert_eq!(requests, expected);
    }
}
