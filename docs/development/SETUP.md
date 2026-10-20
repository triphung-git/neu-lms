# Setup và kiểm thử
Từ gốc repository: cd frontend, npm ci, npm run dev. CI dùng Node 24.20.0; dùng cùng phiên bản khi phát triển để giảm khác biệt môi trường. Lockfile được giữ trong Git; không cập nhật dependency ngoài phạm vi ticket.

| Lệnh trong frontend | Mục đích |
| --- | --- |
| npm run build | tsc -b && vite build |
| npm test | vitest run |
| npm test -- src/__tests__/routing.test.tsx | Test routing |
| npm run lint | oxlint |
| npm run typecheck | tsc -b --noEmit |
| npm run preview | Xem dist cục bộ |

TypeScript strict, Vitest jsdom. Xác minh phạm vi typecheck trước khi dùng làm CI gate. Không có backend để khởi động. Không commit node_modules/dist/coverage/secret. Kết quả kiểm tra phải gắn phiên bản hiện tại; xem [STATUS](STATUS.md).

