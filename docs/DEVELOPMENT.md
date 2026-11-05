# Cài đặt và phát triển NEU LMS

## Yêu cầu

- Node.js 24.20.0 (đúng CI) và npm tương thích với `frontend/package-lock.json`.
- Python 3.13.x và `uv` đúng phiên bản CI/lockfile.
- Docker Engine + Docker Compose v2.
- PostgreSQL 17, Redis 7.4, S3-compatible storage, ClamAV và SMTP (Compose cung cấp các dịch vụ local tương ứng).

## Khởi động local

1. Copy `.env.example` thành `.env` tại root và thay các giá trị mẫu. Nếu `.env` đã tồn tại, không ghi đè file này.
2. Nếu báo `No environment file found at: ../.env`, kiểm tra file `.env` ở root repository. Từ root dùng `Test-Path .env`; từ thư mục `backend` dùng `Test-Path ..\.env`. Không tạo `.env` trong `frontend` để thay thế file cấu hình Docker Compose ở root.
3. Chạy `docker compose --profile files up -d --build`.
3. Chạy migration: `docker compose run --rm api python manage.py migrate`.
4. Chạy frontend: `cd frontend`, `npm ci`, `npm run dev`.
5. Mở giao diện qua URL Vite. API proxy được định nghĩa trong `frontend/vite.config.ts`.

Nếu chỉ cần API không dùng pipeline file, có thể bỏ profile `files`; khi đó không có ClamAV/file worker/scheduler và không thể nghiệm thu luồng file đầy đủ.

## Cấu hình AI B14

Đặt các biến trong `.env` ở root: `AI_API_KEY`, `AI_API_BASE_URL`, `AI_CHAT_MODEL`, `AI_REQUEST_TIMEOUT_SECONDS`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_DIMENSIONS`, `AI_EMBEDDING_TIMEOUT_SECONDS` và `AI_RAG_TOP_K`. Trong source hiện tại, `AI_API_KEY` được dùng chung cho Gemini Embedding API và API chat tương thích OpenAI. Vì vậy khóa phải là Google/Gemini API key; `AI_API_BASE_URL` mặc định trỏ tới endpoint chat tương thích OpenAI của Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`), còn `AI_CHAT_MODEL` phải là model được endpoint đó hỗ trợ. Không dùng OpenAI API key với cấu hình hiện tại vì phần embedding gọi trực tiếp Gemini. Không để trống `AI_API_KEY` hoặc `AI_CHAT_MODEL` khi kiểm thử chat thật.

Sau khi học liệu được công bố và trích xuất/index, sinh viên có quyền truy cập môn học có thể hỏi từ trang chi tiết học liệu. Chat history gửi tối đa 8 tin nhắn gần nhất; history chỉ giúp giải quyết ngữ cảnh, không được coi là nguồn kiến thức. Nguồn trả lời phải đến từ chunks và citations của môn học. Để hạn chế lạm dụng và chi phí provider, chat giới hạn 30 yêu cầu mỗi 15 phút cho mỗi tài khoản (bộ đếm dùng chung qua PostgreSQL).

### Bản nháp tóm tắt AI cho giảng viên

Tại `/gv/ban-nhap-ai`, giảng viên phụ trách học phần có thể chọn một học liệu không bị ẩn để tạo bản nháp tóm tắt. Backend chỉ dùng văn bản trích xuất thành công từ các tệp có trạng thái `CLEAN` thuộc phiên bản `FINALIZED` và `READY`; tổng văn bản giới hạn 40.000 ký tự và mỗi giảng viên được tối đa 12 yêu cầu/15 phút. AI không tự công bố nội dung. Giảng viên phải biên tập rồi xác nhận hoặc từ chối; chỉ quyết định xác nhận mới cập nhật `MaterialVersion.summary` và `summary_confirmed_at`. Bản nháp gắn với một phiên bản cụ thể; nếu phiên bản mới đã được finalized, hệ thống từ chối duyệt bản nháp cũ.

API:
- `GET /api/v1/ai/teacher/summary-drafts`
- `POST /api/v1/ai/courses/{course_id}/materials/{material_id}/summary-drafts`
- `POST /api/v1/ai/teacher/summary-drafts/{draft_id}/review`

Trước khi sử dụng lần đầu, chạy `python manage.py migrate` để tạo bảng `MaterialSummaryDraft`.

## Kiểm thử

### Frontend

```bash
npm ci
npm run api:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

### Backend

```bash
uv sync --frozen --group dev
uv run ruff check .
uv run ruff format --check .
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest -q
```

Backend test suite cần PostgreSQL do migration/search sử dụng full-text functions và extensions của PostgreSQL. `config.settings.sqlite` chỉ tiện cho một số thao tác local; không thay thế CI PostgreSQL 17.

## Schema API

Sau khi thay đổi DRF serializers/views, từ `backend` chạy:

```bash
uv run python manage.py spectacular --file ../schema/openapi.json --validate --format openapi-json
```

Sau đó từ `frontend` chạy `npm run api:generate` rồi `npm run api:check`. Commit đồng thời `schema/openapi.json` và `frontend/src/api/schema.d.ts`.

## Quy tắc bảo mật

- Không commit `.env`, `.env.*` (trừ file `.example`), private keys, database dumps hoặc file upload thật.
- Không dùng S3Mock/Mailpit trên staging/production.
- Staging phải dùng PostgreSQL managed với TLS `verify-full`, CA thật từ provider, secrets manager và image bất biến theo digest.
- Chỉ dùng tệp `CLEAN` trong luồng nộp bài; không bỏ qua file scanner.
