# Validation — translation latency

Date: 2026-11-12
Status: done

**Bàn giao cuối issues 04–06:** source `748fc0b`, branch
`codex/translation-latency-456`. Tooltip retained với request generation,
reset/abort theo lượt và recovery renderer crash. Frontend **134 pass**, Rust
**42 pass**, Windows interactive **3/3 pass**, WebView2 UI smoke pass. Soak
**751 vòng / 1 WebView / 1 dictionary / 4 listeners / 0 pending RPC/OCR**;
RAM plateau vòng 200–751. Controlled warm p50/p95 **168.88 / 194.77 ms** so
baseline **1502.14 / 1972.89 ms**; không suy tốc độ provider thật từ loopback.

NSIS jobs=1, diagnostic feature off, source-matched artifact verified at
2026-11-12 13:33 +07:00. Installer SHA-256:
`7149A5A4302A6252B3D63B21624CD8CF9C6CCE66534CD454A5FD4215F3538287`.
Metadata/config/source: [build-artifacts.json](build-artifacts.json),
[build-start.json](build-start.json), [SHA256SUMS.txt](SHA256SUMS.txt).
Previous installer preserved with rollback metadata in
[previous-release.json](previous-release.json). No install/push performed.

Giới hạn còn lại: OCR đồng thời có CPU scheduling tail; nghiệm thu thủ công
đa màn hình mixed-DPI và ứng dụng nguồn riêng chưa chạy. Chi tiết bằng chứng,
raw reports và số liệu lịch sử ở các phần dưới.

Phần số liệu đầu ghi bàn giao issues 01–03. Phần 04–06 bên dưới ghi lifecycle,
kiểm tra và đóng gói tiếp theo; các bảng cũ giữ làm lịch sử đối chiếu.

## Benchmark chính

Native debug / frontend production, cùng máy, DeepL Web pipeline với server HTTP loopback delay 40 ms, English → vi + zh, IPA giữ nguyên, OCR tắt. Mỗi phase 5 cold + 100 warm, không chạy build/test nặng song song lúc đo. Metric là **text-ready → correct-paint proxy**, không gồm hook/UIA/Copy Windows.

| Phase | Cold p50 / p95 (ms) | Warm p50 / p95 (ms) | Provider requests / TCP | Dictionary parse |
| --- | --- | --- | --- | --- |
| Baseline | 1,403.47 / 2,173.10 | 1,502.14 / 1,972.89 | 210 / 210 | 105 |
| HTTP pooling | 1,187.90 / 1,734.61 | 1,310.22 / 1,917.75 | 210 / 10 | 105 |
| Main translation host | 1,151.56 / 1,550.79 | 951.25 / 1,169.93 | 210 / 10 | 5 |

Warm p50 giảm **36.7%** so baseline, **27.4%** thêm so bản chỉ pooling. Đạt mục tiêu chốt trước tối ưu: p50 <= 1351,93 ms, p95 <= 2170,17 ms; cold p95 không tăng quá 10%. Cùng 210 provider requests; không thêm translation result cache.

| Phase | Provider span mỗi target, warm p50 (ms) | IPA warm p50 (ms) |
| --- | --- | --- |
| Baseline | 68.10 | 277.20 |
| HTTP pooling | 63.50 | 232.10 |
| Main host | 62.50 | 1.60 |

Provider targets chạy song song: không cộng các duration này vào tổng. Window vẫn được tạo lại; reuse Native Tooltip Window thuộc issue 04.

## Các nhóm đối chiếu riêng

| Nhóm | Baseline warm p50 / p95 (ms) | Sau host warm p50 / p95 (ms) | Lỗi sau host |
| --- | --- | --- | --- |
| Nguồn Trung / IPA target | 1,603.07 / 1,996.52 | 902.19 / 1,063.56 | 0/21 |
| OCR preload/recognition đồng thời | 1,556.26 / 2,294.23 | 1,521.43 / 2,209.47 | 0/21 |
| Google thật | 1,603.99 / 2,186.90 | 1,178.11 / 1,281.97 | 0/6 |
| DeepL Web thật | N/A / N/A | N/A / N/A | 6/6 |

