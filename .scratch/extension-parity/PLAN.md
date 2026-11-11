# Kế hoạch đưa chức năng extension vào desktop

Status: done
Date: 2026-11-11

Phạm vi và hành vi nằm trong [PRD.md](./PRD.md), đã được người dùng duyệt và cho phép triển khai bằng TDD. Các ranh giới S1–S6 tại [TDD-SEAMS.md](./TDD-SEAMS.md) cũng đã được duyệt. Các bước là thứ tự thực hiện của một phạm vi hoàn chỉnh, không phải đề nghị cắt bớt chức năng ở bản bàn giao.

Mỗi lần thực hiện chỉ viết một test tại ranh giới đã duyệt, chạy để thấy thất bại đúng hành vi còn thiếu, triển khai tối thiểu cho test đó chạy đúng rồi tiếp tục. Không viết hàng loạt test trước; không mock các module nội bộ hoặc test cấu trúc file/CSS thuần túy.

## 1. Chốt đường kết nối nền tảng và bảo toàn công việc hiện có

- Ghi nhận working tree, kiểm tra build/test hiện có và đọc các kiểm chứng OCR/Selected Text trước khi sửa.
- Đối chiếu Settings, tooltip, Hanzi, PDF và Learning Library với mã extension để lập bảng chức năng thực tế.
- Giữ lõi dịch, phonetics, dữ liệu và giao diện có thể tái sử dụng; thay những phụ thuộc chrome.storage/runtime/tabs/alarms bằng các cổng desktop có trách nhiệm rõ ràng. Không chuyển nguyên service worker/content script sang Windows mà bỏ qua khác biệt vòng đời.
- Tiếp tục dùng cơ chế IPC, lưu settings native và OCR host hiện có; không sửa phần quay màn hình ngoài việc cần thiết để giữ tương thích.

## 2. Settings và phím tắt

- Đưa giao diện năm tab và tùy chọn còn thiếu từ extension sang desktop, bao gồm nhà cung cấp, Hanzi, tài khoản và backup.
- Bổ sung hai phím dịch độc lập, mặc định Alt+Q/Alt+W, ghi nhận tổ hợp do người dùng nhấn; áp dụng lại đăng ký khi đổi, phát hiện trùng/lỗi và giữ cấu hình cũ nếu không áp dụng được.
- Tách tự dịch vùng chọn khỏi tự dịch sau chụp OCR; chuyển cài đặt cũ mà không xóa dữ liệu hoặc thay đổi quay màn hình.

## 3. Dịch chữ, tự dịch và thay thế trong ứng dụng Windows

- Đổi bộ kích hoạt Ctrl cố định thành đường yêu cầu dịch theo phím cấu hình. Giữ các bảo đảm UIA/Copy, clipboard mới, focus, thời hạn và chống tái kích hoạt do sự kiện app tự phát.
- Bổ sung tự dịch khi người dùng hoàn tất vùng chọn: chỉ đọc trực tiếp, bỏ qua vùng chọn không lấy được, loại sự kiện của app và kết quả đã hết hiệu lực; không thực hiện công việc chậm trong callback hook.
- Bổ sung thay vùng chọn trong ô chỉnh sửa: xác thực nguồn/vùng chọn trước khi áp dụng, dịch sang ngôn ngữ chính, hỗ trợ hoàn tác tại ứng dụng có khả năng đó, không thay toàn bộ ô hoặc sửa ô mật khẩu.
- Khi không thể áp dụng an toàn thì không ghi đè nguồn; chuyển kết quả sang tooltip có nút Copy và thông báo ngắn.

## 4. Tooltip và học chữ Hán

- Đưa giao diện, CSS, điều khiển dịch/phonetics/âm thanh/từ điển từ extension sang tooltip desktop; giữ cách cửa sổ native cuộn và nằm trong màn hình.
- Bổ sung viết nét, phân tích thành phần, vòng lặp, bảng nổi riêng, nghĩa cá nhân và ghi chú.
- Lưu dữ liệu cục bộ dùng chung giữa các cửa sổ; nhập/xuất JSON tương thích extension, giữ xử lý xung đột và giấy phép tài nguyên.

## 5. Learning Library và PDF

- Đưa luồng liên kết tài khoản qua website, lưu từ/câu/cặp, chọn thư mục và hàng đợi đồng bộ sang host desktop; bảo toàn trạng thái sau khi đóng tooltip hoặc khởi động lại.
- Giới hạn dữ liệu đồng bộ theo tài khoản và vòng đời liên kết; không nhập nhầm hàng đợi của tài khoản cũ vào tài khoản mới.
- Bổ sung cửa sổ PDF và mục mở từ khay hệ thống, dùng trình đọc/giao diện của extension làm cơ sở; mở file, mật khẩu, điều hướng, zoom, vùng chọn chữ/OCR và tooltip đầy đủ.
- PDF dùng lại OCR host và các dịch vụ chung thay vì nạp lại model hoặc tạo kho dữ liệu riêng.

## 6. Kiểm tra và bàn giao đầy đủ

- Chạy `npm run build`, `npm test` và kiểm tra Rust phù hợp (`cargo test --manifest-path src-tauri/Cargo.toml`); xử lý lỗi liên quan và ghi rõ lỗi có sẵn nếu có.
- Kiểm tra các ranh giới có rủi ro thực: đăng ký/đổi phím, sự kiện native, không đổi clipboard ở tự dịch, nguồn đã đổi, thay thế/fallback, Settings liên cửa sổ, vòng đời OCR, backup/import, liên kết/hàng đợi và PDF.
- Dùng dữ liệu tổng hợp và dịch vụ test cục bộ cho kiểm tra tự động; không cần người dùng đưa danh sách ứng dụng, không tạo dữ liệu trên tài khoản học thật để kiểm thử.
- Build bộ cài Windows phù hợp và kiểm tra tài nguyên đóng gói, cửa sổ/khay, PDF và hành vi quay màn hình còn nguyên. Không coi riêng build frontend thành công là hoàn thành toàn bộ.
- Ghi kết quả và giới hạn thực tế vào `VALIDATION.md` khi có bằng chứng; cung cấp bản build để người dùng tự nghiệm thu theo cách riêng.

## Comments

- 2026-11-11: Hoàn tất các bước 1–6. Frontend 105 test đạt; Rust 41 đạt, 3 ignored; WebView2 5/5 trang đạt. Build release và NSIS thành công. Bằng chứng, SHA-256 và giới hạn nghiệm thu nằm trong [VALIDATION.md](./VALIDATION.md).
