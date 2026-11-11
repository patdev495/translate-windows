# Đồng bộ desktop với Translation Extension

Status: done
Date: 2026-11-11

## Mục tiêu đã xác nhận

Đưa giao diện và chức năng của `D:\Workspace\translation-extention` vào ứng dụng desktop. Đây là phạm vi tương đương chức năng, không chỉ thay giao diện.

Người dùng chọn phương án A: desktop dùng chung tài khoản và Learning Library hiện có; quản lý thư viện và ôn tập tiếp tục ở website. Không đưa giao diện quản lý thư viện, flashcard hay luyện nghe nói của website vào desktop trong phạm vi này.

Người dùng đã xác nhận phạm vi và yêu cầu triển khai bằng TDD. Phạm vi sản phẩm và các ranh giới S1–S6 đều đã được duyệt, xem [TDD-SEAMS.md](./TDD-SEAMS.md). Kết quả triển khai và giới hạn kiểm chứng được ghi trong [VALIDATION.md](./VALIDATION.md).

## Phím tắt đã xác nhận

- Selected Text Translation Shortcut: phím riêng để dịch chữ đang chọn và hiện tooltip.
- Input Replacement Shortcut: phím riêng để thay phần chữ đang chọn trong ô nhập liệu bằng bản dịch.
- Người dùng có thể tự cấu hình cả hai phím, chọn phím đơn (ví dụ Ctrl) hoặc tổ hợp phím. Không dùng một phím chung tự đổi hành vi theo ngữ cảnh.
- Mặc định đã xác nhận: `Alt+Q` dịch hiện tooltip, `Alt+W` dịch thay chữ, `Ctrl+3` OCR. Phím quay màn hình giữ nguyên.
- Hai phím dịch có điều khiển ghi nhận tổ hợp phím trong Settings, không chỉ một danh sách tổ hợp cố định.

## Desktop độc lập đã xác nhận

- Chỉ cần cài desktop để sử dụng, bao gồm khi làm việc trong Chrome/Edge. Không yêu cầu extension hỗ trợ hay cầu nối trình duyệt.
- Dịch chữ được chọn và thay chữ trong ứng dụng nguồn sử dụng khả năng tích hợp của Windows. Mức tương thích cần kiểm chứng theo từng ứng dụng; không mặc định tương đương khả năng truy cập nội dung trang của extension.
- Phạm vi chức năng lấy extension làm tham chiếu, nhưng những cơ chế riêng của trình duyệt phải được chuyển thành hành vi phù hợp cho desktop độc lập.

## Tự dịch và Settings đã xác nhận

- Khi bật tự dịch, bôi đen chữ xong sẽ tự hiện bản dịch trong tooltip, giống extension.
- Có công tắc bật/tắt tự dịch trong Settings giống extension. Phím tắt dịch hiện tooltip vẫn sử dụng được khi tắt tự dịch.
- Dịch thay thế chỉ được yêu cầu bằng Input Replacement Shortcut riêng; tự dịch khi bôi đen không tự thay chữ.
- Settings lấy giao diện và cách tổ chức của extension làm chuẩn, bao gồm tùy chọn tự dịch.
- Lựa chọn cuối cùng của người dùng là B, thay cho câu trả lời A ngay trước đó.

## Lấy chữ cho tự dịch đã xác nhận

- Automatic Selected Text Translation chỉ chạy khi đọc được vùng chữ đang chọn trực tiếp, không tự gửi Copy và không đổi clipboard để lấy chữ.
- Nếu không đọc được chữ trực tiếp thì bỏ qua lượt tự dịch; không tự mở OCR.
- Khi người dùng chủ động nhấn Selected Text Translation Shortcut, giữ đường lấy chữ hiện tại: đọc trực tiếp trước, thử Copy nếu cần. OCR vẫn là thao tác riêng do người dùng kích hoạt.

## Khi không thay được chữ đã xác nhận

- Nếu đã có bản dịch nhưng không thể thay chữ trong ứng dụng nguồn, hiện bản dịch trong tooltip với nút Copy.
- Báo ngắn "Không thay được chữ trong ứng dụng này". Người dùng có thể tự Copy và dán kết quả.
- Không tự ghi bản dịch vào clipboard chỉ vì không thay được chữ. Nếu ô nhập, focus hoặc vùng chọn đã đổi trong lúc chờ, không quay lại ghi đè vùng chọn cũ.

## Trình đọc PDF đã xác nhận

- Có Desktop PDF Reader để mở file PDF trực tiếp trong desktop, với giao diện lấy trình đọc PDF của extension làm chuẩn.
- Cho phép chọn chữ để dịch và chọn vùng OCR trong tài liệu.
- Dùng đầy đủ tooltip và các tính năng học chữ Hán như luồng dịch còn lại.
- Không yêu cầu người dùng mở PDF bằng trình duyệt hoặc ứng dụng bên ngoài để sử dụng các chức năng này.

