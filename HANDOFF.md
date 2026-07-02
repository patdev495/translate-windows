# Handoff — PolyTranslate Desktop Initial Setup

This handoff summarizes the state of the **PolyTranslate Desktop App** project to guide the next agent in implementing the crop-selection translation flow.

---

## 1. Project Overview & Current State

*   **Workspace Location**: [translation-desktop](file:///d:/Workspace/translation-desktop)
*   **Architecture**: Built with **Tauri v2** (Rust backend + Vanilla TypeScript frontend). Documented in [ADR-0001](file:///d:/Workspace/translation-desktop/docs/adr/0001-desktop-application-architecture.md).
*   **Domain Glossary**: Defined in [CONTEXT.md](file:///d:/Workspace/translation-desktop/CONTEXT.md).
*   **Agent Conventions**: Issue tracker defined in [AGENTS.md](file:///d:/Workspace/translation-desktop/AGENTS.md) and [issue-tracker.md](file:///d:/Workspace/translation-desktop/docs/agents/issue-tracker.md).

---

## 2. Copied & Adapted Assets (Ready for Reuse)

The following core logic files have been copied over from the extension project:
1.  **OCR Models & Dictionaries**: Copied to [public/models/](file:///d:/Workspace/translation-desktop/public/models).
2.  **OCR Runner**: [ocr.ts](file:///d:/Workspace/translation-desktop/src/services/ocr.ts) (DBNet and CRNN decoding via WebAssembly `@microsoft/onnxruntime-web`).
3.  **Translation Engines**: [translation.ts](file:///d:/Workspace/translation-desktop/src/services/translation.ts) (Google Translate and DeepL API) and [translation-plan.ts](file:///d:/Workspace/translation-desktop/src/services/translation-plan.ts).
4.  **Phonetics**: [phonetics.ts](file:///d:/Workspace/translation-desktop/src/services/phonetics.ts) (Pinyin-pro and CMU English IPA).
5.  **Settings**: [settings.ts](file:///d:/Workspace/translation-desktop/src/services/settings.ts) has been adapted to use **`localStorage`** instead of chrome extension storage.
6.  **Tests**: 15 unit tests have been set up in [tests/](file:///d:/Workspace/translation-desktop/tests) and run successfully with `npm test`.

---

## 3. Backlog & Next Steps

A structured backlog is published in the local issue tracker at [.scratch/desktop-app/issues/](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues).

### Recommended Action Path for the Next Agent:
1.  **Pick up [Issue 02: Global Hotkey and Overlay](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues/02-global-hotkey-overlay.md)**:
    *   Register the global shortcut in Rust using `tauri-plugin-global-shortcut`.
    *   Capture screen pixels using the `screenshots` crate in Rust.
    *   Create and show a transparent full-screen overlay window.
2.  **Move to [Issue 03: Crop Selection](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues/03-crop-box-selection.md)**:
    *   Draw the crop box on the frontend Canvas/Webview overlay and return the cropped Base64 to Rust/console.
3.  **Integrate OCR and Tooltip (Issues 04 & 05)**:
    *   Feed crop to `ocr.ts` runner.
    *   Create a Tauri sub-window at the coordinates to show the translation tooltip.
