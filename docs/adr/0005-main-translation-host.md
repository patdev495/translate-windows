# 0005: Keep translation and English IPA in the persistent main host

Status: Accepted
Date: 2026-11-12

## Context

Native Tooltip Windows are disposable WebViews. Each previously ran its own
TranslationCoordinator and fetched/parsed the English IPA dictionary again.
The Desktop PDF Reader also translated locally. A file/HTTP cache does not
preserve the parsed dictionary when a JavaScript context is destroyed.

## Decision

- The hidden `main` WebView owns translation and English IPA. Tooltip, PDF,
  post-recognition OCR blocks, selection gloss, meaning suggestions and Input
  Replacement use the existing desktop host/IPC service.
- Keep one successful parsed dictionary and one in-flight load promise per main
  context. Concurrent requests share the load. Fetch/parse failures preserve
  readable source text and allow the next request to retry.
- Snapshot translation settings once per request. A settings revision and host
  generation prevent superseded results from being delivered. Provider, API key,
  targets and master changes invalidate work; display changes preserve it.
  Clients also reject replies superseded while in transit. Existing native
  reload handling fails pending RPCs; the next request waits for the new host.
- Preserve target selection, parallel target requests and supplied
  `translationData` without translating it again. Do not cache translation
  results as part of this work.
- Rust owns lazy HTTP clients per transport policy. Desktop HTTP keeps its
  endpoint/method/size restrictions, no redirects and 15-second timeout. DeepL
  API keeps its redirect policy and per-request 5/8-second timeouts. Credentials
  remain on individual requests; no mutex is held across network awaits.
  Host HTTP commands carry a native transport generation, so a WebView IPC
  retry after navigation cannot resend retired-host provider work. A bounded,
  60-second ledger of invocation IDs also rejects replay before the navigation
  event retires the generation. It stores no response or translation data.
- ADR-0002 remains unchanged: OCR sessions and its serial queue belong to main.
  Translation is not added to that queue. Measure concurrent OCR separately.

## Consequences

Closing a tooltip or PDF preserves the parsed dictionary in main. Reloading
main creates a fresh dictionary lifetime. This retains dictionary memory while
the app is running; measurements include process-tree memory.

Tooltip WebView reuse is a separate lifecycle change (latency issue 04).
This decision does not change normal tooltip creation/destruction.

Public HTTP tests observe TCP reuse at a real loopback server. Native WebView2
validation uses production tooltip/PDF commands and synthetic profiles; reports
and reproduction commands are in `.scratch/translation-latency/`.
