# Kiểm tra các trường hợp chồng request và hồi quy

Status: done
Depends on: 02, 03, 04; test từng phần viết ngay trong từng bước
Date: 2026-11-12

## Công việc

Hoàn tất ma trận bước 4 của [PLAN.md](../PLAN.md), qua S1–S6 đã duyệt:

- A/B đến sai thứ tự, dismiss/ready/result/timer muộn, host reload, tooltip crash.
- Đổi provider/key/target/master/display trong lúc chờ.
- Phím đơn/tổ hợp, Ctrl+C, auto selection không đổi clipboard và nguồn replacement đã đổi.
- PDF/OCR đồng thời, hide giữa OCR, Hanzi/TTS/save khi đóng hoặc đổi lượt.
- 50 chu kỳ, theo dõi resource hữu hạn và memory plateau; DPI/đa màn hình, width/center/drag/scroll/frame.

## Nghiệm thu

Không stale result/layout/show; không làm rơi durable save; không phá view khác hoặc các tính năng capture/recording. Giữ các test tương tác desktop thật ở nhóm riêng, ghi rõ kết quả đã chạy/chưa chạy. Không thay test hành vi bằng kiểm tra private state hoặc snapshot CSS.

## Comments

- 2026-11-12: Mới lập kế hoạch. Bước này tổng hợp test ghép, không phải dồn toàn bộ test tới cuối.

- 2026-11-12: Ma trận S1–S6 đã chạy: frontend 134 tests, Rust 42 tests, Windows interactive 3/3 riêng, WebView2 UI smoke. Native race/layout/show/dismiss, crash/reload, 751 vòng với 4 listeners và 0 pending RPC/OCR; RAM plateau vòng 200–751. Giới hạn hardware đa DPI và OCR tail ghi rõ trong ../VALIDATION.md; không suy nghiệm thu phần chưa chạy.
