# Hướng dẫn Vận hành và Triển khai Staging — NEU LMS

Tài liệu này hướng dẫn quy trình triển khai mẫu cho môi trường **Staging** của nền tảng NEU LMS, đảm bảo tuân thủ các nguyên tắc kiến trúc và chính sách bảo mật đã được duyệt.

---

## 1. Nguyên tắc triển khai Staging

1. **Immutable Container Artifact**:
   - Container image được build và gắn tag với commit SHA cụ thể từ CI (ví dụ `ghcr.io/neu-lms/api:staging-<commit_sha>`).
   - Tuyệt đối không build image trực tiếp trên server staging hoặc dùng tag mutable `latest`.
2. **Quản lý biến môi trường và bí mật độc lập**:
   - Mọi thông tin nhạy cảm (`DJANGO_SECRET_KEY`, `PGPASSWORD`, Redis token) được nạp qua file `.env.staging` (hoặc secret manager của hạ tầng: AWS Secrets Manager / Vault).
   - Tuyệt đối không commit file `.env.staging` vào version control. Sử dụng file mẫu `.env.staging.example`.
3. **Cơ chế Migration có kiểm soát (Controlled Migration)**:
   - Trong môi trường staging có nhiều container API (multi-replicas), **không để các API container tự ý chạy migrate khi khởi động**.
   - Service `migrator` được cấu hình dạng one-off job chạy hoàn tất trước khi service `api` được khởi chạy (`condition: service_completed_successfully`).
4. **Không sử dụng dịch vụ Mock nội bộ**:
   - Các dịch vụ giả lập phục vụ dev (`adobe/s3mock`, `axllent/mailpit`) bị nghiêm cấm trên staging.
   - Cơ sở dữ liệu sử dụng PostgreSQL 17 managed với `PGSSLMODE=verify-full` và root certificate (`PGSSLROOTCERT`).
5. **Định tuyến Health Probes**:
   - Liveness probe: `GET /api/v1/health/live` (kiểm tra tiến trình gunicorn/web).
   - Readiness probe: `GET /api/v1/health/ready` (kiểm tra khả năng kết nối cơ sở dữ liệu PostgreSQL).

---

## 2. Quy trình triển khai Staging (Runbook)

### Bước 1: Chuẩn bị cấu hình môi trường
```bash
# Di chuyển vào thư mục staging
cd deploy/staging

# Tạo file cấu hình từ template nếu chưa có
cp .env.staging.example .env.staging

# Điền các thông tin bí mật thực tế của môi trường staging
chmod 600 .env.staging
nano .env.staging
```

### Bước 2: Kéo Container Image từ Container Registry
```bash
# Xác định immutable image được sinh từ Git commit SHA cần deploy
export API_IMAGE="ghcr.io/neu-lms/api@sha256:<digest-thuc-te>"

# Đăng nhập registry và pull image
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_ACTOR --password-stdin
docker pull $API_IMAGE
```

### Bước 3: Kiểm tra cấu hình và chạy Migration độc lập
```bash
# Chạy migration job riêng biệt
docker compose -f compose.staging.yaml run --rm migrator

# Xác nhận trạng thái migration
docker compose -f compose.staging.yaml run --rm api python manage.py migrate --check
```

### Bước 4: Khởi động hoặc cập nhật dịch vụ API
```bash
# Khởi động dịch vụ API ở chế độ detached
docker compose -f compose.staging.yaml up -d api

# Kiểm tra trạng thái container và healthcheck
docker compose -f compose.staging.yaml ps
```

### Bước 5: Kiểm tra sức khỏe (Smoke Test)
```bash
# Kiểm tra liveness
curl -I http://127.0.0.1:8000/api/v1/health/live
# Kỳ vọng: HTTP/1.1 200 OK {"status": "ok"}

# Kiểm tra readiness
curl -I http://127.0.0.1:8000/api/v1/health/ready
# Kỳ vọng: HTTP/1.1 200 OK {"status": "ok", "checks": {"database": "ok"}}
```

---

## 3. Kế hoạch Rollback (Khôi phục sự cố)

Trong trường hợp bản phát hành mới gặp lỗi nghiêm trọng sau khi triển khai:

1. **Rollback Container Image**:
   - Xác định commit SHA ổn định liền trước (ví dụ `commit_prev`).
   - Cập nhật biến môi trường: `export API_IMAGE="ghcr.io/neu-lms/api@sha256:<digest-truoc>"`.
2. **Khởi động lại API container với image cũ**:
   ```bash
   docker compose -f compose.staging.yaml up -d --no-deps api
   ```
3. **Lưu ý về Database Rollback**:
   - Tuyệt đối không tự động reverse migrations trên cơ sở dữ liệu chứa dữ liệu thật.
   - Việc rollback migration chỉ thực hiện khi migration đó là backwards-compatible hoặc phải khôi phục từ snapshot/backup mới nhất của managed PostgreSQL trước thời điểm deploy.

---

## 4. Các thành phần chưa triển khai (Planned Components)

Các thành phần sau chưa có trong phiên bản hiện tại và sẽ được bổ sung theo lộ trình:
- **Asynchronous Worker**: Celery worker xử lý outbox và email (B13).
- **File Upload & Scanner**: Dịch vụ quét mã độc và pipeline trích xuất học liệu (B08–B09).
- **Transactional Email Provider**: Cấu hình SendGrid / AWS SES thực tế (B13).

## CA và proxy bắt buộc

Tải CA chính thức từ database provider, đặt ngoài Git và cấu hình PGSSLROOTCERT_FILE bằng đường dẫn host. Không dùng backend/tests/fixtures/test-ca.crt: đây chỉ là CA tự ký cho kiểm thử cấu hình, không chứng minh TLS với database thật. Compose mount CA read-only cho API và migrator, không tự tạo đường dẫn host khi thiếu. Chạy Compose với `--env-file .env.staging` để nạp cả biến interpolation; env_file của service chỉ cấp biến bên trong container.

Proxy phải loại bỏ/ghi đè các header X-Forwarded-Proto và X-Forwarded-Host do client gửi. HTTPS kết thúc tại proxy; API chỉ bind loopback. Health endpoints được miễn redirect HTTP và vẫn kiểm database ở readiness. Bridge network của Compose không tự tạo cloud VPC. Trước staging thật cần kiểm verify-full với CA/hostname provider, không chỉ validate YAML.
