# Frontend NEU LMS

Chạy trong thư mục này:
```sh
npm ci
npm run dev
npm run build
npm test
npm run lint
npm run typecheck
```
Xem [setup](../../agent-private/docs/development/SETUP.md) và [trạng thái](../../agent-private/docs/development/STATUS.md). npm run preview xem bản build cục bộ.

src/App.tsx khai báo route; src/app/providers quản lý state; src/blueprints chứa các trang; src/shared chứa UI và kiểu chung; src/infrastructure chứa mock/persistence; src/__tests__ chứa Vitest tests.

Namespace demo: npc-lms-demo:v1; session: npc-lms-demo:session. Không nhập dữ liệu hoặc mật khẩu thật. Xác thực demo không cung cấp bảo vệ production; reset không được xóa storage của ứng dụng khác.

