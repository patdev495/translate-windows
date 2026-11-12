# Bằng chứng TDD

Seams: S1–S6 đã duyệt tại `../extension-parity/TDD-SEAMS.md`.

## 02 — HTTP command → loopback server

Command: `cargo test --manifest-path src-tauri/Cargo.toml --features latency-harness --test http_transport -j 1 -- --nocapture`.

Red trước pooling: hai command trả status 200 và body synthetic đúng;
assert TCP connections thất bại với **left: 2, right: 1** (2026-11-12).
Lần chạy fixture đầu gặp accepted socket nonblocking; đã sửa riêng server
fixture rồi chạy lại để lấy red hành vi ở trên. Không coi lỗi fixture là red.

Green sau pooling: cùng test qua với **1 kết nối TCP**, cả hai body vẫn đúng.
State giữ hai client policy riêng, lazy init không cache lỗi, clone handle trước await.

Kiểm tra sau green: credential A → B → không Authorization; endpoint bị cấm,
redirect không follow, response >4 MiB, HTTP 503 giữ body/status; response trễ
16 giây bị timeout theo policy 15 giây và request tiếp theo vẫn thành công.
Bốn test native public command đều qua; chỉ server TCP được thay ở boundary.
