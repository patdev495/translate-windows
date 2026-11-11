# Kiểm chứng chuyển chức năng extension sang desktop

Date: 2026-11-11
Status: done

Tài liệu và SHA-256 bộ cài bên dưới ghi nhận lần bàn giao ban đầu lúc 14:45. Đợt sửa kéo tooltip, phím đơn và cập nhật liên kết website nằm tại [issues/01-tooltip-shortcut-link.md](./issues/01-tooltip-shortcut-link.md). Bản sửa kích thước/vị trí/khung cửa sổ và bộ cài mới đã hoàn tất lúc 16:49, xem [issues/02-tooltip-geometry.md](./issues/02-tooltip-geometry.md). Kiểm tra mới nhất: 111 frontend test, 5/5 trang WebView2, release/NSIS đạt. Metadata lần bàn giao đầu được giữ riêng, metadata mới nhất ở [build-artifacts.json](./build-artifacts.json).

Phạm vi và các quyết định nằm trong [PRD.md](./PRD.md). Người dùng đã duyệt S1–S6 và yêu cầu tự nghiệm thu thực tế theo cách riêng. Các kết quả dưới đây dùng dữ liệu tổng hợp; không ghi nội dung lên tài khoản học thật.

## Kết quả tự động

| Kiểm tra | Kết quả | Bằng chứng và phạm vi |
| --- | --- | --- |
| `npm test` | 27 file, 105 test đạt | Chạy lại sau khi đồng bộ JavaScript API Tauri về 2.11 và bổ sung kiểm tra hàng đợi offline; gồm Settings, tooltip, backup, PDF parser thật, OCR lifecycle và các kiểm tra quay màn hình hiện có. |
| `cargo test --manifest-path src-tauri/Cargo.toml -j 1` | 41 đạt, 3 ignored | Lệnh/RPC native, lưu dữ liệu, nâng cấp settings, phím cấu hình, đọc vùng chọn, nguồn thay thế hết hiệu lực và OCR. Ba test Windows có tương tác desktop/clipboard thật giữ ignored. |
| `cargo check --manifest-path src-tauri/Cargo.toml --tests --examples -j 1` | Đạt | Bao gồm harness WebView2 và các example hiện có. |
| `npm run test:ui` | 5/5 trang đạt | Chạy HTML/JavaScript production thật trong WebView2 với profile riêng. Kết quả máy đọc được ở [ui-smoke-results.json](./ui-smoke-results.json). |
| `npm run build` | Đạt | TypeScript và Vite production; tài nguyên offline được chuẩn bị từ dependency và `third_party/` của chính repo. |
| Release native | Đạt | `release` optimized build hoàn tất sau 26 phút 17 giây; executable mới 267.574.784 byte. |
| `npm run tauri build -- --bundles nsis --ci` | Đạt, exit 0 | Bộ cài NSIS mới 256.474.174 byte, timestamp 2026-11-11 14:45:00 +07:00. |
| `git diff --check` | Đạt | Có thông báo chuyển LF/CRLF của Git trên Windows, không có lỗi whitespace. |
| Dev server | Sẵn sàng khoảng 1,2 giây; Settings HTTP 200 | Giới hạn dependency scan và bỏ theo dõi thư mục dữ liệu sinh tự động để tránh quét hàng chục nghìn file tài nguyên. |

WebView2 ở lần bàn giao ban đầu kiểm tra: main host sẵn sàng; Settings có năm tab và lưu phím `Alt+KeyR`; PDF tổng hợp render một trang và TextLayer đọc được `Hello PDF`; tooltip sao chép `你好` qua native boundary và dựng 42 SVG stroke paths; bảng phân tích có hai thành phần, lưu/đọc lại ghi chú thành công. Report hiện tại được cập nhật bởi đợt sửa sau: phím `Ctrl` và `accountLinked: true`, xem issue sửa lỗi ở đầu tài liệu.

Harness dùng native file picker/clipboard giả lập và kho riêng tại `.scratch/tmp/extension-ui-smoke-*`. PDF.js, Hanzi Writer, dữ liệu nét/thành phần và các module ứng dụng vẫn chạy thật. Không cài bộ hook toàn cục vào desktop trong smoke test này.

## Phạm vi đã triển khai

