# Triển khai
npm run build trong frontend tạo dist; npm run preview kiểm tra cục bộ. Hosting SPA cần fallback route về index.html. Build hiện là demo, chưa dùng dữ liệu thật.

Pipeline mục tiêu: PR/CI → merge main → artifact theo commit → staging/smoke/E2E → nghiệm thu → duyệt production → deploy artifact đã kiểm → health check.
Tách secret/môi trường, một deploy production cùng lúc; migration có kiểm soát, backup/restore đã thử. Rollback ứng dụng không tự đảo migration.
Chưa chọn hosting/database/lệnh deploy. Tài liệu công khai chỉ chứa cấu hình mẫu; thông tin truy cập quản lý riêng. Trước public cần chốt giấy phép/quyền tài sản và kiểm tra lịch sử Git.

