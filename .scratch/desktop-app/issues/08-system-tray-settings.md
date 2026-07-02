---
title: System Tray and Settings UI
status: done
author: Antigravity
created: 2026-07-02
---

# Issue 08: System Tray and Settings UI

## What to build

Integrate a system tray icon for the application in the OS taskbar.
Double-clicking the tray icon or selecting "Settings" from its context menu opens a dedicated Settings GUI window.
This Settings window allows configuring:
- Target languages (Primary, Secondary, Reverse).
- Hotkeys and OCR triggers.
- Font sizes.
- Toggles for Pin OCR Image and Copy OCR to Clipboard.

Settings must load and save natively via `localStorage` (which we integrated in `settings.ts`).

## Acceptance criteria

- [ ] System tray icon is visible in the taskbar.
- [ ] Context menu on tray icon contains "Settings" and "Exit".
- [ ] "Settings" opens a functional settings control panel window.
- [ ] Changing settings saves configuration, which takes effect immediately on subsequent captures.

## Blocked by

- None - can start immediately

## Comments

- 2026-07-02: Implemented Tauri system tray with Settings/Exit menu, double-click settings opening, native settings window, and localStorage-backed controls for target languages, OCR trigger/model/language, tooltip font size, pin image, and copy-to-clipboard. Coverage in `tests/settings-panel.test.ts`. Verified with `npm test`, `npm run build`, and `cargo check`.