- S1: Settings năm tab theo extension; lưu native; công tắc Desktop; hai phím dịch riêng có ghi nhận tổ hợp, tắt phím, phát hiện xung đột và rollback khi áp dụng lỗi. Công tắc tự dịch vùng chọn tách khỏi dịch sau chụp màn hình.
- S2: Hook Windows theo cấu hình; tự dịch chỉ UIA, không Copy; phím dịch chủ động UIA rồi Copy; thay đúng vùng chọn editable, chặn mật khẩu/nguồn cũ và fallback tooltip/Copy.
- S3: Tooltip, Pinyin/IPA, phát âm, từ điển, nét, vòng lặp, thành phần, cửa sổ Hanzi riêng, nghĩa cá nhân/ghi chú và backup JSON theo extension.
- S4: Luồng liên kết website và hàng đợi từ extension chạy ở main host thường trú; token/kho hàng đợi IndexedDB; dữ liệu theo account; HTTP qua native transport; Settings cập nhật trạng thái không tự tạo vòng lặp truy vấn.
- S5: PDF local, password callback, trang/zoom, TextLayer, chọn chữ/OCR, chung tooltip và OCR host; assets PDF.js offline.
- S6: Settings/PDF mở từ tray thành cửa sổ riêng, main ẩn; giữ chụp/ghim/copy/quay màn hình; PDF không tự nạp model riêng. Master off giải phóng OCR; OCR PDF được yêu cầu rõ ràng vẫn chạy khi chỉ tắt dịch sau chụp.

## Tài nguyên và đóng gói

- Tauri JavaScript API: 2.11.x; Rust Tauri: 2.11.5, giới hạn cùng minor để tránh lỗi CLI kiểm tra phiên bản.
- 15 file OCR model, tổng 279.042.214 byte; đối chiếu SHA-256 từng file với extension, không có file khác biệt.
- 9.574 file nét chữ Hán và giấy phép ARPHIC trong `hanzi-data/`; dictionary, nguồn/giấy phép Make Me a Hanzi và giấy phép Hanzi Writer được đóng gói.
- PDF worker, CMaps, standard fonts, WASM và CMU dictionary nằm trong frontend assets. Không cần repo extension ở máy sử dụng hoặc máy build.
- Bộ cài NSIS lần bàn giao đầu đã xác minh file mới; metadata lịch sử ở [build-artifacts-initial.json](./build-artifacts-initial.json). Server/driver tạm được dọn sau mỗi lượt test:ui; metadata của lần build mới hơn nằm tại [build-artifacts.json](./build-artifacts.json).

| Artifact | Byte | SHA-256 |
| --- | --- | --- |
| `src-tauri/target/release/bundle/nsis/PolyTranslate_1.0.0_x64-setup.exe` | 256.474.174 | `2BB07F8BE2EED9E2DA313D77F4D4253EB7AE2DD44D5B5E8AE50C80C11D240C33` |
| `src-tauri/target/release/translation-desktop.exe` | 267.574.784 | `6FB1691B31C405F2FDA9A18D0A9E51F060C1E3D1DD5500F9A46E55417946A1FB` |

## Giới hạn bằng chứng

Không chạy thử liên kết/đồng bộ với tài khoản Learning thật hoặc gọi các nhà cung cấp để tạo nội dung thử. Kiểm tra hợp đồng bổ sung `learning-offline.test.ts` dùng storage/sync/account thật với mạng và trình mở URL giả tại ranh giới ngoài: liên kết A, lưu offline, khởi động lại host, đổi sang B không thấy hoặc gửi hàng đợi A, lưu cặp từ/câu của B, liên kết lại A và đồng bộ đúng token A. Test đạt; chưa chứng minh trọn luồng với server thật hoặc giao diện phê duyệt website thật.

Không khẳng định khả năng lấy/thay chữ trên mọi ứng dụng Windows. UIA và khả năng chỉnh sửa phụ thuộc ứng dụng nguồn. Các test tự động bảo vệ dữ liệu/nguồn cũ; ba smoke test cần desktop thật được giữ ignored để không thay clipboard hoặc vùng chọn đang làm việc của người dùng. Người dùng tự nghiệm thu theo thỏa thuận.

Vite có cảnh báo chunk PDF/OCR lớn; test PDF dưới Node có cảnh báo standardFontDataUrl (trình đọc WebView2 cung cấp tài nguyên font thật). WebView2 đôi khi in lỗi unregister Chrome_WidgetWin_0 khi đóng harness; các assertion đều đạt và tiến trình trả 0.

Không commit, không reset những thay đổi OCR/Selected Text có sẵn trong working tree.
