---
title: Draggable Pinned Snippet Sub-windows
status: done
author: Antigravity
created: 2026-07-02
---

# Issue 06: Draggable Pinned Snippet Sub-windows

## What to build

If the `ocrPinImage` setting is enabled, upon crop selection completion, Tauri backend spawns an independent floating always-on-top window displaying the cropped image.
This window must:
- Be draggable (can be moved freely across monitors by clicking and holding the card header).
- Have a close button (X) to destroy the window.
- Stay on top of other Windows applications.
- Allow running multiple pinned snippet windows simultaneously.

## Acceptance criteria

- [ ] Floating image card opens upon crop completion if enabled.
- [ ] Users can drag the window anywhere on screen.
- [ ] Clicking X closes and destroys the window.
- [ ] Snippet cards stay on top of other desktop applications.

## Blocked by

- [Issue 03: Crop Box Selection and Image Extraction](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues/03-crop-box-selection.md)

## Comments

- 2026-07-02: Implemented pinned snippet windows with unique labels, cropped image loading, close handling, native drag region, always-on-top Tauri windows, and `ocrPinImage`-gated opening from crop completion. Coverage in `tests/snippet-controller.test.ts` and `tests/crop-completion.test.ts`. Verified with `npm test`, `npm run build`, and `cargo check`.
