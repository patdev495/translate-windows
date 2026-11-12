# Đo lại, ghi bằng chứng và đóng gói bản tối ưu

Status: ready-for-agent
Depends on: 05-lifecycle-and-regressions
Date: 2026-11-12

## Công việc

- So baseline và từng bước: cold/warm p50/p95, provider duration, IPA load, TCP connection, window/listener/job count và memory.
- Đối chiếu mục tiêu số đã chốt sau baseline; điều tra trace nếu local warm path không giảm hoặc cold/p95 xấu đi ngoài nhiễu đo.
- Chạy frontend/Rust/WebView2 phù hợp; chạy serial các lượt đo để không tranh tài nguyên.
- Cập nhật CONTEXT, ADR cho host/tooltip lifecycle, README và VALIDATION; giữ harness tái lập, bỏ log tạm có thể ảnh hưởng kết quả.
- Theo yêu cầu triển khai, chốt source commit rồi build NSIS với jobs=1; xác minh artifact mới và SHA-256. Ghi source/config/timestamp, giữ metadata bản trước để rollback không mất settings/library.
- Push theo phạm vi được giao lúc triển khai; không push chỉ vì đang lập kế hoạch.

## Nghiệm thu

Có báo cáo trước/sau có thể kiểm tra được, tất cả gate hành vi/cấu trúc đạt, installer ứng với source đã ghi và giới hạn đo được nêu rõ. Không tuyên bố tăng x lần dựa trên probe mạng giả.

## Comments

- 2026-11-12: Mới lập kế hoạch.