## Quay màn hình đã xác nhận

- Giữ nguyên chức năng quay màn hình hiện tại theo yêu cầu "cứ để yên" của người dùng.
- Không dùng đợt chuyển giao diện/chức năng dịch này để bỏ, thiết kế lại hoặc chuyển vị trí các điều khiển quay màn hình. Gợi ý tab Windows trước đó chưa được người dùng xác nhận.

## Cửa sổ và khởi động đã xác nhận

- Desktop chạy ở khay hệ thống như hiện tại, không tự mở cửa sổ chính khi khởi động.
- Từ biểu tượng khay hệ thống có thể mở Settings hoặc Desktop PDF Reader thành cửa sổ riêng.
- Giữ cơ chế OCR nền theo ADR-0002; cửa sổ đọc PDF không thay vai trò của cửa sổ OCR nền.

## Hành vi lấy từ extension làm chuẩn

Các mục dưới đây là kết quả đối chiếu mã nguồn để cụ thể hóa yêu cầu tương đương extension, không phải lựa chọn mới đã được hỏi riêng:

- Settings giữ năm nhóm Languages, Provider, Display, Website, OCR. Nhóm Provider thay một phím dịch theo ngữ cảnh bằng hai phím riêng theo quyết định đã chốt.
- Giữ Google, DeepL Web không key và DeepL API, lựa chọn ngôn ngữ và điều khiển hiển thị/âm thanh như extension.
- Thay chữ chỉ áp dụng cho vùng chọn trong ô chỉnh sửa được, không áp dụng ô mật khẩu; hủy nếu ô nhập, focus hoặc vùng chọn đổi trong lúc chờ. Giữ hành vi hoàn tác thao tác thay chữ.
- Dùng cùng Learning Library và luồng liên kết qua website; lưu từ/câu và hàng đợi đồng bộ theo tài khoản như extension.
- Nghĩa cá nhân và ghi chú chữ Hán là dữ liệu cục bộ riêng với Learning Library. Giữ nhập/xuất JSON tương thích backup của extension, có lựa chọn xử lý dữ liệu trùng; không mặc định tải ghi chú lên website.
- Auto Translate của extension áp dụng cho bôi đen chữ. Luồng OCR được người dùng kích hoạt không phụ thuộc công tắc này; cần giữ tùy chọn chụp/ghim/copy không dịch của desktop bằng một thiết lập riêng thay vì đánh đồng hai nghĩa.
- Mã nguồn hiện đóng gói mô hình OCR trong tài nguyên ứng dụng; extension cũng đóng gói dữ liệu nét và phân tích chữ Hán. Giữ cách cung cấp dữ liệu cục bộ này khi đưa sang desktop, không tự thêm yêu cầu tải mô hình qua mạng lần đầu. Dịch qua nhà cung cấp và đồng bộ Learning Library vẫn cần kết nối mạng.

## Khảo sát mã nguồn

Extension hiện có các nhóm chức năng cần đối chiếu khi đặc tả:

- Tooltip, giao diện cài đặt chia tab, lựa chọn ngôn ngữ và nhà cung cấp dịch.
- Pinyin/IPA, phát âm, liên kết từ điển và tương tác giữa chữ với phiên âm.
- Viết nét chữ Hán, phân tích thành phần, nghĩa cá nhân, ghi chú và sao lưu JSON.
- Dịch chữ được bôi đen, dịch thay thế phần chữ được chọn trong ô nhập liệu.
- Chọn vùng OCR, ảnh ghim, sao chép ảnh, trình đọc PDF.
- Liên kết tài khoản, lưu từ/câu từ tooltip, chọn thư mục và hàng đợi đồng bộ khi mất mạng.

Tại thời điểm khảo sát, desktop có dịch Selected Text bằng Ctrl đơn lẻ, OCR vùng màn hình, tooltip, ảnh ghim, clipboard, khởi động cùng Windows và quay màn hình. Có thay đổi chưa commit trong repo; phải bảo toàn công việc hiện có. Các thay đổi sản phẩm mới được mô tả trong các phần đã xác nhận ở trên.

Khác biệt đã thấy trong mã nguồn: extension tự dịch vùng chữ bôi đen khi bật autoTranslate; Ctrl trái mặc định còn dùng để thay bản dịch vào vùng chọn trong ô nhập liệu. Desktop hiện dùng Ctrl trái/phải đơn lẻ để hiện tooltip và chưa có luồng thay chữ trong ứng dụng nguồn.

