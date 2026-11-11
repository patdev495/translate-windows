# 0002: Keep Local OCR Engine sessions in the hidden main WebView

Status: Accepted
Date: 2026-10-28

## Context

OCR service variables belong to one WebView. Recreating a tooltip or crop overlay recreated ONNX sessions even though model files were cached in IndexedDB. Preloading from main, overlay, tooltip and settings could also hold multiple model copies.

Latin recognition uses a Paddle detector with VietOCR CNN/encoder/decoder. Its preload path previously selected a different Paddle Latin preset, and unload did not release the VietOCR sessions.

## Decision

- The existing hidden `main` WebView owns the Local OCR Engine. It initializes independently of capture-image state and loads the OCR modules dynamically.
- Overlay and tooltip submit PNG data URLs through Tauri commands. Settings windows only edit configuration. OCR returns crop-relative text blocks and full text.
- Rust correlates requests with unique job IDs and host generations, derives caller identity from the actual window, and limits work to one active job plus one queued job.
- Clients subscribe to progress before submitting. Closing a client, changing OCR settings, disabling automatic translation or reaching the 120-second timeout cancels delivery. Inference already in progress finishes safely before its slot or model resources are released.
- Main reload/disconnection fails requests belonging to the old host. Completed and canceled jobs cannot update a replacement tooltip.
- Public preload, recognition and unload operations share one serial queue. Both Paddle and VietOCR resources follow the selected pipeline's lifetime. Unrelated display, speech and translation settings preserve the model.
- Keep file caching in IndexedDB. Disable the Paddle SDK's result cache: its sampled image hash collided for numbered crop images during WebView2 validation. Map its line-grouped results to the app's text-block contract.

## Consequences

Repeated captures reuse ONNX sessions across disposable windows. OCR stays offline and uses the WASM/WebView architecture from ADR-0001.

Keeping a model resident increases idle memory while automatic translation is enabled. The approximately 25 MB RAM figure in ADR-0001 is an early estimate, superseded by measured process-tree memory in `.scratch/persistent-ocr/VALIDATION.md`. Releasing ONNX sessions does not force the browser's WASM allocator to return every committed page to the OS.

The host serializes recognition. A timeout cancels the caller's wait; an already running ONNX call can continue until it completes. If a host is unresponsive, later requests still have bounded waits, and host reload creates a new generation.

## Extension parity clarification

The original automatic-translation preference controls screen-crop translation. Automatic Selected Text Translation has a separate preference and does not own OCR resources. Explicit PDF OCR uses the same main host even when screen-crop translation is off, then releases transient model resources while that preference remains off. The application's master translation switch prevents new OCR translation and releases resident resources.

## Validation

Behavior tests cover the public OCR API, native Tauri commands and client/main integration, with only system boundaries replaced in tests. The `ocr_smoke` example runs the real models in a hidden Windows WebView2 host and repeatedly creates/destroys hidden clients. It checks numbered-image text, blocks, session reuse, switching pipelines, disabling/re-enabling and complete session release.

The runtime harness uses a separate browser profile and in-memory settings. It sends synthetic images to OCR and does not invoke translation providers. See `.scratch/persistent-ocr/VALIDATION.md` for commands and measured limits.
