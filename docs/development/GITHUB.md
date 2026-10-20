# Thiết lập GitHub sau lần push đầu

## Ranh giới repository

Khởi tạo Git tại gốc codebase chứa README, frontend, docs và .github. Không khởi tạo repo ở thư mục cha. Xem kỹ git status và git diff --cached trước commit; .gitignore không loại bỏ file đã tracked. Chỉ .env.example với giá trị mẫu được phép đưa vào Git.

## CI có sẵn

Workflow CI chạy trên push branch, pull_request và workflow_dispatch, kể cả PR chỉ sửa docs. Ubuntu 24.04, Node 24.20.0, cache npm theo lockfile. frontend-checks chạy npm ci, lint, typecheck, test, build; ci-gate chạy always và yêu cầu kết quả success. Lint warning được phép; error bị chặn. Không có continue-on-error hoặc deploy.

Actions được pin commit đã xác minh từ repository chính thức. Token chỉ contents: read, checkout không lưu credentials, job PR không dùng secret. Không đổi sang pull_request_target để chạy code contributor. Các lần cùng event/ref hủy lượt cũ. Push và PR có thể chạy hai lần, giúp giữ kiểm tra branch và kết quả tích hợp PR độc lập.

## Bảo vệ main

1. Push bản đầu lên repo được chọn, xác nhận workflow CI chạy xanh trên GitHub.
2. Settings → Rules/Branches: bảo vệ main, bắt buộc PR và ít nhất một approval của người khác; dismiss stale approvals; resolve conversations; yêu cầu branch cập nhật với main.
3. Chọn required status check có tên ci-gate, nguồn GitHub Actions. Không đổi tên check mà chưa cập nhật rule. Chặn force push/xóa và bypass thường lệ.
4. Thêm CODEOWNERS với username/team thực, sau đó bật yêu cầu code owner review. Tác giả PR không tự thay cho người review độc lập.
5. Actions permissions chỉ cho actions được duyệt và token read-only. Không cấp secret production cho CI.

Nếu dùng merge queue sau này, thêm trigger merge_group và kiểm chứng trước khi bật queue. YAML không tự bật branch protection; tính năng khả dụng phụ thuộc gói và visibility.

## Trước public

- Chọn license và xác nhận quyền phân phối source, logo, fonts/tài sản liên quan.
- Quét secret trên tập file commit và lịch sử Git nếu đã có commit; thu hồi secret bị lộ trước khi xử lý lịch sử.
- Không đưa dữ liệu thật, backup hoặc thông tin hạ tầng nội bộ vào Git.
- Giữ mô tả demo và các giới hạn thực tế; CI đạt không chứng nhận production.
