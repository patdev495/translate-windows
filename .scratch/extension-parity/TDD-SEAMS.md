# Ranh giới kiểm thử TDD đã duyệt

Status: done
Date: 2026-11-11

Phạm vi [PRD.md](./PRD.md) và các ranh giới S1–S6 dưới đây đã được người dùng duyệt: "Duyệt S1–S6, tiếp tục code". Đây là những giao diện công khai được phép quan sát hành vi qua TDD; không phải ghi nhận đã hoàn thành triển khai.

## S1. Settings người dùng → cấu hình có hiệu lực

Tương tác cửa sổ Settings thật và giao diện lệnh settings công khai của desktop; đọc lại cấu hình qua cùng giao diện, quan sát trạng thái lưu/lỗi và sự thay đổi ở cửa sổ khác.

Bao gồm lưu/khôi phục cài đặt, hai phím dịch riêng, công tắc tự dịch, nâng cấp cài đặt cũ, lỗi/trùng phím không làm mất cấu hình hoạt động. Chỉ thay ranh giới Tauri/OS khi chạy test DOM; kiểm tra đăng ký native qua giao diện lệnh thật trong test Rust.

## S2. Yêu cầu dịch trong Windows → kết quả và thay đổi trong ứng dụng nguồn

Đi từ sự kiện đầu vào của service native hoặc giao diện yêu cầu dịch/thay thế công khai tới kết quả hiển thị được và trạng thái vùng chọn/clipboard tại ranh giới Windows.

Bao gồm phím đã cấu hình, tự dịch chỉ đọc trực tiếp, dịch chủ động được thử Copy, thay đúng vùng chọn, bỏ nguồn/kết quả hết hiệu lực, không sửa ô mật khẩu, lỗi thay chữ trả kết quả cho tooltip. Không gọi helper nhận diện tổ hợp phím hoặc bộ theo dõi private để kiểm chứng. Cho phép thay Windows input/UIA/clipboard/đồng hồ tại ranh giới hệ thống; smoke test dùng cửa sổ nguồn và chữ tổng hợp.

## S3. Tooltip và học chữ Hán → nội dung và thao tác người dùng

Khởi tạo entrypoint tooltip thật với payload desktop, tương tác DOM thật và các API dữ liệu học công khai; quan sát chữ, phiên âm, lựa chọn đọc, nội dung bảng Hanzi, kết quả lưu/đọc lại và file backup qua API xuất/nhập công khai.

Bao gồm tooltip từ chữ/OCR, fallback không thay được chữ, tương tác chữ/phiên âm, nét/thành phần Hanzi và dữ liệu cá nhân tương thích JSON extension. Chỉ thay IPC/window, mạng, âm thanh và file tại ranh giới ngoài; không mock controller, dịch vụ phonetics hay module học nội bộ. Không dùng snapshot HTML/CSS hoặc test private helper.

## S4. Liên kết và lưu học tập → trạng thái tài khoản/hàng đợi và kết quả server

Gọi các thao tác công khai mà Settings/tooltip dùng để liên kết, lấy trạng thái, lưu, xem hàng đợi, thử lại và ngắt liên kết; quan sát kết quả qua cùng API hoặc giao diện người dùng.

Bao gồm lưu từ/câu/cặp, offline rồi đồng bộ lại, khởi động lại host, đổi/ngắt tài khoản không trộn dữ liệu. Dùng HTTP server giả tại ranh giới mạng và kho test cục bộ; không mock bộ điều phối đồng bộ hoặc kiểm chứng bằng cách đọc thẳng database ngoài giao diện công khai.

## S5. Desktop PDF Reader → tài liệu và yêu cầu dịch/OCR người dùng

Đi qua entrypoint cửa sổ đọc PDF với file PDF tổng hợp và thao tác mở, mật khẩu, chuyển trang, zoom, chọn chữ/vùng ảnh; quan sát tài liệu hiển thị, lỗi có thể đọc được và kết quả/yêu cầu dịch OCR qua giao diện desktop công khai.

Giữ PDF.js và luồng ứng dụng thật; thay file picker, Tauri/OS, dịch vụ dịch và OCR ngoài tiến trình tại ranh giới hệ thống khi cần. Không xác nhận bằng chuỗi import, tên hàm render private hoặc cấu trúc file.

## S6. Khay hệ thống, capture và OCR host → vòng đời desktop không hồi quy

Gọi các lệnh Tauri công khai/đầu vào capture để mở/đóng cửa sổ, gửi OCR, đổi settings hoặc khởi động lại host; quan sát phản hồi lệnh, sự kiện/cửa sổ và các kết quả OCR có tương quan đúng.

Giữ các test hiện có ở những ranh giới OCR client/host/native đã được duyệt trong công việc trước. Mở rộng chỉ khi thay đổi mới cần chứng minh không nạp model theo tooltip/PDF, không trả kết quả cũ, không phá chụp/ghim/copy hoặc quay màn hình. Không thêm test chỉ để phản chiếu menu/CSS hay thứ tự gọi helper.

## Cách thực hiện sau khi được duyệt

- S1–S6 là tập ranh giới được phép viết test; không phải yêu cầu test mọi trường hợp hoặc viết cả sáu nhóm trước.
- Mỗi vòng chỉ một test hành vi thất bại rồi một phần triển khai đủ để qua test đó; chọn lát kế tiếp từ kết quả thực tế.
- Tái sử dụng kiểm tra hiện có; không viết lại toàn bộ test extension, không test từng thành phần giao diện ít rủi ro chỉ để tăng số lượng.
- Chỉ dùng dữ liệu tổng hợp/cục bộ cho kiểm tra tự động; không ghi vào tài khoản học tập thật. Người dùng tự nghiệm thu thực tế theo cách riêng.

## Comments

- 2026-11-11: Đã triển khai và kiểm tra tại các ranh giới được duyệt. Các seam là phạm vi quan sát được cho phép, không đồng nghĩa mọi trường hợp trên Windows/server thật đã được nghiệm thu. Kết quả và giới hạn cụ thể: [VALIDATION.md](./VALIDATION.md).
