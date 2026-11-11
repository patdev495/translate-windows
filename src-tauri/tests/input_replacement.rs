use translation_desktop_lib::selected_text::{
    apply_input_translation, ReplacementOutcome, ReplacementPlatform,
};

struct Source {
    current: bool,
    contents: String,
}
impl ReplacementPlatform for Source {
    fn selection_is_current(&self) -> bool {
        self.current
    }
    fn replace_selection(&mut self, translation: &str) -> Result<(), String> {
        self.contents = translation.into();
        Ok(())
    }
}

#[test]
fn a_changed_input_keeps_its_text_and_returns_the_translation_for_the_copy_tooltip() {
    let mut source = Source {
        current: false,
        contents: "I am typing something else now".into(),
    };
    let outcome = apply_input_translation(&mut source, "xin chào");
    assert_eq!(source.contents, "I am typing something else now");
    assert_eq!(
        outcome,
        ReplacementOutcome::Fallback {
            translation: "xin chào".into(),
            notice: "Không thay được chữ trong ứng dụng này".into()
        }
    );
}
