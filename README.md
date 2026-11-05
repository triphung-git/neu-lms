# NEU LMS

Nền tảng quản lý học tập gồm frontend React/TypeScript, backend Django REST Framework, PostgreSQL, Redis, lưu trữ tệp S3-compatible và trợ lý học tập RAG.

## Bắt đầu nhanh trên Windows / macOS / Linux

### 1. Chuẩn bị biến môi trường

Từ thư mục gốc dự án:

```powershell
cp .env.example .env
```

Thay các giá trị mẫu trong `.env` trước khi dùng chung hoặc triển khai. Cấu hình `AI_API_KEY`, `AI_API_BASE_URL` và `AI_CHAT_MODEL` nếu muốn bật B14. Không commit `.env`.

Nếu gặp lỗi `No environment file found at: ../.env`, hãy kiểm tra file `.env` ở **thư mục gốc repository** (cùng cấp với `compose.yaml`), không phải trong `frontend`. Trong PowerShell, chạy từ thư mục gốc:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Test-Path .env
```

Nếu terminal đang ở `backend`, kiểm tra đường dẫn tương ứng bằng `Test-Path ..\.env`. Các lệnh trên không ghi đè `.env` đang có.

### 2. Khởi động backend và dịch vụ local

Cần Docker Engine và Docker Compose v2:

```powershell
docker compose --profile files up -d --build
docker compose run --rm api python manage.py migrate
```

`--profile files` bật ClamAV, file worker và scheduler cho luồng quét/ trích xuất. Các dịch vụ S3 và Mailpit trong Compose chỉ dành cho local development, không dùng trên production.

Backend mặc định ở `http://localhost:8000`. Health checks:

- `/api/v1/health/live`
- `/api/v1/health/ready`

### 3. Khởi động frontend

Mở terminal thứ hai:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Mở URL Vite in ra (mặc định `http://localhost:5173`). Vite proxy `/api` về backend ở `http://127.0.0.1:8000`.

### 4. Tạo tài khoản quản trị

Tham khảo `python manage.py bootstrap_lms_admin --help` trong container để xem các tham số bắt buộc. Không dùng tài khoản hoặc mật khẩu mẫu trong môi trường chia sẻ.

## Kiểm tra chất lượng

Frontend (tại `frontend`):

```powershell
npm run api:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

Backend (tại `backend`, sau `uv sync --frozen --group dev`):

```powershell
uv run ruff check .
uv run ruff format --check .
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest -q
```

Test integration backend dùng PostgreSQL 17; không dùng `config.settings.sqlite` để thay cho toàn bộ test suite vì một số migration và truy vấn dùng PostgreSQL full-text search (`to_tsvector`, `unaccent`). CI workflow `.github/workflows/ci.yml` cung cấp PostgreSQL và Redis riêng cho test.

## Tài liệu trong repository

- [Danh mục tài liệu](docs/README.md)
- [Trạng thái và tiêu chí hoàn tất](docs/PROJECT_STATUS.md)
- [Hướng dẫn phát triển](docs/DEVELOPMENT.md)
- [OpenAPI schema](schema/openapi.json)
- [Runbook staging](deploy/staging/README.md)

Phạm vi sản phẩm đã duyệt (`SCOPE.md`) không có trong archive này. Vì vậy tiến độ theo milestone trong `PROJECT_STATUS.md` là đánh giá kỹ thuật theo mã nguồn, chưa phải nghiệm thu đối chiếu yêu cầu.
 