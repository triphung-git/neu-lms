# Trạng thái — 20/10/2026
Hiện có frontend demo; chưa có backend/database/xác thực/email/AI/file processing production hoặc CD. Đã thêm workflow CI cho lint, typecheck, test, build và check tổng ci-gate; chưa chạy trên GitHub.
Nhiều vai trò, email mẫu mới, duyệt giảng viên, ghi danh, thi, báo cáo và SCORM/xAPI/LTI là phạm vi đã duyệt, chưa triển khai trong đợt này.

Kiểm tra local ngày 20/10/2026: build và typecheck đạt; 41 tests trong 8 file đạt; lint không có error, còn warning (React Hooks/render và biến không dùng). Build cảnh báo chunk khoảng 629 KB. Script typecheck hiện là tsc -b --noEmit. Các cảnh báo cần ticket xử lý riêng; CI hiện chặn lint error, không chặn toàn bộ warning.

Các kiểm tra này không phải nghiệm thu bảo mật/production hoặc E2E trình duyệt. GitHub runner cần được xác nhận bằng lần chạy đầu tiên sau push. Giả định frontend hoàn thiện trong kế hoạch không thay kết quả kiểm thử thực tế.

