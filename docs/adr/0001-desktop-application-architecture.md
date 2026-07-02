# 0001-desktop-application-architecture

We will build the PolyTranslate Desktop App using Tauri v2 (Rust backend) and Webview frontend (HTML/CSS/TS), executing screen capture in Rust and running the OCR models in WebAssembly within the webview. Tooltips and pinned cards will be rendered as native sub-windows.

## Context

The user wants a lightweight, native desktop app on Windows to translate any region on their screen. This requires:
1. Registering global system hotkeys to capture other applications' windows.
2. Freezing the screen to let the user crop a region.
3. Performing offline OCR.
4. Displaying tooltips and pinned images that float over other applications without blocking mouse clicks.

Using a hybrid architecture like Tauri v2 allows us to access native OS APIs (Rust) while reusing the premium glassmorphic UI designs and Javascript-based ONNX PaddleOCR decoding logic from the Chrome Extension.

## Decision

1. **Framework Choice**: Use **Tauri v2** to ensure minimal file size (~10MB) and very low RAM consumption (~25MB).
2. **Screen Capture**: Implement global hotkey listeners and screen capture in the **Rust Backend** using the `screenshots` crate. To optimize performance, only capture the active monitor where the mouse cursor is currently positioned.
3. **OCR Execution**: Run the ONNX PaddleOCR models inside the **Webview Frontend via WebAssembly (WASM)** using `@microsoft/onnxruntime-web` to reuse the existing `ocr.ts` decoding logic.
4. **Window Management**: Close the full-screen transparent selection overlay window immediately after selection. Renders the translation tooltip and pinned snippet cards as independent, frameless, transparent, always-on-top **Tauri sub-windows** so they do not block mouse clicks on other background desktop applications.

## Consequences

*   **Pros**:
    *   Extremely lightweight and fast desktop application.
    *   Maximum code reuse (~80% of OCR post-processing, styles, and APIs are ported directly from the Chrome Extension).
    *   No blocking overlay window: users can continue interacting with other Windows apps while tooltips and pinned cards are visible.
*   **Cons**:
    *   WebAssembly execution is slightly slower (10-20%) compared to running ONNX Runtime natively in Rust.
    *   Requires coordinating Tauri window lifecycle and inter-process communication (IPC) between Rust and Webview.