Nhóm OCR đã nhận dạng ảnh Latin tổng hợp thật trong main trong khi dịch chạy. Đây là kiểm tra tranh chấp với preload/recognition, không phải latency gesture OCR end-to-end. Nhóm provider thật nhỏ (6 mẫu/phase); DeepL lỗi được giữ trong JSON, không có percentile thành công để kết luận tăng tốc. Không suy tốc độ dịch thật từ loopback.

## Memory và resource

Private bytes toàn process tree, median qua 5 process, MiB:

| Phase | Trước dịch | Sau command destroy tooltip cuối |
| --- | --- | --- |
| Baseline | 156.0 | 204.8 |
| HTTP pooling | 160.0 | 204.5 |
| Main host | 154.3 | 232.8 |

Sau destroy chưa chờ OS thu hồi toàn bộ renderer/allocator; đây không phải steady idle. Main giữ dictionary đã parse trong app session. Mỗi phase chính có tối đa 2 window labels ở snapshot (main + tooltip) và không lỗi/cancel được inject; số WebView tạo lại vẫn tương ứng từng lần mở. Reload functional test có một RPC bị hủy có chủ đích.

## Kiểm tra hành vi

- `npm test`: **31 files / 123 tests passed**.
- `cargo test --manifest-path src-tauri/Cargo.toml -j 1`: **42 passed**, 3 test desktop Windows tương tác ignored như trước.
- `cargo test --manifest-path src-tauri/Cargo.toml --features latency-harness --test http_transport -j 1`: **5 passed** ở source cuối. Red quan sát 2 TCP, green 1 TCP; credential riêng, HTTP errors/redirect/endpoint/size/15s timeout giữ contract; invocation ID lặp bị từ chối trước network send.
- `npm run test:ui`: WebView2 thật qua main, Settings, PDF, tooltip, Hanzi Breakdown. Kiểm tra width/center/no inset, Copy synthetic, stroke paths và ghi chú; dùng profile riêng, IPC clipboard giả.
- Native hai tooltip mới + một PDF thật: red 3 dictionary fetch → green 1 fetch/parse. Reload main thật khi PDF có RPC đang chạy: RPC cũ báo restarted, lượt sau có IPA, hai generations fetch/parse đúng 2 lần, đúng 10 request provider kể cả khi IPC có nhánh gửi lại (`host-reload.json`).
- Các test mới đi qua public IPC/request/UI; không mock cache, coordinator hoặc phonetics. Load đồng thời, HTTP load lỗi/retry, target/master đổi, restart trong final settings read và reply stale đang trên đường về đều có red trước green. Payload `translationData` tiếp tục render trực tiếp qua test native tooltip hiện có.

## Tái lập và source

Xem [MEASUREMENT.md](MEASUREMENT.md), [TDD.md](TDD.md), các `baseline*.json`, `after-http.json`, `after-host*.json`, `host-red.json`, `host-green.json`, `host-reload.json`. Harness dùng production tooltip/PDF commands; diagnostic endpoint override chỉ có trong feature/bootstrap, không nới allowlist release.

Ở source cuối, mỗi mẫu controlled còn xác nhận DOM source khớp request và đủ hai target có nội dung (`contentVerified`/`content-verified`); timestamp paint production giữ nguyên. Native IPC reload gate xác nhận đúng 10 request, không phát sinh request provider do nhánh IPC gửi lại. Test HTTP thứ năm kiểm chứng invocation ID replay bị từ chối và invocation mới vẫn dùng được.

Raw JSON ghi source HEAD, build mode, config, từng mẫu, percentile, lỗi và resource counts. Báo cáo sau host bổ sung SHA-256 diff code/harness đang build và cấu hình máy chi tiết; các báo cáo baseline cũ dùng cùng máy trong phiên này và metadata platform/architecture. Source không đổi giữa các nhóm đo sau host. ADR-0005 ghi ownership/lifecycle; OCR owner/queue theo ADR-0002 giữ nguyên.

### Ghi chú cold khi OCR chạy

Nhóm OCR riêng chỉ có một cold sample mỗi phase: baseline 2462,29 ms, sau host
3024,47 ms. Trong trace, `view-ready` tăng 1203.89 → 1650.98 ms, còn IPA giảm
536.20 → 487.80 ms. Warm p50/p95 của cùng nhóm giảm nhẹ (1556,26/2294,23 →
1521,43/2209,47 ms). Giữ cold sample chậm này trong báo cáo; tập nhỏ không chứng
minh mọi trạng thái OCR đều nhanh hơn. Không đưa translation vào OCR serial queue.

