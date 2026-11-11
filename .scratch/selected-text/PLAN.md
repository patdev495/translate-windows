# Kế hoạch: Selected Text Translation bằng Ctrl đơn lẻ

Status: done
Date: 2026-11-11

Hành vi sản phẩm đã thống nhất trong [PRD.md](./PRD.md). Người dùng đã xác nhận cả ba ranh giới kiểm thử S1–S3 và yêu cầu triển khai theo kế hoạch. Thực hiện các lát TDD bên dưới.

## Kết quả cần đạt

Bôi đen trong ứng dụng nguồn → nhấn/nhả Ctrl trái hoặc phải đơn lẻ → đọc UIA → không lấy được thì Copy → dịch và hiện tooltip. UIA thành công giữ nguyên clipboard; Copy thành công để text mới trong clipboard. Thất bại báo ngắn, không gọi dịch với clipboard cũ và không tự bật OCR.

## Các ranh giới kiểm thử đề nghị xác nhận

### S1. Luồng sự kiện đầu vào native → yêu cầu Selected Text Translation

Đưa một chuỗi sự kiện nhấn/nhả phím và click/cuộn chuột vào public interface nhận input của tính năng; quan sát yêu cầu dịch được phát ra. Không test trực tiếp biến trạng thái, private helper hay cách tổ chức bộ nhận Ctrl.

- Ctrl trái/phải đơn lẻ tạo đúng một yêu cầu sau lúc nhả.
- Key repeat không tạo thêm yêu cầu; Ctrl+C/V/3, phím đang giữ từ trước, hai Ctrl chồng nhau và click/cuộn khi giữ Ctrl không gây dịch ngoài ý muốn.
- Phím Copy do app phát không tự kích hoạt lại tính năng.
- Sự kiện tiếp tục đi tới ứng dụng nguồn; tính năng không nuốt Ctrl hoặc tổ hợp hiện có.

### S2. Yêu cầu lấy Selected Text → kết quả text hoặc thất bại

Gọi public acquisition interface thực, quan sát text/lỗi trả về cùng trạng thái clipboard tại ranh giới Windows. Dùng fake chỉ cho OS/UIA/clipboard/đồng hồ; không mock các module điều phối của repo.

- UIA có text: dùng đúng vùng chọn, không gửi Copy, clipboard không đổi.
- UIA không hỗ trợ/rỗng/lỗi/timeout: chuyển sang Copy; UIA nhiều range trả nội dung theo thứ tự provider.
- Copy chỉ chấp nhận lần cập nhật clipboard mới; cùng nội dung với lần trước vẫn hợp lệ nếu thực sự được copy lại.
- Clipboard bị khóa tạm thời được retry trong deadline; không có text mới hoặc chỉ có ảnh thì thất bại hữu hạn.
- Mất focus, nguồn bị đóng, người dùng bắt đầu thao tác phím mới hoặc kết quả đến trễ: không Copy nhầm nơi và không hiện kết quả cũ.
- Không khởi tạo vô hạn worker khi provider UIA chậm; giới hạn một lượt lấy chữ đang hoạt động.
- Smoke test Windows dùng nguồn text tổng hợp trong cửa sổ test riêng để kiểm tra adapter UIA, SendInput và clipboard thật qua cùng interface này. Không gửi text tới dịch vụ dịch trong smoke test native.

### S3. Payload tooltip → nội dung người dùng thấy và yêu cầu dịch

Test từ entrypoint tooltip với DOM thật trong jsdom, controller và logic dịch thật. Chỉ thay IPC Tauri, Windows/window APIs và HTTP của nhà cung cấp dịch ở ranh giới ngoài hệ thống.

- Payload text hiển thị source và bản dịch bằng cài đặt hiện có; không yêu cầu OCR.
- Payload báo lỗi chỉ hiện “Không lấy được văn bản”, không gọi dịch hay OCR; tự đóng sau khoảng ngắn.
- Payload ảnh của đường OCR cũ vẫn chạy như trước.

