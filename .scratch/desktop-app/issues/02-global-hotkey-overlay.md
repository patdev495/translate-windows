---
title: Global Hotkey and Transparent Screen Freeze Overlay
status: ready-for-agent
author: Antigravity
created: 2026-07-02
---

# Issue 02: Global Hotkey and Transparent Screen Freeze Overlay

## What to build

Implement a global hotkey listener in the Rust backend of Tauri. When the hotkey (default: `Ctrl + Space` or `Ctrl + Alt + Space`) is pressed, capture the active monitor's screen pixels natively using the Rust `screenshots` crate.
Then, open a transparent, frameless, full-screen Tauri window (selection overlay) overlaying the captured screenshot image so the user feels like their screen has frozen.
Pressing the `Escape` key inside this window must close/destroy the overlay window.

## Acceptance criteria

- [ ] Pressing the global hotkey captures the screen and opens the full-screen overlay instantly.
- [ ] The overlay window displays the captured desktop screen pixels accurately.
- [ ] Pressing `Escape` closes the overlay window and restores normal desktop interaction.
- [ ] Only the active monitor where the mouse cursor is located is captured and overlaid.

## Blocked by

- None - can start immediately
