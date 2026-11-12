# PolyTranslate Desktop

Ứng dụng Windows chạy ở khay hệ thống, dịch chữ đang chọn hoặc vùng màn hình, đọc PDF và hỗ trợ học tiếng Trung. Giao diện Settings, tooltip, viết nét và phân tích chữ Hán lấy từ Translation Extension; không cần cài extension để dùng desktop.

## Phím tắt

| Thao tác | Mặc định |
| --- | --- |
| Dịch chữ đang chọn, hiện tooltip | Alt+Q |
| Dịch và thay phần chữ đang chọn trong ô nhập | Alt+W |
| Chọn vùng màn hình OCR | Ctrl+3 |
| Quay màn hình | Ctrl+4, giữ nguyên hành vi hiện có |
| Sao chép ảnh toàn màn hình | Alt+B |

Đổi hai phím dịch bằng cách bấm vào ô phím tắt trong **Provider**, rồi nhấn phím đơn hoặc tổ hợp muốn dùng. Với Ctrl/Alt/Shift/Meta đơn, nhấn rồi thả để lưu; vẫn dùng được tổ hợp như Ctrl+R. Backspace/Delete tắt phím đó. Không dùng trùng phím dịch, OCR, quay màn hình hoặc chụp ảnh; đăng ký lỗi sẽ báo và giữ cấu hình trước.

**Auto Translate** trong Provider điều khiển tự dịch sau khi bôi đen. Luồng này chỉ đọc chữ trực tiếp, không tự Copy hoặc đổi clipboard; không đọc được thì bỏ qua. Nhấn phím dịch chủ động có thể thử Copy nếu cần. **Translate after screen crop** trong OCR là tùy chọn riêng để giữ chế độ chỉ chụp/ghim/copy ảnh. Công tắc Desktop ở đầu Settings tắt dịch, giữ các tùy chọn đã lưu.

Dịch thay thế chỉ áp dụng cho vùng chọn trong ô nhập hỗ trợ thao tác này. Nếu không thể áp dụng, app hiện bản dịch với nút Copy để tự dán. Lấy/thay chữ phụ thuộc khả năng của ứng dụng Windows nguồn; không dùng ô mật khẩu và không ghi đè vùng chọn đã đổi.

Tooltip xuất hiện giữa vùng làm việc của màn hình, rộng theo nội dung như extension (phần đọc tối thiểu 350px, OCR lấy chiều rộng vùng chọn làm mức tối thiểu). Cửa sổ ôm sát card, không thêm lề trắng/viền Windows; khi kéo thì kéo cả cửa sổ. Nội dung dài cuộn bên trong và giữ giới hạn màn hình theo DPI.

## PDF và học chữ Hán

Mở **Read PDF…** từ menu khay hệ thống. Trình đọc có mở file, mật khẩu, chuyển trang, zoom, chọn chữ và chọn vùng OCR. PDF dùng chung OCR host của desktop; yêu cầu OCR rõ ràng trong PDF vẫn dùng được khi tắt tự dịch sau chụp màn hình.

Tooltip có Pinyin/IPA, phát âm, từ điển, sao chép và lưu từ/câu. Chọn chữ Trung để hiện nút viết nét; bật **Hanzi Breakdown** trong Display để mở bảng phân tích riêng. Nghĩa cá nhân và ghi chú được lưu cục bộ; **Export JSON / Import JSON** tương thích backup từ extension, có lựa chọn xử lý dữ liệu trùng.

Trong tab **Website**, liên kết cùng Learning Account để lưu từ/câu vào thư viện hiện có, xem hàng đợi đồng bộ và thử lại. Sau khi xác nhận trên website, quay lại Settings để app nhận kết quả ngay. Quản lý thư mục, ôn tập và luyện nghe nói tiếp tục trên website. Nội dung đang chờ đồng bộ thuộc tài khoản đã nhận nó, không chuyển sang tài khoản khác khi đổi liên kết.

## Phát triển và build

Cần Node.js/npm, Rust, công cụ build Windows cho Tauri v2 và WebView2.

```powershell
npm ci
npm run tauri dev
```

`npm run dev` và `npm run build` tự chuẩn bị tài nguyên offline từ dependency đã khóa phiên bản và `third_party/`; không phụ thuộc repo extension bên cạnh. OCR models hiện có nằm trong `public/models`. Dịch qua nhà cung cấp và đồng bộ thư viện cần mạng; đọc PDF, OCR và dữ liệu chữ Hán chạy cục bộ.

Build bộ cài Windows:

```powershell
$env:CARGO_BUILD_JOBS='1'
npm run tauri build -- --bundles nsis --ci
```

Kết quả ở `src-tauri/target/release/bundle/nsis/`. Giấy phép và nguồn dữ liệu chữ Hán/PDF được đóng gói cùng tài nguyên ứng dụng.

Nếu dùng learning server khác, đặt `LEARNING_API_BASE` và `LEARNING_WEB_BASE` trước khi chạy dev/build; mặc định dùng cấu hình website hiện có của extension.

## Kiểm tra

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml -j 1
npm run test:ui
```

`test:ui` build frontend rồi chạy các trang thật trong WebView2 với profile riêng tại `.scratch/tmp/extension-ui-smoke-*`. Kiểm tra Settings, PDF render/chọn chữ, nét và thành phần Hanzi, ghi chú và thao tác Copy qua ranh giới native giả lập; không dùng tài khoản hay clipboard thật. Kết quả ở `.scratch/extension-parity/ui-smoke-results.json`. Cổng 1438 phải đang trống. Ba test nguồn Windows cần tương tác desktop vẫn được đánh dấu ignored trong bộ Rust mặc định.

Đặc tả, các ranh giới TDD và bằng chứng kiểm tra nằm trong `.scratch/extension-parity/`.

## Đo độ trễ dịch

`npm run bench:translation` chạy command tooltip production trong WebView2,
profile tổng hợp riêng, native debug/frontend production và HTTP loopback 40 ms.
Mặc định thu 5 lượt cold + 100 lượt warm; đây là phép đo từ lúc có text đến paint,
không gồm lấy vùng chọn Windows. Không suy ra tốc độ provider thật từ server giả.

Main host dùng chung dịch/IPA giữa tooltip và PDF; Rust dùng lại HTTP client
đúng transport policy. Lệnh đo các nhóm provider thật, OCR đồng thời, reload
host và JSON trước/sau nằm trong
[MEASUREMENT.md](.scratch/translation-latency/MEASUREMENT.md).
