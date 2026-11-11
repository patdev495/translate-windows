# Đọc Selected Text trên Windows

Status: done
Date: 2026-11-11

Khảo sát và hành vi đã thống nhất; tính năng đã triển khai theo [PRD.md](./PRD.md), [PLAN.md](./PLAN.md). Kết quả kiểm chứng tại [VALIDATION.md](./VALIDATION.md).

## Nhu cầu

Dịch văn bản người dùng bôi đen trong ứng dụng khác bằng cách đọc văn bản gốc, mở rộng ngoài luồng chụp vùng và OCR. Không thể cam kết mọi ứng dụng đều cho đọc vùng chọn.

## Kết quả tra cứu

- Windows UI Automation (UIA): lấy TextPattern của control phù hợp, gọi `IUIAutomationTextPattern::GetSelection()`, rồi `IUIAutomationTextRange::GetText()`. Có thể có nhiều range không liền nhau; caret không có vùng chọn trả range rỗng. Không được thay vùng chọn rỗng bằng toàn bộ document.
- UIA phụ thuộc provider của ứng dụng có cung cấp TextPattern và selection. Một vùng được tô màu trên màn hình chưa đủ chứng minh ứng dụng cung cấp Selected Text.
- Phương án dự phòng khi UIA không lấy được chữ: gửi lệnh Copy phù hợp với ứng dụng rồi đọc Unicode text mới trong clipboard. `SendInput` có thể phát phím; Clipboard API có thể đọc dữ liệu và theo dõi thay đổi. Đây là một quy trình phối hợp, không phải API đọc selection dùng được cho mọi app.
- Luồng Copy phải xử lý focus, modifier còn giữ sau hotkey, timeout và thay đổi clipboard. Không dịch nhầm nội dung clipboard cũ; không khôi phục clipboard cũ sau khi Copy.
- Ứng dụng chạy quyền cao hơn có thể bị giới hạn bởi UIA/UIPI; không mặc định chạy toàn bộ app với quyền administrator.
- Với nội dung không có text provider và không Copy được, cân nhắc tích hợp riêng theo ứng dụng hoặc giữ OCR làm đường dự phòng.

## Đối chiếu repo

- `src-tauri/src/lib.rs` có global shortcuts, chụp vùng và ghi ảnh vào clipboard; chưa thấy đường đọc Selected Text bằng UIA.
- `src/tooltip.ts` nhận payload có `text` và chỉ gọi OCR khi chưa có text mà có ảnh. Có điểm nối để tái sử dụng dịch/phonetics/tooltip sau khi đọc Selected Text.
- Backend là Rust/Tauri. Đề xuất thực hiện UIA và Copy/clipboard phía native, rồi chuyển text sang tooltip hiện có. Lời gọi UIA nên chạy trên worker COM MTA riêng theo hướng dẫn Microsoft.
- Repo hiện dùng shortcut kết hợp phím; chưa có bộ theo dõi Ctrl đơn lẻ. Windows có thể cung cấp sự kiện nhấn/nhả qua low-level keyboard hook; callback chỉ cập nhật trạng thái và chuyển công việc sang worker, không chạy UIA/dịch trong callback. Cần phân biệt phím thật với phím Copy do chính app phát để tránh tự kích hoạt lại. Raw Input cũng là lựa chọn cần cân nhắc khi triển khai.
- Không thay đổi quyết định về nơi chạy OCR trong ADR-0001/0002. Tính năng Selected Text Translation đã triển khai trong module native `selected_text`, nối vào tooltip nhận text có sẵn.

## Đã thống nhất

- Người dùng bôi đen Selected Text trong ứng dụng nguồn, rồi bấm hotkey để yêu cầu dịch.
- Không tự động dịch sau mỗi lần bôi đen. Người dùng chọn nhấn rồi nhả Ctrl để kích hoạt, không dùng tổ hợp nhiều phím.
- Hỗ trợ cả Ctrl trái và Ctrl phải. Chỉ Ctrl đơn lẻ mới kích hoạt; dùng Ctrl với phím khác hoặc click/cuộn chuột không kích hoạt dịch.
- Hotkey ưu tiên đọc Selected Text bằng UIA. Nếu lấy được text, dịch và hiện tooltip mà không thay đổi clipboard.
- Khi UIA không lấy được text, cùng hotkey tự gửi Copy, đọc text mới, dịch và hiện tooltip. Không yêu cầu người dùng bấm Copy riêng; để text vừa copy trong clipboard như thao tác Copy thông thường.
- Nếu cả UIA và Copy đều không lấy được chữ, hiện thông báo ngắn, ví dụ “Không lấy được văn bản”. Không tự mở chọn vùng OCR; người dùng chủ động dùng thao tác OCR riêng.
- Người dùng sẽ kiểm thử trên nhiều ứng dụng có thể, không giới hạn phạm vi khảo sát vào một danh sách app ưu tiên.

## Lý do ưu tiên UIA, dự phòng bằng Copy

UIA cho phép đọc chữ mà không thay đổi clipboard hay gửi phím Copy khi ứng dụng cung cấp vùng chọn. Copy dự phòng mở rộng khả năng lấy text gốc khi UIA không đọc được. Người dùng đã cân nhắc phương án Copy trực tiếp và chọn UIA trước, Copy sau.

## Luồng đã chốt

Bôi đen → hotkey → thử UIA → nếu không lấy được chữ thì Copy và đợi text mới trong clipboard → dịch → hiện tooltip. Giữ focus ở ứng dụng nguồn cho đến khi đã lấy text; không đọc ngay clipboard cũ sau khi gửi Copy.

Chỉ kích hoạt khi Ctrl được nhấn/nhả đơn lẻ; nếu có phím khác hoặc click/cuộn chuột trong lúc giữ Ctrl thì hủy lượt kích hoạt. Không kích hoạt sau Ctrl+C, Ctrl+V, Ctrl+3, Ctrl+click hoặc Ctrl+cuộn chuột. Mỗi lượt nhả Ctrl hợp lệ chỉ yêu cầu dịch một lần.

Hỗ trợ cả Ctrl trái và Ctrl phải với cùng quy tắc nhấn/nhả đơn lẻ.

## Nguồn chính thức

- [GetSelection](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextpattern-getselection)
- [GetText](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextrange-gettext)
- [Text và TextRange patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-about-text-and-textrange-patterns)
- [Clipboard API](https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard)
- [SendInput và UIPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
- [UIA security](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview)
- [UIA threading](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading)
- [Low-level keyboard events](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)
- [Keyboard event flags, gồm phím injected](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)
