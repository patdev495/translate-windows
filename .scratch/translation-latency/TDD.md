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
