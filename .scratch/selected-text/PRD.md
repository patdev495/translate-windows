# Dịch Selected Text bằng Ctrl đơn lẻ

Status: done
Date: 2026-11-11

Hành vi đã được thống nhất trong phiên grill-with-docs và đã triển khai theo các ranh giới TDD được người dùng xác nhận. Xem [PLAN.md](./PLAN.md) và [VALIDATION.md](./VALIDATION.md).

## Mục tiêu

Người dùng bôi đen chữ trong ứng dụng Windows, nhấn rồi nhả Ctrl để dịch và xem kết quả trong Native Tooltip Window. Ưu tiên lấy văn bản gốc thay vì chụp ảnh và OCR.

## Hành vi

1. Hỗ trợ Ctrl trái và Ctrl phải; kích hoạt sau khi nhả Ctrl đơn lẻ.
2. Ctrl kết hợp với phím khác hoặc click/cuộn chuột không kích hoạt dịch. Các thao tác Ctrl+C, Ctrl+V và Ctrl+3 tiếp tục hoạt động bình thường.
3. Thử lấy Selected Text bằng UI Automation trước. Thành công thì dùng text đó và giữ nguyên clipboard.
4. Nếu UIA không lấy được chữ, tự gửi Copy trong ứng dụng nguồn và đợi text mới trong clipboard. Người dùng không cần bấm Copy riêng.
5. Dịch text vừa lấy được và hiện tooltip, tái sử dụng dịch, phonetics và các tùy chọn hiển thị hiện có. Khi dùng Copy, giữ text vừa copy trong clipboard.
6. Nếu cả UIA và Copy đều không lấy được chữ, báo ngắn “Không lấy được văn bản”. Không tự mở chọn vùng OCR.

## Ràng buộc khi triển khai

- Giữ focus ở ứng dụng nguồn trong lúc lấy chữ; chỉ mở tooltip sau khi đã lấy text hoặc cần báo thất bại. Nếu ứng dụng nguồn thay đổi giữa chừng, hủy lượt lấy chữ để tránh Copy nhầm nơi.
- UIA chỉ lấy vùng chọn, không thay vùng chọn rỗng bằng toàn bộ tài liệu. Xử lý nhiều vùng chọn nếu provider cung cấp.
- Chờ Copy với thời hạn hữu hạn và xác nhận clipboard được cập nhật; không dùng lại nội dung cũ chỉ vì nó có text. Copy lại cùng một chuỗi vẫn có thể là kết quả mới hợp lệ.
- Mỗi lượt Ctrl đơn lẻ kích hoạt một lần; không lặp do key repeat hay do phím Copy chính app phát ra.
- Không chạy UIA, chờ clipboard hoặc gọi dịch trong callback bàn phím. Tách xử lý native và điều phối request khỏi UI thread.
- Hành vi Copy phụ thuộc ứng dụng nguồn. Không cam kết tương thích mọi ứng dụng, không mặc định yêu cầu chạy toàn bộ app bằng quyền administrator.
- Giữ luồng chụp vùng OCR riêng, tuân theo ADR-0001/0002.

## Kiểm chứng

- Ctrl trái/phải đơn lẻ đều yêu cầu dịch đúng một lần; Ctrl+C/V/3, Ctrl+click và Ctrl+cuộn không kích hoạt dịch.
- UIA thành công trả chữ đang chọn và không đổi clipboard; UIA rỗng/lỗi chuyển sang Copy.
- Copy lấy chữ mới, hỗ trợ copy lặp cùng text, giữ text trong clipboard và không tự kích hoạt lại dịch.
- Copy không cập nhật clipboard, trả dữ liệu không có text hoặc nguồn mất focus thì không dịch nhầm dữ liệu cũ.
- Kết quả hiện trong tooltip; thất bại chỉ báo ngắn và không mở OCR.
- Kiểm thử thực tế trên nhiều ứng dụng có thể theo mong muốn người dùng; ghi lại app, phiên bản, đường lấy chữ và lỗi để xác định giới hạn tương thích.

## Tham chiếu

- [Khảo sát API và nguồn chính thức](./RESEARCH.md)
- Thuật ngữ: `Selected Text`, `Selected Text Translation`, `Native Tooltip Window` trong `CONTEXT.md`.
