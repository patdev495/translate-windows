# Tái sử dụng WebView tooltip với request generation

Status: ready-for-agent
Depends on: 03-centralize-translation-and-ipa
Date: 2026-11-12

## Công việc

- Window chỉ tạo lazy ở lượt đầu; lượt sau dùng hide/show. Destroy thật/crash tạo lại được ở yêu cầu sau.
- Tách readiness của WebView khỏi request hiện tại. Snapshot payload native + ready handshake không bỏ lỡ dữ liệu trước DOM ready.
- Main work có thể bắt đầu song song với ensure-window. Chỉ request hiện hành được render, đổi layout hoặc show.
- Reset TTS, Hanzi, Reading Focus, selection/gloss/save panel, notice, timer/observer và async callback của lượt cũ.
- Abort OCR theo AbortController/job ID vì hide không phát beforeunload. Chỉ cancel tác vụ của lượt đó, không xóa OCR model hay Learning Save đã được host nhận.
- Mỗi lượt mở mới cập nhật monitor/center/width; kéo trong cùng lượt không bị observer trả về giữa. Giữ pixel alignment và không viền/lề ngoài.
- Chọn monitor theo tọa độ nguồn của lượt, không theo vị trí cũ của hidden tooltip; warm show không giành focus nguồn.
- Giữ cách tạo window async để tránh deadlock WebView2; không giữ state lock khi tạo/show/emit.

## Vòng TDD đầu

Mở, dismiss rồi mở nội dung khác qua public command/UI: cùng một WebView, nội dung đúng lượt mới. Sau đó test A chậm/B nhanh, dismiss trước ready/result, timer A sau khi B mở và destroy/recovery.

## Nghiệm thu

50 lần show/hide tạo một tooltip WebView; không kết quả cũ mở lại window, không listener/job tăng theo vòng. Geometry/Hanzi/TTS/Copy và fallback đúng.

## Comments

- 2026-11-12: Mới lập kế hoạch; đây là phần có rủi ro lifecycle cao nhất.
