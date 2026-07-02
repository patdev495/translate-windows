---
title: Crop Box Selection and Image Extraction
status: ready-for-agent
author: Antigravity
created: 2026-07-02
---

# Issue 03: Crop Box Selection and Image Extraction

## What to build

On the full-screen selection overlay window, implement click-and-drag interaction to let the user draw a rectangular selection crop box.
Show a semi-transparent dark mask over the screen, exposing the selected region in full brightness.
Upon releasing the mouse click (`mouseup`), extract the selected region pixels into a PNG base64 Data URL, log/print it to the console for debugging, and immediately close/destroy the overlay window.

## Acceptance criteria

- [ ] Click-and-drag draws a rectangular bounding box with a clear crop selection preview.
- [ ] Non-selected areas are masked with a semi-transparent dark overlay.
- [ ] Releasing mouse click (`mouseup`) captures the selected pixels and outputs a base64 Data URL.
- [ ] The overlay window closes instantly upon crop selection completion.

## Blocked by

- [Issue 02: Global Hotkey and Transparent Screen Freeze Overlay](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues/02-global-hotkey-overlay.md)
