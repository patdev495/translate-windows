# Đo baseline đường dịch và cache

Status: done
Depends on: none
Date: 2026-11-12

## Mục tiêu

Tạo phép đo lặp lại được trước khi tối ưu, theo bước 0 của [PLAN.md](../PLAN.md). Mốc source `1c7df1f`; probe cache đã có không thay cho số đo end-to-end.

## Công việc

- Trace ID và duration tại acquisition, host dispatch, từng provider, IPA, WebView init và correct-paint.
- Harness đi qua production commands/UI, profile riêng, văn bản tổng hợp; nếu bỏ acquisition thì đặt đúng tên số đo sau text-ready.
- Server kiểm soát cho baseline overhead; mẫu nhỏ provider thật cho đối chiếu. Giữ cùng config/build/máy, OCR state và số target.
- Đo cold, warm nội dung mới/lặp; p50/p95, lỗi/cancel, memory và resource counts. Log không có text/ảnh/credential/account.
- Ghi mục tiêu latency định lượng sau khi có baseline; giữ instrumentation tương đương trước/sau.

## Nghiệm thu

Có command harness chạy lại được, JSON từng mẫu và baseline có network/IPA/window-init riêng. Benchmark không thay production window creation bằng helper giả. Không đưa một phép đo giả response vài ms thành tốc độ dịch thật.

## Comments

- 2026-11-12: Mới lập kế hoạch; chưa thu baseline native end-to-end.

- 2026-11-12: Hoàn thành harness production command/profile riêng, trace, 5 cold/100 warm và các nhóm nguồn Trung/OCR/Google thật. DeepL thật 6/6 lỗi, giữ nguyên mẫu lỗi; không có p50 hợp lệ. Xem [MEASUREMENT.md](../MEASUREMENT.md), các `baseline*.json`. Metric sau text-ready, chưa bao gồm acquisition. Mục tiêu định lượng đã chốt trước tối ưu.