## Quy ước triển khai đề xuất để hoàn thiện phạm vi

Các điểm dưới đây dùng phán đoán triển khai và hành vi hiện có làm mặc định cho bản đặc tả cuối, không được coi là câu trả lời riêng của người dùng:

- Phím OCR giữ cấu hình hiện có; không mở rộng yêu cầu tùy biến phím sang quay màn hình. Hai phím dịch không được trùng nhau hay trùng phím OCR/quay màn hình. Nếu Windows từ chối đăng ký, báo rõ và giữ cấu hình hoạt động trước đó.
- Giữ cài đặt và dữ liệu desktop hiện có khi nâng cấp; chỉ thêm mặc định cho trường mới. Không tự nhập dữ liệu từ profile trình duyệt. Nghĩa/ghi chú chữ Hán từ extension chuyển bằng backup JSON; đăng nhập/liên kết lại với cùng tài khoản để thấy Learning Library.
- PDF hỗ trợ file cục bộ, điều hướng trang, zoom, tài liệu có mật khẩu theo trình đọc của extension; giữ cách render theo nhu cầu để tài liệu dài không cần dựng mọi trang ngay lập tức. Không tự đổi ứng dụng PDF mặc định của Windows hoặc điều hướng tab trình duyệt.
- Bố cục, màu, kiểu chữ, biểu tượng và tương tác của Settings/tooltip/bảng chữ Hán lấy source extension làm chuẩn. Chỉ điều chỉnh kích thước, cuộn, vị trí và cửa sổ nổi theo màn hình Windows. Bảng phân tích chữ Hán là cửa sổ nổi riêng, kéo và đóng độc lập theo hành vi extension.
- Khởi động cùng Windows, chụp màn hình, ghim ảnh và sao chép ảnh tiếp tục có mặt; tùy chọn riêng của desktop được bổ sung gọn trong nhóm phù hợp và menu khay, không thiết kế lại quay màn hình.
- Giữ giấy phép và nguồn dữ liệu OCR/chữ Hán khi đóng gói. Bảo toàn OCR host hiện có và kết quả chờ khi đóng/mở tooltip; không nạp một bộ model riêng cho mỗi PDF hoặc tooltip.

## Tiêu chí hoàn thành

1. Ứng dụng chạy độc lập trong Windows và ở khay hệ thống; Settings và PDF là cửa sổ riêng.
2. Settings có đủ năm nhóm và tùy chọn tương đương extension, cộng hai phím dịch riêng đã chốt; lưu và áp dụng qua các cửa sổ, còn hiệu lực sau khởi động lại.
3. `Alt+Q` và phím thay thế do người dùng đặt dịch đúng vùng chữ đang chọn; luồng chủ động giữ đọc trực tiếp rồi thử Copy nếu cần, không dùng clipboard cũ làm văn bản mới.
4. Auto Translate bật/tắt được, chỉ dịch vùng chọn đọc trực tiếp, không gửi Copy hay tự OCR. Một vùng chọn không bị dịch lặp hoặc tạo tooltip mới do thao tác trong chính tooltip.
5. `Alt+W` và phím thay thế do người dùng đặt chỉ thay vùng chọn hợp lệ trong ô nhập bằng bản dịch trực tiếp sang ngôn ngữ chính; không sửa ô mật khẩu, toàn bộ tài liệu hoặc nguồn đã đổi. Không thay được thì dùng tooltip/Copy như đã chốt.
6. Tooltip có dịch đa ngôn ngữ, Pinyin/IPA, liên kết chữ với phiên âm, phát âm, sao chép, từ điển và thao tác kéo/đóng theo extension; không ra ngoài vùng màn hình khi nội dung dài.
7. Viết nét và phân tích chữ Hán, vòng lặp nhiều chữ, tốc độ, ngôn ngữ giải thích, nghĩa cá nhân, ghi chú và nhập/xuất JSON hoạt động theo extension.
8. Liên kết cùng Learning Account, chọn thư mục, lưu từ/câu/cặp liên kết, hàng đợi khi mất mạng và thử đồng bộ lại hoạt động; tách dữ liệu theo tài khoản, không lẫn dữ liệu khi ngắt hoặc đổi liên kết.
9. PDF mở được trong desktop, chọn chữ hoặc vùng OCR và dùng chung tooltip/học chữ Hán; không bắt người dùng cài extension hay mở trình đọc ngoài.
10. OCR vẫn chạy cục bộ qua host dùng lại model; chụp/ghim/copy ảnh và tùy chọn chỉ chụp không dịch còn hoạt động. Auto Translate vùng chọn không làm mất chức năng này.
11. Quay màn hình và các phím/điều khiển của nó giữ nguyên. Không ghi đè những thay đổi trước phiên này trong working tree.
12. Build và kiểm tra tự động phù hợp đạt; kiểm tra tích hợp bằng dữ liệu tổng hợp/cục bộ. Người dùng tự nghiệm thu thực tế theo cách riêng, không cần chốt danh sách ứng dụng trước.

