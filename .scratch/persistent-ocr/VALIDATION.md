# Kiểm chứng OCR dùng chung model

Ngày: 2026-10-28. Snapshot trước triển khai: `2bbe5ed`.

## Kết quả

Main ẩn giữ model qua các lần tạo/hủy cửa sổ client. Overlay và tooltip gọi cùng client IPC; settings không khởi tạo runtime. Thay cấu hình OCR hoặc tắt tự động dịch chuyển/giải phóng pipeline an toàn.

- `npm test -- --maxWorkers=1 --minWorkers=1`: 18 file, **88 test qua** trên Node 26.12.1.
- `npm run build`: TypeScript và Vite qua. Vite vẫn cảnh báo chunk tooltip lớn do dữ liệu phonetics hiện có.
- `cargo test --manifest-path src-tauri/Cargo.toml`: **16 unit test + 10 integration test qua**, gồm command gọi qua Tauri MockRuntime thật.
- `cargo check --manifest-path src-tauri/Cargo.toml`: qua.
- `cargo build --manifest-path src-tauri/Cargo.toml`: qua.
- `git diff --check`: qua.

Test mới chỉ thay ranh giới ONNX/Tauri và môi trường trình duyệt/storage. Các module OCR, host, client và lifecycle dùng implementation thật. Test native gọi command qua IPC và kiểm tra timeout, nguồn gọi, correlation, hủy, hàng đợi, generation, đóng cửa sổ và đổi cấu hình.

## Các vòng đỏ → xanh đã thực hiện

1. Preload Latin chỉ chuẩn bị 2 session thay vì cả pipeline 5 session → dùng đúng Paddle + VietOCR, unload đầy đủ.
2. Hai preload đồng thời trả hai service khác nhau → serialize lifecycle và dùng chung model.
3. Lỗi một phần khi tạo VietOCR để lại tài nguyên → đợi các session tạo xong, release phần thành công và cho phép retry.
4. Unload release session trong lúc Latin recognition đang chạy → serialize cả recognition với preload/unload.
5. Các test command cho hàng đợi, hủy, host generation, quyền của main và timeout thất bại trước khi thêm hành vi tương ứng.
6. Client không hủy khi đóng và không timeout nếu mất phản hồi → hủy native request, dọn listener, thêm timeout phía client.
7. Snapshot settings cũ ghi đè thao tác tắt OCR lúc startup → đăng ký listener trước và ưu tiên transition mới nhất.
8. Main bị nhận nhầm thành overlay khi có ảnh chờ; tooltip OCR cục bộ → nhận diện label main, chuyển tooltip/overlay sang IPC.
9. Test WebView2 thật trả text nhưng thiếu blocks → đọc kết quả `lines` của Paddle và chuyển box đúng định dạng.
10. Test ảnh số 1 nhận text số 0 → tắt cache kết quả dựa trên image hash dễ trùng của SDK, giữ nguyên cache model/session.

## WebView2 thật

Harness: `src-tauri/examples/ocr_smoke.rs`, `tests/runtime/ocr-smoke.ts`, `tests/runtime/ocr-smoke-client.ts`.

Chạy trong hai terminal:

```powershell
npm run dev
```

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example ocr_smoke
```

Harness dùng profile `.scratch/tmp/ocr-smoke-profile` riêng, settings trong RAM, ảnh tạo bằng canvas; không gọi API dịch. Main và client đều ẩn. Mỗi ảnh tạo một cửa sổ client `tooltip` mới, gửi OCR rồi hủy cửa sổ đó. Session được đếm trực tiếp tại ranh giới ONNX Runtime.

Đã thử 10 ảnh khác nhau mỗi pipeline, kiểm tra số 0–9 trong text và blocks có dữ liệu, đổi `ch` → `latin`, tắt/bật lại với tier `tiny`, nhận dạng lại thành công. Chế độ đối chứng chủ động unload trước mỗi ảnh cũng chạy 10 lượt mỗi pipeline.

| Pipeline medium | Session đang dùng | Session tạo thêm trong 10 lượt giữ model | Median OCR qua IPC | Median đối chứng reload mỗi lượt |
| --- | ---: | ---: | ---: | ---: |
| Chinese Paddle | 2 | **0** | 706 ms | 1.199 ms |
| Latin Paddle + VietOCR | 5 | **0** | 923 ms | 1.598 ms |

Median giảm khoảng 493 ms cho Chinese và 675 ms cho Latin trong lượt đo cuối. Thời gian preload ban đầu tương ứng khoảng 1,33 s và 2,61 s. Đây là đo dev trên cùng engine cuối cùng với hai cách quản lý model, **không phải benchmark toàn bộ app cũ**. Mức tải máy, cache file, khởi tạo WASM và GPU ảnh hưởng thời gian; không coi đây là cam kết latency cho mọi ảnh.

Toàn bộ lượt gồm đối chứng tạo **79 session và release đủ 79 session**. Counter không tăng trong từng nhóm 10 lượt giữ model. Kết quả thô và từng ảnh ở `runtime-results.json`.

## RAM

Đếm Rust app và cây process WebView2 thuộc lần chạy harness hiện tại, loại process đo PowerShell và các process từ lần chạy cũ.

| Thời điểm | Working set tổng |
| --- | ---: |
| Ban đầu, OCR tắt | 314 MiB |
| Chinese medium sau 5 / 10 ảnh giữ model | 912 / 789 MiB |
| Latin medium sau 5 / 10 ảnh giữ model | 871 / 889 MiB |
| Sau các lượt đối chứng reload và tắt OCR | 1.065 MiB |

Tổng RAM dev khi giữ medium khoảng **0,8–0,9 GiB**, gồm WebView2. Các session đã release nhưng bộ cấp phát WASM/browser vẫn có thể giữ vùng nhớ đã cấp phát; tắt OCR không bảo đảm working set quay về mức ban đầu. Số đo không cho thấy tăng session theo số lần chụp; hai mẫu RAM sau 5/10 ảnh chưa thay thế một bài soak test dài.

## Giới hạn và thay đổi so với kế hoạch

- Đo nền được thay bằng đối chứng reload trong cùng engine cuối cùng; không chạy lại toàn bộ checkout cũ. Đã ghi rõ giới hạn này trong kết quả.
- Harness xác minh WebView2/ONNX/IPC và đóng/mở cửa sổ thật bằng ảnh tổng hợp. Chưa thao tác thủ công toàn bộ luồng hotkey → crop màn hình vật lý, multi-monitor/DPI hoặc API dịch ngoài; test crop/coordinate/translation hiện có vẫn qua.
- Partial initialization được kiểm chứng cho pipeline VietOCR; cleanup bên trong khởi tạo Paddle còn phụ thuộc SDK. Test không sửa hoặc mock implementation của SDK Paddle.
- Timeout hủy việc chờ/trả kết quả; inference ONNX đã bắt đầu được chạy tới khi kết thúc an toàn. Host reload tạo generation mới; host lỗi không làm tooltip tự tạo thêm model.
- Sửa môi trường test Node 26 bằng cách dùng storage thật từ JSDOM. Thêm manifest Common Controls v6 riêng cho integration test/example để chúng chạy trên Windows; application giữ manifest do Tauri tạo.

ADR: `docs/adr/0002-persistent-main-ocr.md`.

Commit `2bbe5ed` chứa trạng thái trước triển khai. Phần triển khai mới được giữ ở working tree để review; không push hoặc cài đè app đang dùng.
