# Giảm độ trễ dịch trên desktop

Status: done
Date: 2026-11-12
Baseline commit: `1c7df1fdffbb662d7d8c0b909bb54759096534f7`

## Mục tiêu

Giảm chi phí do HTTP client mới, cache IPA mất theo cửa sổ và việc tạo lại Native Tooltip Window. Giữ hành vi dịch/học của bản đã bàn giao. Người dùng yêu cầu lập kế hoạch chi tiết; đây là đặc tả triển khai, chưa phải ghi nhận đã sửa hoặc đã đo tốc độ end-to-end.

## Bằng chứng hiện có

- `src-tauri/src/desktop.rs::desktop_http` tạo `reqwest::Client` trong mỗi request. `translate_deepl` và `verify_deepl_api_key` trong `lib.rs` cũng tạo client riêng mỗi lần.
- `open_tooltip_window_inner` hủy cửa sổ cũ rồi tạo WebView mới; `close_tooltip_window` hiện dùng destroy.
- `src/tooltip.ts` gọi TranslationCoordinator trong WebView tooltip. Cache `cmuDictCache` thuộc module của WebView đó.
- CMU dictionary hiện có 3.901.632 byte. Cache file/HTTP không giữ lại object JSON đã parse khi JS context bị hủy.
- Probe dùng coordinator thật với HTTP boundary giả: hai lượt dịch trong cùng host nạp IPA một lần; hai context tooltip mới nạp hai lần. Cả hai engine vẫn đi vào provider hai lần; probe không chứng minh thời gian mạng hoặc phần trăm tăng tốc.
- Main host/RPC và OCR host đã có, có thể tái sử dụng. Input Replacement Translation đã chạy ở main; luồng tooltip thường và PDF còn có chỗ gọi coordinator cục bộ.

## Phạm vi sản phẩm

1. Dùng HTTP client lâu dài theo chính sách transport, giữ timeout/redirect/endpoint/header hiện có.
2. Main host sở hữu dịch và cache IPA dùng chung giữa Selected Text Translation, PDF và các yêu cầu OCR cần dịch.
3. Mỗi lần tải main host chỉ fetch/parse IPA thành công một lần; các lượt gọi đồng thời dùng chung lần tải đang chờ. Tải lỗi cho phép thử lại.
4. Tạo tooltip theo nhu cầu ở lượt đầu, sau đó ẩn/hiện và cập nhật nội dung trong cùng WebView. Crash/destroy thật mới tạo lại.
5. Đo phần thời gian do ứng dụng và thời gian chờ provider riêng, cho cả lượt đầu và các lượt tiếp theo.

Cache kết quả dịch có TTL/LRU là hạng mục riêng, chưa nằm trong ba chi phí đang xử lý. Đợt này vẫn giữ cùng số request provider cho cùng đầu vào/cấu hình, trừ tác vụ bị hủy trước khi gửi. Không giảm số ngôn ngữ đích, bỏ phonetics hoặc giảm chất lượng để tạo số đo nhanh hơn.

## Hành vi phải giữ

- Phím đơn/tổ hợp, Automatic Selected Text Translation, UIA/Copy và bảo vệ clipboard/nguồn hết hiệu lực.
- Input Replacement Translation chỉ sửa đúng vùng chọn; fallback đã có `translationData` không dịch lại.
- Tooltip rộng theo nội dung, phần đọc tối thiểu 350 logical px; căn giữa work area, đúng DPI, không lề trắng/viền native; kéo cả cửa sổ.
- Mỗi lượt mở mới tính layout/monitor và đặt giữa lại; trong cùng lượt, cập nhật nội dung không kéo cửa sổ khỏi vị trí người dùng đã chọn.
- Hanzi, TTS, Reading Focus, Copy, từ điển, lưu thư viện và ghi chú. Lượt mới không giữ panel/selection/animation của lượt cũ.
- Close/Escape/click ngoài/master off phải ẩn ngay, không bị kết quả cũ mở lại. App quit và crash vẫn hủy tài nguyên thật.
- PDF/OCR tiếp tục dùng main OCR host theo ADR-0002. Đóng tooltip không unload model hoặc hủy công việc của PDF khác.
- Learning Save đã được main nhận tiếp tục hoàn tất hoặc nằm trong Pending Sync Item sau khi tooltip bị ẩn.
- Giữ settings/data hiện có, khay hệ thống, chụp/ghim/copy và quay màn hình.

## Tiêu chí hoàn thành

- Test HTTP native thật với server keep-alive riêng quan sát được reuse kết nối sau khi đọc xong response; endpoint/timeout/auth policy vẫn đúng.
- Một lần load/parse IPA thành công trên mỗi main-host generation, kể cả nhiều client yêu cầu đồng thời hoặc đóng/mở tooltip.
- Tối đa một tooltip WebView trong 50 chu kỳ show/hide bình thường; có thể hồi phục sau destroy/crash.
- Không render hoặc áp dụng layout từ request cũ; không bật lại tooltip đã dismiss; số listener/pending job/window không tăng theo số chu kỳ.
- Có baseline và báo cáo sau sửa, cùng máy/build mode/provider/targets; báo p50/p95 và phần thời gian mạng riêng. Mức giảm cụ thể được chốt sau baseline, không hứa tăng tốc bằng một hệ số chưa đo.
- Frontend, Rust và WebView2 phù hợp đạt; NSIS release mới và SHA-256 được xác minh khi triển khai được yêu cầu.

## Quan hệ với ADR và kiểm thử

Giữ ADR-0002 về main OCR host và ADR-0004 về desktop độc lập. Kế hoạch mở rộng vai trò main host sang dịch, không chuyển OCR sang tooltip. Khi triển khai, ghi ADR mới về vòng đời translation host/tooltip và cập nhật CONTEXT.md theo hành vi đã hoàn thành.

Tái sử dụng các ranh giới S1–S6 đã được duyệt tại `../extension-parity/TDD-SEAMS.md`. Test hành vi qua HTTP/IPC/UI công khai; chỉ thay OS, mạng, đồng hồ và file. Mỗi vòng một test thất bại rồi triển khai đủ để qua.

## Comments

- 2026-11-12: Người dùng yêu cầu kế hoạch chi tiết sau khi xác nhận cả ba chi phí đều có thể cải thiện. Chỉ tạo tài liệu kế hoạch trong lượt này.

- 2026-11-12: Issues 01–03 đã triển khai và kiểm chứng tại [VALIDATION.md](./VALIDATION.md). Phạm vi reuse tooltip và các bước 04–06 vẫn theo kế hoạch.

- 2026-11-12: Reuse tooltip và ma trận lifecycle đã triển khai, đạt gate 751 vòng/1 WebView/1 dictionary/4 listeners; nguồn và kết quả đo nằm trong VALIDATION.md. Bản NSIS tối ưu đang được build/xác minh tại issue 06.

- 2026-11-12: Đã hoàn thành issues 04–06. Source package 748fc0b; NSIS cuối và SHA-256 xác minh tại build-artifacts.json/SHA256SUMS.txt. Bằng chứng trước/sau, 751-cycle plateau, tests và giới hạn: VALIDATION.md. Các ghi chú “đang build/chưa có NSIS” phía trên là lịch sử tiến độ đã được thay thế bởi kết quả này.
