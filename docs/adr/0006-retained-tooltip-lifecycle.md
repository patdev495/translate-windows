# 0006: Retain the Native Tooltip WebView and version each presentation

Status: Accepted
Date: 2026-11-12

## Decision

Create `tooltip` lazily on the asynchronous caller, preserving the WebView2
creation workaround. Retain it on dismiss; destroy only for app shutdown or
recovery. Native publication/hide runs on the UI thread, serialized with layout.
No state mutex spans window creation, layout, show, emit or network waits.

Every presentation receives a monotonic request ID. Install listeners once before
reading the native latest-payload snapshot. This handshake replaces readiness
polling and also handles payloads delivered while the WebView is booting. A
separate boot reservation prevents concurrent cold requests creating two views.

Text translation starts in main in parallel with window creation. A single native
mailbox retains only the current request's result; waiters use notification and a
bounded timeout. Supplied Input Replacement fallback data bypasses translation.
Provider calls already sent may complete, but obsolete work cannot render, resize,
show or dismiss a later request. This adds no translation result cache.

Hide/new request invalidates frontend callbacks, aborts that view's OCR job,
disconnects its ResizeObserver, clears notice timers, stops speech/Hanzi and resets
selection, Reading Focus, gloss and save panels. Long-lived listeners and the
shared reading-card instance are reused. Learning Saves accepted by main remain
durable. OCR models and unrelated PDF jobs remain owned by main (ADR-0002).

Provider/key/target/master changes and main reload dismiss the native request,
including results produced before tooltip readiness. Display changes keep current
translation. New requests select the monitor from their source coordinates and
center once; resizing after a manual drag preserves position. Windows warm show
uses `SW_SHOWNOACTIVATE` so the source keeps focus.

## Validation

Public seams S3/S6; DOM/IPC race tests, production native commands in WebView2,
50-cycle reuse and explicit destroy/recovery, process-tree memory checkpoints.
See `.scratch/translation-latency/VALIDATION.md` for measured evidence and limits.
