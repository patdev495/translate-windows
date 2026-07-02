---
title: Clipboard Integration
status: done
author: Antigravity
created: 2026-07-02
---

# Issue 07: Clipboard Integration

## What to build

If the `ocrCopyToClipboard` setting is enabled, upon crop selection completion, write the cropped image bytes natively to the Windows system clipboard using Rust backend APIs. This allows users to immediately press `Ctrl + V` to paste the image in other apps (e.g. Paint, Word, Zalo).

## Acceptance criteria

- [ ] Cropped image is copied to the system clipboard upon crop selection mouse release.
- [ ] Users can successfully paste (`Ctrl + V`) the cropped image in external applications.
- [ ] Operates natively via Rust backend to guarantee clipboard writing even without window focus.

## Blocked by

- [Issue 03: Crop Box Selection and Image Extraction](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues/03-crop-box-selection.md)

## Comments

- 2026-07-02: Implemented `ocrCopyToClipboard`-gated native clipboard writing from crop completion. The frontend calls `copy_image_to_clipboard`, and Rust decodes the PNG data URL and writes image data through the native clipboard API. Coverage in `tests/crop-completion.test.ts`. Verified with `npm test`, `npm run build`, and `cargo check`.
