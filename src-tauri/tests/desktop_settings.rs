use translation_desktop_lib::AppSettings;

#[test]
fn old_ocr_preferences_keep_their_values_and_receive_independent_translation_shortcuts() {
    let old = serde_json::json!({
        "primaryTargetLang":"en", "secondaryTargetLang":"none", "reverseTargetLang":"vi",
        "autoTranslate":false, "ocrShortcut":"alt-o", "ocrModelTier":"small", "ocrLanguage":"latin",
        "ttsEnabled":false, "provider":"google", "deeplApiKey":"", "tooltipFontSize":"24",
        "phoneticsVisible":false, "ocrPinImage":true, "ocrCopyToClipboard":false, "startWithWindows":false
    });
    let restored: AppSettings = serde_json::from_value(old).unwrap();
    let saved = serde_json::to_value(restored).unwrap();
    assert_eq!(
        serde_json::json!({
            "ocr": saved["autoTranslate"], "selection": saved["autoSelectionTranslate"],
            "tooltip": saved["translationShortcut"], "replacement": saved["inputReplacementShortcut"],
            "target": saved["primaryTargetLang"], "ocrShortcut": saved["ocrShortcut"]
        }),
        serde_json::json!({
            "ocr":false, "selection":true, "tooltip":"Alt+KeyQ", "replacement":"Alt+KeyW",
            "target":"en", "ocrShortcut":"alt-o"
        })
    );
}
