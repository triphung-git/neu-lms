# Kiến trúc
## Hiện tại
SPA React/TypeScript strict/Vite; React Router ở frontend/src/App.tsx. Context quản lý database, session, clock, notification; RouteGuard hỗ trợ quyền demo.
12 blueprint: public, identity, dashboards, courses, memberships, materials, assignments, submissions, grading, announcements, ai, administration; 39 page components baseline.
shared chứa UI/kiểu/helpers; infrastructure chứa seed và persistence mock. Vitest/Testing Library/jsdom và oxlint, CSS thuần.

Assignments và grading đã có contracts/domain/mock adapters, được nối qua app/composition. Đây là bước tách ranh giới trong frontend; chưa có HTTP adapter hoặc backend. Các phần còn lại vẫn sử dụng context/mock.

## Mục tiêu
Frontend gọi typed API adapter; backend kiểm quyền theo tài nguyên, validation, transaction, audit và thời gian server. DatabaseContext hiện chưa phải adapter hoàn chỉnh. Mô hình một role/storage demo không phải thiết kế production.
Backend cần tài khoản, email xác minh, vai trò được cấp/yêu cầu, membership, nội dung và revision; điểm gắn revision bài nộp. Database/object storage/queue/framework chưa được chọn. Các quyết định mới cần review cùng tài liệu và contract tests.

