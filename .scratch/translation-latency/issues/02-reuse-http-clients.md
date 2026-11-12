# Tái sử dụng HTTP client theo transport policy

Status: ready-for-agent
Depends on: 01-measure-baseline
Date: 2026-11-12

## Công việc

- App-managed state khởi tạo lazy client dùng chung cho `desktop_http`, DeepL translate và verify theo các policy phù hợp.
- Giữ redirect/timeout/URL/method/response size policy. Không giữ mutex qua network await hoặc tuần tự hóa target requests.
- Credential và header gắn riêng từng request; đổi account/API key không dùng nhầm header. Lỗi init cho phép thử lại.
- Chạy test tại public HTTP command với server loopback keep-alive được cấu hình qua bootstrap harness; không nới allowlist bản phát hành.

## Vòng TDD đầu

Hai request tuần tự đọc hết body nhưng server nhìn thấy một kết nối TCP. Quan sát fail trước, sửa rồi thêm từng case credential/timeout/endpoint/HTTP error theo S2/S3/S4 đã duyệt.

## Nghiệm thu

Server quan sát reuse thật, payload/auth/error contract giữ nguyên. Có báo cáo đo lại riêng bước này; không thêm cache bản dịch.

## Comments

- 2026-11-12: Mới lập kế hoạch.