## 04–06 regression matrix (source aeb8844)

- Automated DOM/IPC: open/dismiss/reopen; replay after dismiss; dismiss before
  payload/result; slow A / fast B; old notice timer; settings changed while reply
  travels; native source-monitor scale; drag preserves position; supplied fallback
  avoids a second provider call; hide during OCR cancels its own ID.
- Existing suites retained: provider/key/target/master snapshots and display
  behavior, host reload/retry, concurrent dictionary load/failure/retry, PDF
  selection/OCR, learning queue surviving host restart/account changes,
  Hanzi/Copy/Reading Focus and capture/recording flows.
- Native Windows interactive tests run separately, serial, synthetic windows:
  **3/3 pass** (UIA/Copy without stale clipboard; native Ctrl-release timing;
  injected Ctrl forwarding and hook restart). Command used the freshly built
  `selected_text_windows-cc7f308f59b3d668.exe --ignored --test-threads=1`;
  test source in this area is unchanged by the lifecycle work.
- Initial UI smoke attempt timed out waiting for Cargo's build-directory lock;
  no UI assertion failed. Harness timeout raised to 600 seconds; optional
  `UI_SKIP_BUILD=1` reuses already-built production assets for the retry.
- Intermediate 50-cycle evidence: 102 provider calls, dictionary fetch/parse 1,
  two actual view-ready events (first creation plus explicit destroy/recovery).
  Process count 8 at cycles 10/25/50. Private bytes 271.5/284.6/288.8 MiB.
  This is a short-run trend, not a proof of arbitrary-duration memory stability.

Hardware/manual matrix must remain distinct: mixed-DPI/multi-monitor physical
hardware and source focus across external applications are not equivalent to
mocked monitor geometry or an isFocused check. Renderer crash is now separately
covered by the CDP ProcessFailed red/green pair below.
Automated destroy/recovery exercises the absent-window path. No claim of manual
hardware acceptance or long-duration soak is made by these reports.

Final source checks: `npm test` **32 files / 132 tests passed**;
`cargo test --manifest-path src-tauri/Cargo.toml -j 1` **42 passed**,
3 interactive tests excluded from that default command and **3 passed separately**.
`npm run test:ui` retry **passed** on WebView2: main host, settings/link status,
PDF selection, Copy, 42 Hanzi stroke paths, breakdown/note save, native measured
width 382 px, centered, inset 0 and outer frame 0. Source/harness committed on
`codex/translation-latency-456`; final measurement and package metadata follow.

The first native visibility gate exposed a production hide defect, repaired in
`96bdc9d`: direct nonactivating Win32 show must pair with direct Win32 hide,
because Tao still caches the initial hidden state. The earlier cycle-only
content check was insufficient; final stress also checks actual visibility,
nonfocus, stale native layout/close rejection, and hide after every sample.
The final font gate exposed a reset regression (`14px`, configured `16px`),
repaired in `bf3cb32`. Intermediate reports remain development evidence only.

## 04–06 final measurements — source `0067a1b`

Native debug / frontend production; same synthetic source, vi + zh targets, IPA,
controlled loopback HTTP delay 40 ms, OCR off. Five fresh processes/profiles,
5 cold + 100 warm; no competing build/test during measurement. Source code and
harness were committed, code diff SHA-256 empty in all final measurement JSON.
Metric remains text-ready → correct-paint proxy, excluding Windows acquisition.

| Phase | Cold p50 / p95 ms | Warm p50 / p95 ms | Provider requests / TCP | Dictionary parses |
| --- | --- | --- | --- | --- |
| Baseline | 1403.47 / 2173.10 | 1502.14 / 1972.89 | 210 / 210 | 105 |
| Main host (03) | 1151.56 / 1550.79 | 951.25 / 1169.93 | 210 / 10 | 5 |
| Retained tooltip | **985.10 / 1324.14** | **205.48 / 286.72** | **210 / 10** | **5** |

Controlled warm p50 decreases **86.3%**, p95 **85.5%** from baseline; p50 decreases
78.4% from main-host-only. Meets the predeclared p50/p95 and cold-p95 gates.
Warm median provider span per target **66.75 ms**, IPA **2.60 ms**. Targets run
in parallel, so spans are not summed. Provider request count and phonetics remain
unchanged. This is not a claim of an 86% improvement on real provider networks.

