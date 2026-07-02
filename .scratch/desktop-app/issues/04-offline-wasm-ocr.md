---
title: Offline WASM OCR Execution
status: ready-for-agent
author: Antigravity
created: 2026-07-02
---

# Issue 04: Offline WASM OCR Execution

## What to build

Integrate the PaddleOCR ONNX models copied from the extension. Load ONNX Runtime Web (`onnxruntime-web`) inside the Frontend Webview.
When a cropped image Base64 string is captured from the crop overlay selection, feed it to the OCR engine.
Perform offline text detection (DBNet) and text recognition (CRNN) to extract recognized text and their absolute bounding box coordinates on the screen.

## Acceptance criteria

- [ ] ONNX PaddleOCR models load successfully in the WebView environment.
- [ ] OCR runs 100% offline without sending data to external networks.
- [ ] Text characters and bounding boxes are correctly detected and returned.

## Blocked by

- [Issue 03: Crop Box Selection and Image Extraction](file:///d:/Workspace/translation-desktop/.scratch/desktop-app/issues/03-crop-box-selection.md)