Ba seam trên là phạm vi test đề nghị; không thêm seam khác nếu chưa xác nhận. Các ca liệt kê là bản đồ hành vi, không phải yêu cầu viết toàn bộ test trước implementation.

## Kiến trúc và tệp dự kiến

- `src-tauri/src/selected_text/mod.rs`: contract input/source/result và điều phối tính năng; giới hạn concurrency, deadline, xác nhận nguồn còn hợp lệ, loại kết quả trễ.
- `src-tauri/src/selected_text/gesture.rs`: xử lý Ctrl đơn lẻ, được kiểm chứng qua S1 thay vì gọi private helper.
- `src-tauri/src/selected_text/windows.rs`: keyboard/mouse hooks, native foreground identity, COM/UIA worker, Copy và clipboard. Có thể tách adapter UIA ra tệp riêng nếu kích thước cần thiết.
- `src-tauri/src/lib.rs`: đăng ký service khi startup và cleanup khi thoát, chuyển kết quả thành TooltipData, mở tooltip trên UI thread. Chỉ thêm phần cần cho tính năng, bảo toàn thay đổi persistent OCR đang có trong working tree.
- `src-tauri/Cargo.toml` và lock: thêm Windows COM/UIA bindings và feature Win32 cần thiết; ưu tiên dùng phiên bản `windows` đã có trong lock để hạn chế tăng dependency.
- `src/tooltip.ts`: hỗ trợ payload lỗi ngắn, không chuyển thông báo lỗi thành source text đem đi dịch. Tái sử dụng giao diện dịch hiện tại và vị trí tooltip hiện tại.
- `src-tauri/tests/selected_text.rs`, test tooltip trong `tests/`, và native smoke harness: chỉ tạo sau khi S1–S3 được xác nhận.
- `CONTEXT.md`: giữ glossary đã chốt; không ghi chi tiết API/test vào glossary.

## Chi tiết xử lý native

1. Theo dõi keyboard/mouse trên thread có message loop; callback trả nhanh, luôn truyền input tiếp. Khi Ctrl hợp lệ được nhả, chụp danh tính cửa sổ nguồn và gửi yêu cầu sang worker, không mở tooltip lúc này.
2. Loại cửa sổ thuộc chính app khỏi yêu cầu dịch toàn cục để tránh vòng tự dịch và không tác động vào settings/overlay.
3. UIA chạy trên COM MTA riêng. Bắt đầu từ phần tử focus trong cửa sổ nguồn, tìm TextPattern trong phạm vi nguồn với số bước hữu hạn. Chỉ đọc GetSelection/GetText, không đọc toàn document để thay vùng chọn rỗng.
4. Đặt connection/transaction timeout nếu UIA hỗ trợ; deadline tổng của lượt UIA độc lập. Nếu timeout thì bỏ kết quả trễ và chuyển Copy; không sinh một thread mới không giới hạn sau mỗi lần Ctrl.
5. Trước Copy xác nhận nguồn và trạng thái bàn phím còn phù hợp. Lưu sequence clipboard, phát Ctrl+C có đánh dấu input của app, chờ sequence mới rồi đọc Unicode text ổn định. Không xóa clipboard trước, không khôi phục clipboard sau, không dùng so sánh chuỗi làm bằng chứng copy thành công.
6. Xác nhận nguồn trước khi giao text cho tooltip. Chỉ sau đó mở tooltip và tái sử dụng luồng dịch. Lỗi lấy chữ chuyển thành payload báo ngắn riêng.
7. Khi thoát, tháo hook và dừng message loop/worker; khi nguồn đổi hoặc request hết hạn, kết quả cũ không được tác động UI. Các deadline chính xác được ghi lại sau khi đo smoke test, không tự cam kết độ trễ chưa đo.

## Các lát TDD theo thứ tự

Mỗi lượt: chọn **một** hành vi ở seam đã xác nhận → viết **một** test → chạy và ghi nhận đỏ đúng lý do → thêm code tối thiểu → chạy xanh. Không viết cả bộ test trước; không refactor ngoài phạm vi lát đang làm.

