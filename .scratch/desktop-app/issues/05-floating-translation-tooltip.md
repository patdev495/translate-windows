---
title: Floating Translation Tooltip Sub-window
status: done
author: Antigravity
created: 2026-07-02
---

# Issue 05: Floating Translation Tooltip Sub-window

## What to build

On successful OCR text extraction, Tauri backend should spawn a small, frameless, transparent, always-on-top sub-window positioned at the coordinates of the selected region.
This sub-window renders a glassmorphic card (reusing the extension designs) displaying:
- Source recognized text.
- IPA/Pinyin phonetics.
- Translated text (integrated with Google/DeepL API).
- Text-to-Speech (TTS) voice synthesis button.

Clicking outside the tooltip window (focus loss) must automatically close and destroy it.

## Acceptance criteria

- [ ] Tooltip opens at correct coordinates over the selection.
- [ ] Tooltip window is frameless, transparent, and always-on-top.
- [ ] Reuses glassmorphic styling, showing translations, phonetics, and working TTS.
- [ ] Clicking outside closes/destroys the window instantly, freeing desktop focus.

## Blocked by

- [Issue 04: Offline WASM OCR Execution](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues/04-offline-wasm-ocr.md)

## Comments

- 2026-07-02: Implemented tooltip sub-window lifecycle and UI controller with source text, phonetics, translation, TTS, focus-loss close, and preserved crop width/height in Rust tooltip state. Coverage in `tests/tooltip-controller.test.ts`. Verified with `npm test`, `npm run build`, and `cargo check`.
