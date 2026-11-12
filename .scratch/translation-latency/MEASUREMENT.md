# Phép đo translation latency

`npm run bench:translation` build frontend production, chạy native debug với feature
`latency-harness`, 5 process/profile mới, mỗi process có 1 mẫu cold và 20 mẫu warm.
Native tooltip được tạo bởi command `open_tooltip_window` production. Không dùng
helper tạo window thay thế. Mạng kiểm soát dùng HTTP loopback với delay 40 ms,
hai target vi/zh và source English có IPA. Không cache kết quả dịch.

PowerShell, dùng cùng assets đã build để thu đối chiếu provider thật:

```powershell
$env:LATENCY_SKIP_BUILD='1'
$env:LATENCY_REAL='1'
$env:LATENCY_RUNS='1'
$env:LATENCY_REPORT='.scratch/translation-latency/baseline-real.json'
npm run bench:translation
```

Gỡ `LATENCY_REAL` trước khi đo controlled lần sau. `LATENCY_REPORT` chọn tên file
sau mỗi bước; mặc định là `baseline.json`. Không dùng skip-build sau thay đổi TS.

Mỗi mẫu có ID, cold/warm, new/repeated, duration provider/IPA/fetch/parse và các
mốc native text-ready → view-ready/result-ready/correct-paint. Các duration JS
dùng monotonic clock tại cùng WebView; elapsed dùng Instant ở native khi nhận
event. Không trừ timestamp JS với Rust. Correct-paint được báo sau fit native
và hai animation frame. Đây là proxy paint sau layout, chưa kiểm chứng pixel
bằng screenshot. Resource report gồm window count và process-tree memory.

Giới hạn: chưa đo acquisition hook/UIA/Copy; không gọi số đo này là gesture
end-to-end. Bộ chính tắt OCR. Nhóm `LATENCY_OCR=1` chạy preload/recognition
Latin thật đồng thời với dịch và báo `ocrResult`; chỉ dùng nhóm đó để so cạnh tranh
CPU giữa OCR và dịch. Server kiểm soát chỉ đo overhead ứng dụng, không
đại diện latency DeepL thật. Diagnostic feature không được bật trong release;
bootstrap endpoint không mở allowlist cho người dùng hoặc command payload.
Log không có source text, ảnh, credential hoặc account.

## Mục tiêu chốt sau baseline, trước tối ưu

Baseline controlled 5 cold + 100 warm: warm p50 **1502,14 ms**, p95 **1972,89 ms**.
Sau chuyển host: warm p50 <= **1351,93 ms** (giảm 10%), p95 <= **2170,17 ms**
(không tăng quá 10%). HTTP pooling trước hết phải đạt reuse TCP thật; so số đo
riêng để không gán cải thiện IPA cho client pooling. Số request provider giữ nguyên.
Baseline chính ở `baseline.json`; nhóm nguồn Trung/OCR/provider thật báo riêng.

Nhóm bổ sung (mỗi nhóm đặt `LATENCY_RUNS=1`, `LATENCY_REPORT` riêng):
`LATENCY_SOURCE=zh` để buộc IPA ở target; `LATENCY_OCR=1` để chạy OCR Latin thật
đồng thời; `LATENCY_REAL=1` dùng 6 mẫu provider thật (12 request); thêm
`LATENCY_PROVIDER=google` cho đối chiếu Google. Gỡ từng biến sau khi đo.
