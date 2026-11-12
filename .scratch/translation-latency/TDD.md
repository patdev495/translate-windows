# Bằng chứng TDD

Seams: S1–S6 đã duyệt tại `../extension-parity/TDD-SEAMS.md`.

## 02 — HTTP command → loopback server

Command: `cargo test --manifest-path src-tauri/Cargo.toml --features latency-harness --test http_transport -j 1 -- --nocapture`.

Red trước pooling: hai command trả status 200 và body synthetic đúng;
assert TCP connections thất bại với **left: 2, right: 1** (2026-11-12).
Lần chạy fixture đầu gặp accepted socket nonblocking; đã sửa riêng server
fixture rồi chạy lại để lấy red hành vi ở trên. Không coi lỗi fixture là red.

Green sau pooling: cùng test qua với **1 kết nối TCP**, cả hai body vẫn đúng.
State giữ hai client policy riêng, lazy init không cache lỗi, clone handle trước await.

Kiểm tra sau green: credential A → B → không Authorization; endpoint bị cấm,
redirect không follow, response >4 MiB, HTTP 503 giữ body/status; response trễ
16 giây bị timeout theo policy 15 giây và request tiếp theo vẫn thành công.
Bốn test native public command đều qua; chỉ server TCP được thay ở boundary.

## 03 — Hai tooltip mới và PDF thật → một dictionary của host

Native harness dùng production `open_tooltip_window` hai lần và
`open_pdf_window` + PDF.js với fixture Hello PDF; chọn text qua DOM/shortcut.
`LATENCY_SHARED_TEST=1 LATENCY_EXPECT_SHARED_IPA=1 LATENCY_RUNS=1`.
Red trước chuyển host: 3 client dịch thành công, server thấy **3 dictionary
requests**, assertion yêu cầu 1 thất bại. JSON: `host-red.json`.

Green native ba client: **1 dictionary request/parse**, các client hoàn tất qua
host/RPC production (`host-green.json`). 5 test UI tooltip/Selected Text/PDF qua.

Lát load đồng thời qua public desktop request, giữ coordinator/phonetics thật:
3 client nhận đúng IPA literal nhưng **3 dictionary fetch**, expected 1 (red).

- Đồng thời: red fetch 3 thay vì 1 → green shared load promise, giữ 3 provider requests.
- Dictionary HTTP 503: red lượt sau vẫn thiếu IPA vì cache `{}` → green kiểm tra HTTP status, không cache lỗi và thử lại thành công.
- Đổi target trong khi provider chờ: red kết quả cũ success → green snapshot một lần/request và kiểm tra cấu hình trước giao kết quả; lượt sau dùng target mới.
- Master off rồi on: red kết quả cũ success dù cấu hình cuối giống ban đầu → thêm revision từ settings events (không tính display settings).

- Restart host: red request cũ success → green generation guard; lượt sau hoạt động.
- Input Replacement: red gửi data target cũ → green dùng cùng dispatcher/snapshot guard.
- OCR block RPC: red Unsupported → green giữ detection/first-target fallback và không thêm IPA cho overlay vốn không có IPA.
- Reply đang trên đường về: red tooltip/PDF render bản cũ → green client invalidation/final settings check; PDF nhận payload settings ngay để không bỏ qua master off/on.
- Restart trong final settings read: red trả success → green kiểm tra generation/revision sau await cuối cùng.

Cuối triển khai: `npm test` đạt **31 files / 123 tests**; không mock coordinator,
cache hoặc phonetics trong các test mới. Các fixture chỉ thay IPC, mạng, file và
IndexedDB tại ranh giới hệ thống. Fixture dictionary 503 có log lỗi dự kiến.

- Reload native: RPC cũ fail đúng nhưng server quan sát 12 provider requests thay vì 10 (red `host-reload-red.json`). Tauri IPC có nhánh retry postMessage sau custom-protocol fetch bị navigation hủy. Gắn native transport generation vào từng request main; test thật cho thấy generation riêng vẫn chưa đủ (retry có thể đến trước PageLoad Started). Thêm ledger ID invocation 60 giây/1024 ID để từ chối replay trước network send, không cache response. Gate yêu cầu đúng 10 provider requests, hai dictionary fetch/parse cho hai generations.
- Display font/phonetics đổi khi hai target đang chờ: cả hai provider bắt đầu song song, kết quả còn hợp lệ và lượt sau không tải lại dictionary (9 host behavior tests).

Native reload sau ledger invocation: gate **10 provider requests** đã qua;
RPC cũ báo restarted, RPC mới có IPA và hai generations load/parse đúng 2 lần.
Ledger chỉ giữ invocation IDs; không giữ response hay cache theo nội dung.

