# Product Requirement Document (PRD) — PolyTranslate Desktop App

## 1. Overview & Objectives

PolyTranslate Desktop App is a lightweight, cross-platform Windows desktop utility that enables users to translate any visible text on their screen. By invoking a global hotkey, the user can draw a bounding box over any area on the desktop (including other apps, documents, system UI, etc.), perform offline OCR, and view a translation tooltip floating natively on their OS.

The application must be extremely lightweight, fast, and secure.

---

## 2. Core Requirements

### R1. Global Hotkey Activation
*   The application runs in the system tray.
*   Pressing the global hotkey (default: `Ctrl + Space` or `Ctrl + Alt + Space`) triggers the screen capture mode instantly from anywhere in the OS.

### R2. Screen Selection Overlay
*   When activated, the app captures the current screens/monitors and displays a full-screen semi-transparent overlay.
*   The cursor changes to a crosshair. Clicking and dragging draws a rectangular crop selection area.
*   Releasing the mouse crops the region and closes the full-screen overlay.

### R3. Offline Headless OCR
*   The cropped image is processed locally using the lightweight PaddleOCR ONNX models (already optimized in the extension project).
*   OCR execution is done offline without sending screenshots to external servers.

### R4. Native OS Translation Tooltip
*   On OCR success, a frameless, transparent, always-on-top desktop window opens at the cursor position.
*   Renders a glassmorphic card showing the source text, phonetic IPA/Pinyin translation, and target translations (Vietnamese, English, Chinese).
*   Supports Text-to-Speech (TTS) via native OS voice synthesis.
*   Clicking outside the tooltip window automatically hides/destroys it.

### R5. Pinned Snippet Cards (Always on Top)
*   If "Pin OCR Image" is enabled, a persistent transparent floating card is created showing the cropped image.
*   The user can drag this card anywhere on their screens.
*   It stays on top of all other windows (e.g., IDEs, browsers, Word) until closed (X).

### R6. Auto-Copy to Clipboard
*   If enabled, the cropped screenshot is immediately written to the system clipboard upon mouse release, allowing users to paste (`Ctrl + V`) it into other apps.

---

## 3. Technology Stack & Architecture

### Backend (Rust / Tauri v2)
*   **Tauri v2**: Handles system tray integration, window management (frameless, transparent, always-on-top properties), and native system calls.
*   **`tauri-plugin-global-shortcut`**: Registers and listens to global hotkeys.
*   **`screenshots` (Rust Crate)**: Captures screen frames rapidly across multiple monitors.

### Frontend (TypeScript / HTML / CSS)
*   **Vite + TypeScript**: Provides rapid compilation and bundling.
*   **ONNX Runtime (WASM or Rust Binding)**: Executes the OCR models locally.
*   **TailwindCSS / Vanilla CSS**: Reuses the premium glassmorphic UI design of the Chrome extension.

---

## 4. User Experience & Design Guidelines

*   **Premium Visuals**: Reuses the HSL-based sleeek dark/glassmorphic theme.
*   **Transition Animations**: Use smooth opacity fades for overlays and tooltips.
*   **Low Overhead**: Must boot in under 0.5 seconds, consume < 30MB RAM when idle, and keep installer size under 15MB.
