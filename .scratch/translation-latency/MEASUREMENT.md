# Phép đo translation latency

`npm run bench:translation` build frontend production, chạy native debug với feature
`latency-harness`, 5 process/profile mới, mỗi process có 1 mẫu cold và 20 mẫu warm.
Native tooltip được tạo bởi command `open_tooltip_window` production. Không dùng
helper tạo window thay thế. Mạng kiểm soát dùng HTTP loopback với delay 40 ms,
hai target vi/zh và source English có IPA. Không cache kết quả dịch.

PowerShell, dùng cùng assets đã build để thu đối chiếu provider thật:

```powershell
$env:LATENCY_SKIP_BUILD='1'
$env:LATENCY_REAL='1'
$env:LATENCY_RUNS='1'
$env:LATENCY_REPORT='.scratch/translation-latency/baseline-real.json'
npm run bench:translation
```

Gỡ `LATENCY_REAL` trước khi đo controlled lần sau. `LATENCY_REPORT` chọn tên file
sau mỗi bước; mặc định là `baseline.json`. Không dùng skip-build sau thay đổi TS.

Mỗi mẫu có ID, cold/warm, new/repeated, duration provider/IPA/fetch/parse và các
mốc native text-ready → view-ready/result-ready/correct-paint. Các duration JS
dùng monotonic clock tại cùng WebView; elapsed dùng Instant ở native khi nhận
event. Không trừ timestamp JS với Rust. Correct-paint được báo sau fit native
và hai animation frame. Đây là proxy paint sau layout, chưa kiểm chứng pixel
bằng screenshot. Resource report gồm window count và process-tree memory.

Giới hạn: chưa đo acquisition hook/UIA/Copy; không gọi số đo này là gesture
end-to-end. Bộ chính tắt OCR. Nhóm `LATENCY_OCR=1` chạy preload/recognition
Latin thật đồng thời với dịch và báo `ocrResult`; chỉ dùng nhóm đó để so cạnh tranh
CPU giữa OCR và dịch. Server kiểm soát chỉ đo overhead ứng dụng, không
đại diện latency DeepL thật. Diagnostic feature không được bật trong release;
bootstrap endpoint không mở allowlist cho người dùng hoặc command payload.
Log không có source text, ảnh, credential hoặc account.

## Mục tiêu chốt sau baseline, trước tối ưu

Baseline controlled 5 cold + 100 warm: warm p50 **1502,14 ms**, p95 **1972,89 ms**.
Sau chuyển host: warm p50 <= **1351,93 ms** (giảm 10%), p95 <= **2170,17 ms**
(không tăng quá 10%). HTTP pooling trước hết phải đạt reuse TCP thật; so số đo
riêng để không gán cải thiện IPA cho client pooling. Số request provider giữ nguyên.
Baseline chính ở `baseline.json`; nhóm nguồn Trung/OCR/provider thật báo riêng.

Nhóm bổ sung (mỗi nhóm đặt `LATENCY_RUNS=1`, `LATENCY_REPORT` riêng):
`LATENCY_SOURCE=zh` để buộc IPA ở target; `LATENCY_OCR=1` để chạy OCR Latin thật
đồng thời; `LATENCY_REAL=1` dùng 6 mẫu provider thật (12 request); thêm
`LATENCY_PROVIDER=google` cho đối chiếu Google. Gỡ từng biến sau khi đo.

## Sau HTTP pooling

`after-http.json`: 5 cold + 100 warm, cùng frontend và cấu hình controlled.
Warm p50 **1310,22 ms**, p95 **1917,75 ms**; **210 requests / 10 provider TCP
connections**, so với baseline 210 / 210. Dictionary vẫn parse theo tooltip mới.
Đây là overhead trên loopback; không suy ra phần trăm cải thiện DeepL thật.

## Kiểm tra host và giới hạn báo cáo

`LATENCY_SHARED_TEST=1 LATENCY_EXPECT_SHARED_IPA=1 LATENCY_RUNS=1` chạy hai
Native Tooltip Window mới và một PDF Reader thật, chọn Hello PDF qua shortcut.
Server và trace phải thấy đúng một fetch/parse dictionary cho một host.
Thêm `LATENCY_RESTART_TEST=1` để PDF giữ một RPC đang chạy, reload main qua
WebView thật, xác nhận RPC cũ báo restarted và RPC tiếp theo có IPA. Mode này
đặt network delay 1000 ms, có hai host generations; chỉ là functional test,
không so p50/p95 với benchmark 40 ms. JSON: `host-reload.json`.

