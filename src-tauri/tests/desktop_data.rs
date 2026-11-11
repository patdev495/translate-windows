use translation_desktop_lib::desktop::DesktopData;

#[test]
fn hanzi_notes_are_retrievable_after_reopening_the_desktop_store() {
    let path = std::env::temp_dir().join(format!(
        "polytranslate-data-test-{}-{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let store = DesktopData::open(path.clone()).unwrap();
    store
        .set(
            serde_json::json!({ "hanzi-learning-note:明": "Nhật và nguyệt" })
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();
    drop(store);
    let reopened = DesktopData::open(path).unwrap();
    assert_eq!(
        reopened
            .get(Some(vec!["hanzi-learning-note:明".into()]))
            .unwrap(),
        serde_json::json!({ "hanzi-learning-note:明": "Nhật và nguyệt" })
    );
}