| Separate group | Cold ms | Warm p50 / p95 ms | Outcome |
| --- | --- | --- | --- |
| Chinese source / English target IPA | 882.70 | 196.46 / 239.05 | 21/21, one dictionary |
| OCR preload/recognition concurrent | 1747.54 | 327.42 / 2400.30 | 21/21, real Latin OCR recognized |
| Google real, small sample | 1071.23 | 258.27 / 306.33 | 6/6, only five warm samples |
| Main reload (functional, 1000 ms server) | N/A | N/A | 10 provider calls, two dictionary generations, old RPC fails and next succeeds |

OCR contention remains visible: warm maximum 5772.06 ms has `host-start` at
5616.20 ms, provider ~76 ms and IPA 2.20 ms. Another sample paints at 2400.30 ms
with result ready at 947.98 ms. This is main-host/browser scheduling contention,
not slow dictionary loading or a newly introduced translation queue. The 20-warm
OCR p95 is 4.6% above the historical baseline OCR group (2294.23 ms); do not claim
all OCR states improve. Cold OCR improves versus the historical single sample,
but one cold sample per group cannot establish a cold percentile.

`after-reuse-stress.json` verifies 50 ordinary show/hide cycles plus one explicit
destroy/recovery: exactly two view-ready events, 102 provider calls, one dictionary,
four IPC listener registrations, zero pending host RPC/OCR jobs and one result
mailbox across all samples. It also verifies native visible/nonfocused show,
stale ID layout/close rejection and actual hide after every presentation.
`crash-cdp-green.json` separately proves recovery after an observed renderer crash;
the next presentation retains main IPA (4 provider calls, dictionary fetch 1).

Median process-tree private bytes in the comparable group: **155.97 MiB before**,
**286.63 MiB after hide**, keeping the tooltip renderer alive. The old main-host
phase measured 232.8 MiB after destroy; these are different retained-window states,
not a like-for-like leak comparison. Stress checkpoints at cycles 10/25/50:
283.12 / 302.12 / 311.29 MiB, eight processes throughout. Longer soak follows;
these checkpoints alone do not prove a plateau.

Final UI smoke passed on the built assets after font preservation: main, Settings,
PDF selection, Copy, stroke paths, breakdown/note save and native frame/geometry.
The two late fixes were checked through native commands/UI (hide, computed font,
crash) and 20 focused frontend tests passed after the font fix. Full frontend/Rust
suite results above remain the broader regression evidence.

## Final hidden-settings guard — application source `336cad1`

The last review caught a retained-view-only settings race: a hidden old view
could send an unscoped close after native had already accepted the next request.
The public DOM/IPC test failed with the next presentation remaining invisible;
a view without an active presentation now sends no close command. All **32 files /
134 frontend tests pass** after this fix. Native application code remains the
crash/hide/geometry implementation already validated above.

Re-measured serially on the guarded frontend, same 5-process / 105-sample setup:

| Metric | Cold p50 / p95 ms | Warm p50 / p95 ms |
| --- | --- | --- |
| Final guarded tooltip | **902.68 / 1533.54** | **168.88 / 194.77** |

`after-reuse-final.json`: 210 provider requests / 10 provider TCP connections,
five dictionary fetch/parses, zero errors, one tooltip WebView per process.
`after-reuse-stress-final.json`: 50 normal cycles + explicit destroy/recovery,
102 provider calls, one dictionary and stable listener/RPC/OCR/mailbox counts.
`after-reuse-crash-final.json`: real CDP crash recovery, four provider calls and
one dictionary. `after-reuse-reload-final.json`: main restart rejection/recovery,
10 provider calls and two dictionary generations. All native gates passed.

`after-reuse-soak201.json`: 201 presentations, 402 provider calls, dictionary 1,
listener count 4, zero pending RPC/OCR jobs, result mailbox 1, eight processes.
Private bytes at cycles 10/25/50/end-201: 276.68 / 284.57 / 294.18 / 331.99 MiB.
The remaining upward allocator/heap trend justified a longer soak with later
checkpoints. Diagnostic-only checkpoint addition is committed in `748fc0b`;
application behavior is identical to `336cad1`. The final NSIS build must use
this source tree; metadata from the superseded `0067a1b` installer is historical.

