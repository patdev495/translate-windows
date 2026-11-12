# Validation — translation latency issues 01–03

Date: 2026-11-12
Status: done

Đã triển khai baseline/instrumentation, app-managed HTTP pooling và main-owned translation/IPA theo TDD. Phạm vi bàn giao là source, test và benchmark của issues 01–03.

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
