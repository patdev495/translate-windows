# Main host sở hữu dịch và cache IPA

Status: ready-for-agent
Depends on: 01-measure-baseline; thực hiện sau 02 để đo riêng tác động
Date: 2026-11-12

## Công việc

- Dùng host/RPC hiện có cho tooltip và PDF; các luồng OCR sau nhận dạng, selection gloss, meaning suggestion và Input Replacement dùng cùng dịch vụ phù hợp.
- Một dictionary cache + một load promise trong main host. Load đồng thời gộp lại; lỗi không khóa cache, lần sau thử lại.
- Giữ target selection, Promise.all, nội dung/IPA và fallback `translationData` không dịch lặp.
- Host generation/revision chặn kết quả của cấu hình cũ. Reload host fail request cũ rõ ràng, lượt sau hoạt động.
- Giữ OCR owner/queue; đo trường hợp main đang preload/nhận dạng để tránh chuyển chậm trễ sang host.

## Vòng TDD đầu

Hai tooltip client mới và một PDF client cùng yêu cầu dịch có IPA qua host thật, chỉ một lần load dictionary. Sau đó load đồng thời, load lỗi/thử lại, settings/master đổi, host restart. Chỉ thay mạng/IPC/OS ở boundary, không mock cache/coordinator nội bộ.

## Nghiệm thu

Một lần fetch/parse thành công mỗi host generation; đóng/mở view và đổi display không nạp lại. Kết quả giống baseline và có số đo riêng sau chuyển host.

## Comments

- 2026-11-12: Mới lập kế hoạch.