## Quan hệ với tài liệu hiện có

- Giữ ADR-0001 về nền tảng desktop và ADR-0002 về OCR host thường trú; áp dụng thêm ADR-0003/0004 về Learning Library chung và desktop độc lập.
- Khi triển khai, phần phím tắt của đặc tả này thay hành vi Ctrl đơn lẻ trong `.scratch/selected-text/PRD.md`; giữ những bảo đảm lấy đúng vùng chọn, giới hạn chờ và chống kết quả cũ của luồng đó.
- Không triển khai giao diện website học tập trong desktop, không cần cầu nối extension, không viết lại quay màn hình.

## Comments

- 2026-11-11: Người dùng yêu cầu chuyển hoàn toàn giao diện và chức năng desktop theo extension.
- 2026-11-11: Người dùng chọn A: chức năng extension trong desktop, dùng chung tài khoản/thư viện; quản lý và ôn tập mở website.
- 2026-11-11: Khi được hỏi về hành vi Ctrl, người dùng yêu cầu có thể tùy chọn tổ hợp phím tắt. Chưa chọn dùng chung phím theo ngữ cảnh hay dùng phím riêng cho từng thao tác.
- 2026-11-11: Người dùng chọn A: hai phím riêng có thể cấu hình cho dịch hiện tooltip và dịch thay thế.
- 2026-11-11: Người dùng chọn A: desktop chạy độc lập cả trong trình duyệt, không cần extension hỗ trợ.
- 2026-11-11: Người dùng sửa lựa chọn tự dịch từ A sang B, yêu cầu Settings giống extension: bôi đen tự dịch khi bật công tắc, vẫn có phím tắt chủ động.
- 2026-11-11: Người dùng chọn A: trình đọc PDF trong desktop với chọn chữ, OCR và đầy đủ tooltip học chữ Hán.
- 2026-11-11: Người dùng yêu cầu để nguyên chức năng quay màn hình hiện có.
- 2026-11-11: Người dùng chọn A: tự dịch chỉ lấy chữ trực tiếp, không tự Copy/đổi clipboard; chủ động nhấn phím dịch vẫn có thể thử Copy, OCR là thao tác riêng.
- 2026-11-11: Người dùng chọn A: chạy ở khay hệ thống, mở Settings và Desktop PDF Reader thành cửa sổ riêng.
- 2026-11-11: Người dùng muốn tự kiểm chứng thực tế theo cách riêng. Sau khi trợ lý hiểu thành lệnh triển khai, người dùng yêu cầu tiếp tục hỏi các điểm còn lại; phiên đặc tả vẫn tiếp tục, chưa sửa mã ứng dụng.
- 2026-11-11: Người dùng chọn A: nếu dịch được nhưng không thay được chữ thì hiện kết quả trong tooltip kèm nút Copy và thông báo ngắn.
- 2026-11-11: Người dùng xác nhận bộ mặc định `Alt+Q`/`Alt+W`/`Ctrl+3`, giữ phím quay màn hình hiện có.
- 2026-11-11: Người dùng xác nhận phạm vi, yêu cầu tiến hành code và gọi skill TDD. Không hỏi lại quyền triển khai; xác nhận ranh giới kiểm thử là bước riêng do skill yêu cầu.
- 2026-11-11: Người dùng duyệt S1–S6, tiếp tục triển khai. Đã hoàn tất mã, kiểm tra tự động và bộ cài NSIS mới; xem [VALIDATION.md](./VALIDATION.md) để phân biệt kết quả tự động với phần nghiệm thu thực tế của người dùng.
- 2026-11-11: Người dùng báo lỗi kéo tooltip, yêu cầu phím đơn và làm rõ website đã báo liên kết thành công nhưng Settings app không cập nhật. Theo dõi tại [issues/01-tooltip-shortcut-link.md](./issues/01-tooltip-shortcut-link.md); người dùng yêu cầu cung cấp lệnh build thay vì đóng gói lại bộ cài trong lượt sửa.
- 2026-11-11: Người dùng yêu cầu vị trí/chiều rộng theo extension, bỏ lớp trống và viền ngoài của tooltip; sau đó yêu cầu build luôn. Đã sửa, kiểm tra và hoàn tất bộ cài mới lúc 16:49; xem [issues/02-tooltip-geometry.md](./issues/02-tooltip-geometry.md).