## Extended resource plateau — `748fc0b`

`after-reuse-soak751.json`, production command path, **751 presentations / 1502
provider calls**, dictionary fetch/parse **1**, tooltip view-ready **1**, **0 errors**.
Four live IPC listeners throughout; native pending RPC **0**, OCR jobs **0**,
result mailbox **1**. Process count stays **8**.

| Cycle | Private bytes MiB | Working set MiB |
| --- | --- | --- |
| 10 | 267.37 | 505.73 |
| 25 | 281.58 | 519.71 |
| 50 | 300.15 | 538.09 |
| 100 | 334.68 | 574.02 |
| 200 | 356.39 | 607.15 |
| 500 | 346.48 | 595.50 |
| 750 | 353.52 | 602.87 |
| End 751 | 353.45 | 602.84 |

Growth during warm-up settles into a **346–356 MiB private-memory band over
cycles 200–751** rather than tracking request count. This is a bounded synthetic
soak, not an arbitrary-duration or all-content guarantee. The benchmark harness
also retains diagnostic samples/events in main for reporting, so this includes
that diagnostic overhead. No forced GC or manual memory trim was used.

All final application changes are in `336cad1`; `748fc0b` only extends diagnostic
memory checkpoints. Final packaging source is `748fc0bee349a93611e6d00e61aa726ae394b419`.
The 5-process comparable measurement stays `after-reuse-final.json`; its source
`336cad1` has identical production application code. Native UI smoke is rerun
before the final package build. Manual mixed-DPI hardware/source-app acceptance
remains explicitly unrun; mocked source-monitor scale and real single-monitor
WebView2 geometry/focus checks are the automated evidence.

## Completion evidence map

| Requirement | Evidence |
| --- | --- |
| Lazy window, retained reuse, no stale render/show/layout | native stress-final, 751-cycle soak, DOM A/B/dismiss/replay tests |
| Work starts before cold WebView readiness | `LATENCY_EXPECT_REUSE` trace gate in every final controlled run |
| Ready payload not lost; old timer/result rejected | snapshot-after-subscribe entrypoint, native cold content verification, parity/lifecycle tests |
| Hide resets OCR and reading UI without unloading main | `tooltip-lifecycle.test.ts`, OCR broker/client lifecycle suites, shared PDF/reload native group |
| Speech/Hanzi/Copy/fallback and reading geometry | shared tooltip reset path, desktop Hanzi tests, native UI smoke, drag/source-monitor-scale tests |
| Durable accepted Learning Saves | persistent main ownership retained; learning offline/restart/account queue and desktop service suites |
| Provider/key/target/master changes; display updates | translation-host, native-tooltip-parity, hidden-settings-race and settings suites |
| Hotkeys/clipboard/replacement | selected-text/input suites plus three separately run Windows interactive tests |
| Renderer crash and destroy recovery | final CDP crash and native destroy/recovery reports |
| Bounded listeners/jobs/window and memory plateau | 751-cycle soak: one view, 4 listeners, zero RPC/OCR jobs, mailbox 1, late memory band |
| No capture/recording regression | crop/overlay/recording suites and Rust commands |
| Comparison, targets, transport, IPA unchanged | final 5-process report, 210 provider requests / 10 TCP / 5 parses |
| Documentation and reproducible harness | CONTEXT, ADR-0006, README, MEASUREMENT, TDD, raw JSON |
| Source-matched installer and rollback | final build-artifacts/config hashes/SHA256SUMS; previous-release metadata and retained old installer |

Hardware checks are explicitly bounded: real current-monitor WebView2 geometry,
Copy/Hanzi and visibility/nonfocus ran; mixed-DPI multiple physical monitors and
user's external apps were not manually certified. These are stated validation
limits, not claims inferred from mock monitor geometry. Provider samples use
synthetic text only, no real Learning Account save. No push was requested; branch
and commits remain local.

Final Rust source rerun: `cargo test --manifest-path src-tauri/Cargo.toml --lib
--tests -j 1` passed **42 tests** on `748fc0b`; three interactive tests remain
separate from the default suite. Freshly rebuilt interactive binary was rerun
serially with synthetic windows and passed **3/3**. Final frontend suite:
**134/134**. Final WebView2 UI smoke on the guarded frontend passed all five
windows before packaging.
