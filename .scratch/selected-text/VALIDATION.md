# Kiểm chứng Selected Text Translation

Status: done

## Mốc trước sửa

- `npm test -- --reporter=dot`: 18 tệp, 88 test đạt. Có hai cảnh báo callback Tauri trong test OCR có sẵn, không gây thất bại.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 16 unit test và 10 integration test đạt.
- Người dùng đã xác nhận S1–S3 trong PLAN.md trước khi viết test mới.

## Các vòng TDD

1. S1, Ctrl trái đơn lẻ: đỏ vì chưa có public module `selected_text`; thêm input interface/trigger tối thiểu → xanh 1 test.
2. S1, Ctrl dùng với phím/chuột: đỏ tại assertion không được yêu cầu dịch sau Ctrl+C; thêm hủy gesture → xanh 2 test.
3. S1, Ctrl phải, repeat và thứ tự giữ phím: đỏ vì Ctrl phải không tạo yêu cầu; theo dõi các phím đang giữ/candidate → xanh 3 test.
4. S2, UIA trả Selected Text mà không đổi clipboard: đỏ vì chưa có acquisition interface; thêm interface và nhánh UIA → xanh 4 test.
5. S2, UIA rỗng/lỗi chuyển Copy: đỏ `unwrap` nhận NoText; thêm nhánh Copy → xanh 5 test.
6. S2, clipboard cũ không được dịch: đỏ trả “old clipboard”; kiểm tra sequence mới và deadline → xanh 6 test.
7. S2, nguồn đổi khi UIA đang chạy: đỏ Copy nhầm và trả text; kiểm tra nguồn ở các điểm giao nhận → xanh 7 test.
8. S3, lỗi lấy chữ: đỏ không có thông báo status; thêm payload lỗi riêng và tự đóng 2 giây → test entrypoint tooltip xanh, không gọi HTTP/OCR.
9. S2 native: đỏ vì chưa có Windows adapter; thêm UIA/COM worker và native Copy/clipboard → smoke đọc đúng `hello 世界`, giữ sentinel clipboard; nguồn custom không có TextPattern lấy được `copied synthetic 世界` bằng Copy, kể cả copy lại cùng nội dung.
10. S1 native: đỏ vì chưa có input runtime; thêm keyboard/mouse hooks và cleanup. Test phát Ctrl bằng SendInput tới cửa sổ nguồn ở **process khác** để own-process exclusion không che lỗi injected-key filter; kiểm tra nguồn vẫn nhận Ctrl và tính năng không tự dịch, rồi tháo/cài hook lần nữa.
11. S2 native, trạng thái Ctrl chưa kịp cập nhật: đỏ nhận SourceChanged dù Ctrl được nhả sau 20 ms; thêm chờ nhả modifier tối đa 50 ms trước Copy. Không phát key-up để ép nhả phím của người dùng.

## Kết quả kiểm tra

- `npm test -- --reporter=dot`: 19 tệp, **90 test đạt**. Test tooltip mới chạy entrypoint thật, controller/settings/translation thật, chỉ giả IPC/window APIs và HTTP.
- `npm run build`: đạt. Vite có cảnh báo chunk lớn do tài nguyên/dictionary hiện có; không chặn build.
- `cargo test --manifest-path src-tauri/Cargo.toml`: **33 test đạt**, smoke test desktop được đánh dấu ignored và chạy riêng bên dưới.
- `cargo check --manifest-path src-tauri/Cargo.toml`: đạt.
- Lệnh smoke Windows: `cargo test --manifest-path src-tauri/Cargo.toml --test selected_text_windows -- --ignored --test-threads=1`.
- Lần chạy cuối của smoke Windows: **3/3 đạt** trong 4,60 giây, gồm chờ Ctrl nhả, injected Ctrl qua hook có thể restart, và UIA/Copy Unicode thật. Test hook còn xác nhận clipboard sentinel không đổi để phát hiện Copy ngoài ý muốn dù kết quả dịch bị hủy.
- Build executable chứa frontend: `npm run tauri -- build --debug --no-bundle`.
- Sau sửa cuối ở native modifier-release, giữ frontend đã build và cập nhật executable bằng `cargo build --manifest-path src-tauri/Cargo.toml --bin translation-desktop --features tauri/custom-protocol`.
- Cả hai lệnh build executable đạt. Sau toàn bộ test, build lại với custom protocol và sao chép bản chạy thử cuối tới `src-tauri/target/selected-text-preview/PolyTranslate.exe`; SHA-256 trùng executable vừa build. Bản này chứa frontend đã build, không cần chạy Vite dev server. Đây là debug executable, chưa tạo installer.
- Giữ bản preview riêng vì `cargo test` không bật custom protocol có thể ghi đè executable trong `target/debug` bằng bản cần dev server. Thư mục preview nằm trong `target` đã được Git ignore.

## Cách kiểm thử Windows thật

Fixture tạo cửa sổ nguồn tổng hợp, xác nhận nó có foreground/focus trước khi đọc hoặc phát phím. Phần tử EDIT thật kiểm tra UIA; cửa sổ custom xử lý Copy kiểm tra fallback. Fixture gắn input queue trong thời gian tồn tại để giữ focus ổn định, tháo khi đóng; cơ chế ép focus này chỉ nằm trong test, không nằm trong tính năng.

Phím Injected được bỏ qua bởi hook; test Ctrl gesture trái/phải và các tổ hợp chạy qua public input interface S1. Chưa mô phỏng được phím vật lý bằng SendInput vì chính thiết kế phải loại sự kiện injected.

## Giới hạn và test thủ công

- Chưa xác nhận tương thích mọi app. Cần dùng executable, bôi đen text rồi nhấn/nhả Ctrl vật lý trên các ứng dụng người dùng muốn thử.
- Cần thử Ctrl+C/V/3, Ctrl+click, Ctrl+cuộn và hai Ctrl để xác nhận không mở tooltip ngoài ý muốn trong môi trường sử dụng thực tế.
- UIA đọc trong cửa sổ foreground với phạm vi duyệt hữu hạn; source đổi hoặc có thao tác input mới thì hủy kết quả đang chờ. Không ghi text người dùng vào log.
- Provider UIA có connection/transaction timeout 200 ms; caller chờ UIA tối đa 750 ms, đợi clipboard mới tối đa 800 ms, và đợi modifier nhả tối đa 50 ms. Đây là deadline cấu hình, không phải số đo tốc độ trên mọi app.
- Chỉ có một UIA worker dùng chung trong runtime. COM bị chậm có thể hoàn tất muộn; kết quả chỉ gửi về receiver của lượt cũ và không được đổi clipboard/tooltip. Trong lúc worker còn bận, lượt sau có thể dùng Copy dự phòng.
- App quyền cao hơn hoặc app không cung cấp selection/Copy có thể không lấy được chữ. Thất bại lấy chữ báo ngắn, không tự mở OCR.

## Thử nhanh

1. Mở executable mới; app chạy ở khay hệ thống.
2. Bôi đen một đoạn trong app khác, nhấn rồi nhả Ctrl trái; thử lại bằng Ctrl phải.
3. Xác nhận tooltip hiện source/bản dịch, clipboard giữ nguyên khi UIA lấy được chữ.
4. Với app phải dùng Copy, paste để kiểm tra clipboard đang giữ đoạn vừa dịch.
5. Thử Ctrl+C/V và Ctrl+click/cuộn; không được mở tooltip dịch.
6. Khi không lấy được chữ, chỉ thấy thông báo “Không lấy được văn bản” tự đóng sau 2 giây.
