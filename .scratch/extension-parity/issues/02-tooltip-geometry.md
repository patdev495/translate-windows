# Kích thước, vị trí và khung tooltip theo extension

Status: done
Date: 2026-11-11

## Yêu cầu

Người dùng yêu cầu vị trí xuất hiện và chiều rộng giống extension; bỏ khoảng trắng thừa giữa nội dung và cửa sổ, bỏ viền ngoài. Sau đó người dùng đổi yêu cầu bàn giao: "code xong thì build luôn nhé"; cần build bộ cài mới sau kiểm tra, người dùng tự nghiệm thu ứng dụng.

## Tham chiếu và nguyên nhân

- Extension `TranslationTooltip.show`: nội dung `max-content`, phần đọc tối thiểu 350px (OCR lấy crop làm mức tối thiểu), padding card 16px mỗi cạnh. Chặn content ở viewport trừ 64px, card ở viewport trừ 32px; căn giữa viewport. Giữ chiều rộng vừa đo khi mở, chiều cao cuộn trong giới hạn viewport trừ 32px.
- Adapter native trước đây ép 480px hoặc crop+32, thêm margin 12px và chiều cao tối thiểu 120px; đo theo cửa sổ khởi tạo 420px thay vì vùng hiển thị. Đây là nguyên nhân khoảng trống và khác chiều rộng tham chiếu.
- Capability chưa cấp `core:window:allow-set-position`, trong khi adapter gọi `setPosition` rồi nuốt lỗi. Test IPC giả không thực thi ACL nên chưa bắt được.
- Tài liệu của Tauri `WebviewWindowBuilder::shadow`: bật shadow trên Windows tạo viền trắng 1px cho cửa sổ undecorated. Tooltip cần tắt shadow native, giữ một lớp card.

## Triển khai/kiểm chứng

- Native dùng work area của màn hình nguồn làm viewport tương đương, tính DPI và đổi crop width từ physical sang logical pixel.
- Tái sử dụng quy tắc đo nội dung của extension; giữ PDF theo viewport trang như hiện tại.
- Card ôm sát native content area, không thêm margin/frame ngoài; giữ padding đọc vốn có của extension. Kéo vẫn kéo cửa sổ native.
- Test tại S3/S6 đã duyệt: sửa test geometry cũ thành trường hợp kích thước đo được, màn hình thứ hai tọa độ âm và scale 2; đã quan sát fail đúng width/position rồi sửa đạt.
- Kiểm tra WebView2 thật ban đầu fail vì khung không ôm sát card. Sau khi bỏ frame/margin, phép đo còn phát hiện chiều cao bị làm tròn hai lần ở scale 1,5. Native nay làm tròn một lần theo physical pixel rồi đổi về logical để không thừa một dải ở đáy.
- Native cấp quyền set-position và tắt shadow Windows; card native bỏ outline/box-shadow ngoài. Test kéo cửa sổ tiếp tục đạt.

## Kết quả kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` chạy riêng | 30 file, 111 test đạt |
| Geometry/drag/OCR lifecycle chạy riêng | 13/13 đạt |
| `npm run test:ui` | 5/5 trang WebView2 đạt, exit 0 |
| TypeScript/Vite production | Đạt trong test:ui và kiểm tra build |
| Release native | Đạt, optimized compile 24 phút 20 giây |
| `npm run tauri build -- --bundles nsis --ci` | Đạt, exit 0; installer mới lúc 16:49 ngày 2026-11-11 |
| `git diff --check` | Đạt, chỉ có thông báo LF/CRLF |

[ui-smoke-results.json](../ui-smoke-results.json) ghi nhận `layout: { width: 382, inset: 0, outerFrame: 0, centered: true }`. Kiểm tra đọc kích thước/position native thật và DOM card thật trên màn hình DPI 150%; không chỉ kiểm tra chuỗi CSS hay IPC mock. Settings phím Ctrl/liên kết website giả, PDF, Copy và Hanzi tiếp tục đạt.

Một lượt chạy frontend song song với build gặp test OCR-ready không kịp báo sẵn sàng. Không sửa OCR hoặc tăng timeout; chạy lại riêng 13 test liên quan và toàn bộ 111 test khi không tranh tài nguyên đều đạt.

## Bộ cài đã bàn giao

Metadata mới nhất: [build-artifacts.json](../build-artifacts.json). Đã kiểm tra timestamp sau thời điểm bắt đầu build, SHA-256, header Windows MZ và kích thước hợp lệ; không còn smoke driver trong dist hoặc listener test cổng 1438. Không cài/chạy vào profile ứng dụng thật của người dùng.

| Artifact | Byte | SHA-256 |
| --- | --- | --- |
| `src-tauri/target/release/bundle/nsis/PolyTranslate_1.0.0_x64-setup.exe` | 256.478.096 | `FDDBCDC3672E49EA7EA98A08C4ADC27E992C46505C1BCB40AAA70167DBD2F0BD` |
| `src-tauri/target/release/translation-desktop.exe` | 267.580.416 | `9A1BD6B9F281F6CC2D2C3D05A954F374E8975FAA165231F9A33C0EDDF50EA7FB` |

## Comments

- 2026-11-11 16:49 +07:00: Hoàn tất bản sửa và bộ cài theo yêu cầu mới "code xong thì build luôn nhé". Người dùng tự nghiệm thu giao diện trong ứng dụng.

## Giới hạn

Không thay nội dung dịch, lưu học tập, phím tắt, chụp/ghim/copy hoặc quay màn hình. Chỉ build bộ cài khi kiểm tra cuối đạt, xác minh timestamp và SHA-256 của artifact mới.
