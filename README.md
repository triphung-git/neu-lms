# NEU LMS

## Bắt đầu

Chạy từ thư mục frontend:
```sh
npm ci
npm run dev
```
Dùng Node tương thích engines trong lockfile; môi trường tham chiếu trước đây là Node 24.20.0. Mở URL do Vite cung cấp.

## Tài liệu
- [Danh mục](docs/README.md)
- [Phạm vi đã duyệt](../agent-private/docs/requirements/SCOPE.md)
- [Kiến trúc](../agent-private/docs/architecture/CURRENT.md)
- [Cài đặt và kiểm thử](../agent-private/docs/development/SETUP.md)
- [Trạng thái](../agent-private/docs/development/STATUS.md)
- [Quy trình đóng góp](../agent-private/docs/development/WORKFLOW.md)
- [API](../agent-private/docs/api/README.md)
- [Triển khai](../agent-private/docs/deployment/README.md)

39 màn hình prototype chưa bao phủ các yêu cầu mở rộng. Chức năng đã duyệt không đồng nghĩa đã triển khai. CI nền tảng nằm tại [.github/workflows/ci.yml](.github/workflows/ci.yml), chạy lint, typecheck, test và build trên Ubuntu với Node 24.20.0. Xem [hướng dẫn GitHub](../agent-private/docs/development/GITHUB.md) để thiết lập required check và review.
