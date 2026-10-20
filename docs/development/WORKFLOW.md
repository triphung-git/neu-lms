# Quy trình đóng góp mục tiêu
Workflow CI và PR template đã có trong .github; branch protection và CODEOWNERS chưa được cấu hình trên GitHub. Xem [hướng dẫn thiết lập](GITHUB.md).
Issue có owner/phạm vi/dependency/acceptance. Branch ngắn từ main, ví dụ feat/dev1/123-auth; PR có mô tả, test, ảnh hưởng dữ liệu/cấu hình/tài liệu.
Main cần PR, CI, approval người khác/code owner, xử lý hết review, cập nhật main; hủy approval khi thêm commit; chặn force push/xóa/bypass thường lệ. Squash merge rồi xóa branch.
CI hiện có: npm ci, lint, typecheck, Vitest và build; ci-gate tổng chỉ đạt khi frontend-checks đạt. Chưa có E2E trình duyệt hoặc backend integration. PR không dùng secret production. CODEOWNERS cần username thật; khả năng bảo vệ phụ thuộc gói/visibility.
Done: đạt acceptance, test phù hợp, PR/CI đạt, staging chạy và tài liệu cập nhật.