1. **S1:** Ctrl trái nhấn/nhả tạo một yêu cầu; nối skeleton public input contract với gesture handling tối thiểu.
2. **S1:** lần lượt thêm Ctrl phải, tổ hợp phím, chuột, key repeat và injected input theo các vòng riêng.
3. **S2:** UIA trả text thành công, clipboard giữ nguyên; thêm acquisition contract và adapter seam.
4. **S2:** UIA không có chữ → Copy thành công; tiếp tục từng ca stale clipboard, copy cùng text và lỗi/timeout/focus trong vòng riêng.
5. **S3:** payload text đi qua entrypoint tooltip tới giao diện dịch mà không OCR; nối native result vào tooltip.
6. **S3:** payload lỗi không gọi dịch/OCR, hiện thông báo ngắn và tự đóng.
7. **S1/S2 native:** nối hook, UIA và clipboard thật; tạo một ca smoke thất bại trước rồi hiện thực adapter đủ cho ca đó. Mở rộng từng ca khi kết quả trước cho thấy cần thiết.
8. Chạy kiểm chứng toàn bộ, sửa lỗi tại seam liên quan bằng vòng đỏ/xanh, ghi số liệu và giới hạn thực tế.

## Kiểm chứng và bàn giao

- Mốc trước sửa: chạy `npm test -- --reporter=dot` và `cargo test --manifest-path src-tauri/Cargo.toml`; ghi kết quả để phân biệt lỗi có sẵn.
- Sau mỗi lát, chạy test mục tiêu tương ứng. Khi tích hợp xong, chạy lại `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml` và `cargo check --manifest-path src-tauri/Cargo.toml`.
- Smoke test adapter Windows dùng dữ liệu tổng hợp, kiểm tra text/clipboard/timeout; test UI dùng HTTP giả ở ranh giới nhà cung cấp dịch, không tốn API thật.
- Ghi `.scratch/selected-text/VALIDATION.md`: lệnh, kết quả, bằng chứng đỏ/xanh theo lát, kiểm thử thật đã chạy và phần chưa chạy. Không ghi chữ người dùng đang bôi đen vào log phát triển.
- Bàn giao hướng dẫn test Ctrl đơn lẻ trên các app người dùng muốn thử, cùng giới hạn phụ thuộc accessibility và quyền ứng dụng. Không tuyên bố đã kiểm chứng mọi app.

## Triển khai thực tế

- `src-tauri/src/selected_text/mod.rs` chứa public input interface, CtrlTrigger và điều phối acquisition qua Windows boundary. Quy mô hiện tại chưa cần tách gesture ra tệp riêng.
- `src-tauri/src/selected_text/windows.rs` chứa worker COM/UIA, Copy/clipboard, keyboard/mouse hooks, kiểm tra nguồn/input epoch và cleanup.
- `src-tauri/src/lib.rs` khởi động/dừng runtime, chuyển text hoặc lỗi thành payload tooltip và kiểm tra nguồn lần cuối trên UI thread.
- `src/tooltip.ts` dùng luồng dịch hiện có cho text và hỗ trợ thông báo lấy chữ thất bại tự đóng sau 2 giây.
- Test tại S1/S2: `src-tauri/tests/selected_text.rs`; native smoke S1/S2: `src-tauri/tests/selected_text_windows.rs`; tooltip S3: `tests/selected-text-tooltip.test.ts`.
- Các kết quả đỏ/xanh, lệnh chạy và giới hạn kiểm chứng được ghi tại [VALIDATION.md](./VALIDATION.md).

## Tài liệu API đã đối chiếu

- [UIA GetSelection](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextpattern-getselection)
- [UIA threading](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading)
- [UIA provider timeouts](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomation2)
- [Keyboard hook và message loop](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)
- [Clipboard sequence number](https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard#query-the-clipboard-sequence-number)
