# Frontend NEU LMS
React + TypeScript strict + Vite, React Router, CSS và dữ liệu demo. Một số nội dung hiện còn mang tên NPC.

Chạy trong thư mục này:
```sh
npm ci
npm run dev
npm run build
npm test
npm run lint
npm run typecheck
```
Xem [setup](../docs/development/SETUP.md) và [trạng thái](../docs/development/STATUS.md). npm run preview xem bản build cục bộ.

src/App.tsx khai báo route; src/app/providers quản lý state; src/blueprints chứa các trang; src/shared chứa UI và kiểu chung; src/infrastructure chứa mock/persistence; src/__tests__ chứa Vitest tests.

Namespace demo: npc-lms-demo:v1; session: npc-lms-demo:session. Không nhập dữ liệu hoặc mật khẩu thật. Xác thực demo không cung cấp bảo vệ production; reset không được xóa storage của ứng dụng khác.