Bỏ `LATENCY_SHARED_TEST` và `LATENCY_RESTART_TEST` khi đo hiệu năng. Có thể giữ
`LATENCY_EXPECT_SHARED_IPA=1` với controlled benchmark để gate một dictionary
fetch/parse mỗi process. Bỏ gate khi provider thật lỗi trước bước IPA.

`host-dispatch`/`host-start` là mốc IPC; `host-rpc` là duration round-trip đầy đủ,
bao gồm provider/IPA, không cộng nó vào các provider duration. Trace phân biệt
`dictionary-miss`, `dictionary-wait`, `dictionary-hit` ở bản host chung. Baseline
cũ có thể suy ra cache miss từ fetch/parse vì mỗi view đều tải lại dictionary.

Memory sau cùng được lấy sau command destroy tooltip, chưa chờ OS thu hồi mọi
renderer/allocator; không coi đó là steady idle. Cancellation không được inject
trong ma trận latency; reload functional test có một RPC bị hủy có chủ đích.
Google/DeepL thật chỉ là tập đối chiếu nhỏ; không dùng percentile nhỏ đó để hứa
mức tăng tốc ngoài mạng kiểm soát. `baseline-trace.json` là kiểm tra instrumentation
với source Trung, không thay baseline chính nguồn English.

Reload gate bổ sung: đúng **10 provider requests** (2 tooltip × 2 targets,
PDF × 2 targets, RPC bị reload × 2 targets, RPC kế tiếp × 2 targets). Native
transport generation và ledger invocation ID chặn nhánh IPC gửi lại khi navigation
hủy custom-protocol response. Ledger giới hạn 1024 ID/60 giây, không lưu response.

Harness hiện tại còn kiểm tra DOM trước khi nhận mẫu thành công: source text
phải khớp payload request hiện tại và hai target translation phải có nội dung.
Stage `content-verified` bổ sung bằng chứng nội dung; timestamp `correct-paint`
vẫn do đường production gửi sau fit/two animation frames, không thay bằng helper.

`cold` là lần dịch đầu trong process/profile mới sau handshake host-ready;
không phải tổng thời gian khởi động ứng dụng. `warm` là các lần tiếp theo trong
cùng process, vẫn tạo Native Tooltip Window mới. Cả hai dùng mốc text-ready và
không bao gồm acquisition Windows hoặc startup trước khi có text.

## Retained tooltip reproduction

```powershell
$env:LATENCY_SKIP_BUILD='1' # only after npm run build on the source under test
$env:LATENCY_EXPECT_REUSE='1'
$env:LATENCY_EXPECT_SHARED_IPA='1'
$env:LATENCY_RUNS='5'
$env:LATENCY_REPORT='.scratch/translation-latency/after-reuse.json'
npm run bench:translation
```

For resource/recovery validation use `LATENCY_RUNS=1`, `LATENCY_SAMPLES=51`,
`LATENCY_RECOVERY=1`, and a separate report path. First 50 presentations must use
one WebView; the last destroys it explicitly and checks recreation. Memory is
sampled after 10/25/50 presentations outside the next timed interval. Remove
`LATENCY_SAMPLES`/`LATENCY_RECOVERY` before the comparable 5 cold + 100 warm run.

`LATENCY_EXPECT_REUSE` gates actual view-ready count, cold host dispatch before
view-ready, stable IPC listener registrations, no pending host RPC/OCR jobs
(OCR-off group), at most one native result mailbox, and unchanged provider
request count. The diagnostic driver reads the locked Tauri 2.11.5 event
registration table, counts live entries and retains no payloads or callbacks.
Native resource commands exist only in the diagnostic feature, absent from release.
Normal `latency_next` now hides through the production close command; previous
phases destroyed their tooltip. Windows warm show uses SW_SHOWNOACTIVATE.
Final native samples also verify the computed reading font against public
settings. Recovery mode checks visible/nonfocused state, stale native layout and
close commands, and actual hidden state after dismiss; it is a functional group,
separate from the comparable 5-process latency group.

For an actual isolated WebView2 renderer crash, add `LATENCY_CRASH=1` alongside
`LATENCY_RECOVERY=1` and `LATENCY_SAMPLES=2`. The diagnostic native command
calls DevTools `Page.crash` on the synthetic tooltip, requires the failed window to
be retired, and the next production request must create a new controller, preserve
main IPA and keep provider counts. This intentionally crashes only a diagnostic
profile; do not use recovery/crash samples in the comparable latency percentiles.

For extended plateau observation use `LATENCY_SAMPLES=751`, `LATENCY_RUNS=1`,
without recovery/crash flags. The driver samples memory at 10/25/50/100/200/500/750
cycles, outside the next timed sample. `after-reuse-soak751.json` records one view,
1502 provider requests, one dictionary, stable listeners/jobs and late plateau.
