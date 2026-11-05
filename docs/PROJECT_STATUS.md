# Trạng thái dự án — cập nhật 04/11/2026

Bản này được sửa từ `neu-lms(4).zip`. Các luồng chính đã có API/UI; đợt bổ sung hoàn thiện chat lưu lịch sử, quyền truy xuất và nguồn AI, tự index embeddings, email thông báo nền, dashboard và chẩn đoán admin.

Chi tiết mã nguồn, migration, cấu hình, test đã chạy và giới hạn kiểm chứng nằm trong [COMPLETION_UPDATE.md](COMPLETION_UPDATE.md).

Chưa tuyên bố 100%: chưa có scope/acceptance criteria được duyệt, chưa chạy toàn bộ backend suite trên PostgreSQL 17 hay nghiệm thu với provider AI, SMTP, S3, ClamAV và staging thực tế. Các chức năng email/chat lịch sử đã được bổ sung vào phạm vi code trong đợt này; quyết định bật chúng ở môi trường thật thuộc cấu hình triển khai.

Bằng chứng hiện tại: 282 frontend tests; 68 backend tests chọn lọc. Backend DB trong lượt kiểm chứng giới hạn dùng SQLite, không kiểm chứng locking PostgreSQL. TypeScript và frontend build đạt. Lint frontend còn cảnh báo React; build còn cảnh báo kích thước bundle.

Để chốt bàn giao: chạy scripts/verify-release.ps1 trên môi trường PostgreSQL chuẩn, hoàn thành bảng UAT và diễn tập backup/restore/rollback trong tài liệu cập nhật. Không tăng phần trăm chỉ dựa trên số file hoặc số test.