Lượt frontend cuối chạy tuần tự sau build: 31 files / 123 tests passed.
Fixture OCR readiness dùng wait timeout 10 giây thay cho mặc định 1 giây để
cho phép dynamic imports hoàn tất trên máy có tải; đây không phải latency gate.

## 04–06 — retained tooltip

Seams remain the approved S3/S6; no additional user approval needed.

- Entrypoint open/dismiss/open: red source stayed `我` instead of `你`; green
  accepts new payload in the same loaded view.
- Replayed payload after dismissal: red `display:block`, expected `none`; green
  retains a high-water request ID even while no presentation is active.
- Dismiss event before its payload: red created a reading card; green records
  the retired ID before the payload can arrive.
- Initially hidden window acquisition failure: red no native layout/show; green
  reveals a scoped notice and cancels its timer on replacement.
- Source-monitor DPI: red layout omitted scale; green supplies source scale and
  native placement uses physical pixels, independent of the retained window DPI.
- Real WebView2 gate: `reuse-red.json` created 21 tooltip WebViews for 21 samples;
  reuse gate failed. `reuse-green.json` first passed the one-view gate, but its
  transitional frontend/native mix issued 84 provider requests instead of 42.
  It is retained as development evidence, **excluded from performance claims**.
- Cold parallel work gate on red trace: host-start 742.44 ms > view-ready
  709.20 ms, assertion failed. Native now dispatches translation before creation.
- `reuse-50-recovery.json`: 50 normal presentations plus explicit destroy and
  recovery, 102 provider requests, one dictionary load; two view-ready events
  including recovery. Includes memory checkpoints. Later source-monitor scale
  and diagnostic-only resource changes require final-source measurement too.

Additional regression coverage uses real tooltip entrypoint with IPC/window,
network/audio/clock boundaries only: delayed native A / supplied B, dismissal
before native reply, old notice timer, hide during OCR (only its job ID canceled,
late progress/results ignored). Existing host/settings/PDF/offline-save suites
remain in the regression matrix. No private helper or CSS snapshot assertions.

Additional native red/green during final review:

- Public `Window.isVisible()` proved a real hide defect after
  `SW_SHOWNOACTIVATE`: Tao's cached hidden flag made `win.hide()` a no-op.
  `stress-diagnostic.json` reports `Dismiss did not hide the retained window`.
  Windows now pairs the nonactivating show with unconditional `SW_HIDE`.
- `stress-diagnostic-green.json` passes show, nonfocus, hide and explicit recovery;
  its listener gate failed because the first diagnostic probe could not replace
  Tauri's read-only `invoke`. This is instrumentation failure, excluded from
  latency claims. Final diagnostics read Tauri 2.11.5's existing registration
  table without mutating IPC and report native pending RPC/OCR/mailbox counts.
- Real WebView2 `font-red.json`: `Tooltip font 14px; expected 16px`.
  Clearing prior native geometry also cleared the configured reading font.
  Presentation reset now preserves that display setting before measuring width.
  Final native samples gate computed reading-card font against public settings.

Renderer-crash seam S6: the initial `edge://crash` fixture did not establish an
actual ProcessFailed event, so its failure is not claimed as a behavior red.
The replacement uses DevTools `Page.crash` and installs a diagnostic observer
that must receive CoreWebView2 ProcessFailed; otherwise it reports fixture error.
With production recovery absent, `crash-cdp-red.json` reports
`The crashed tooltip was not retired` **after the independent observer fired**.
Restore the production handler on the exact window instance; the next request
must recreate the view, retain main IPA and preserve provider request count.

CDP crash green: `crash-cdp-green.json` passed all native recovery gates: two
presentations / four provider requests, one dictionary fetch/parse, four IPC
listener entries per view, zero pending RPC/OCR jobs and one result mailbox.
The diagnostic fixture independently observes ProcessFailed on the red build;
only that CDP red/green pair is claimed as actual renderer-crash evidence.
Final application/harness source committed as `0067a1b`.

Late hidden-view settings race (S3): while A is dismissed, native accepts B under
new settings before its payload reaches the retained view. An older settings
broadcast made the hidden view issue an unscoped close, canceling B. Public
entrypoint/IPC test red: B remained invisible (`false`, expected `true`).
A view without an active presentation now sends no close command. Same test and
all 14 lifecycle/parity tests pass. Added Escape regression coverage; it already
passed and is not claimed as an implementation red. Source `336cad1` supersedes
`0067a1b`; the first NSIS build is retained only as intermediate build metadata.
Final benchmark/soak/package must use the newer source.
