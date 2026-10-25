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

### Bước 4: Khởi động hoặc cập nhật dịch vụ API và Dispatcher Worker
```bash
# Khởi động dịch vụ API và Auth Email Dispatcher ở chế độ detached
docker compose -f compose.staging.yaml up -d api auth-dispatcher

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

# Kiểm tra log của auth-dispatcher
docker compose -f compose.staging.yaml logs --tail=50 auth-dispatcher
```

---

## 3. Vận hành Auth Email Dispatcher và Maintenance Scheduler

### 3.1. Cơ chế Dispatcher ngoài HTTP Request (Out-of-Request Email)
- Toàn bộ HTTP request (`/api/v1/auth/password/request-reset` và email verification) **không gọi SMTP trực tiếp**. HTTP chỉ commit token và delivery record ở trạng thái `pending` rồi trả về `202 Accepted` ngay lập tức.
- Service `auth-dispatcher` chạy tiến trình daemon:
  `python manage.py dispatch_auth_emails --daemon --poll-interval 2`
  liên tục quét các bản ghi `pending` hoặc `processing` bị treo (> 5 phút) để gửi email ngoài luồng HTTP.
- Concurrency & Exactly-once:
  - Khóa hàng bằng `SELECT FOR UPDATE` bên trong transaction ngắn hạn chuyển trạng thái sang `processing`.
  - Gọi SMTP `send_mail` hoàn toàn nằm **ngoài** database transaction.
  - SMTP là at-least-once (không cam kết exactly-once SMTP ở tầng mạng). Nếu worker crash sau khi SMTP chấp nhận gửi nhưng trước khi DB commit, cơ chế stale recovery (> 5 phút) sẽ thử lại tối đa `max_attempts` (mặc định 3).

### 3.2. Monitoring & State Machine
Bảng `PasswordResetDelivery` và `EmailVerificationDelivery` có 4 trạng thái:
- `pending`: Đã được HTTP commit, đang đợi dispatcher gửi.
- `processing`: Worker đang thực hiện gửi qua SMTP. Nếu kéo dài quá 5 phút, worker khác sẽ tự động thu hồi (stale recovery).
- `sent`: Gửi thành công, có `sent_at` ghi nhận thời điểm.
- `failed`: Thất bại vĩnh viễn (đã thử đủ 3 lần mà SMTP vẫn lỗi, hoặc token hết hạn, user bị thu hồi phiên `auth_version`, hoặc digest mismatch).

Chỉ số giám sát cần thiết cho OPS:
- Đếm bản ghi `status='failed'` trong 1 giờ qua: nếu > 0, kiểm tra `last_error_code` và log kết nối SMTP provider.
- Đếm bản ghi `status='processing'` có `last_attempt_at < NOW() - 5 phút`: cảnh báo worker crash hoặc deadlock mạng.

### 3.3. Tác động của xoay vòng khóa bí mật (SECRET_KEY Rotation)
- Token reset mật khẩu và verify email được sinh bằng HMAC-SHA256 phụ thuộc vào `SECRET_KEY`.
- Khi xoay vòng `SECRET_KEY`, các delivery chưa gửi hoặc token đã gửi nhưng chưa được người dùng click sẽ không khớp digest (`token_derivation_mismatch`). Dispatcher sẽ chuyển chúng sang `failed`. Người dùng cần bấm yêu cầu gửi lại liên kết mới.

### 3.4. Phòng chống tấn công Timing Enumeration
- Việc trả về response body giống nhau giữa tài khoản tồn tại và không tồn tại **không đủ** để chống suy đoán tài khoản nếu việc gửi email được thực hiện đồng bộ trong request (do network latency SMTP ~200-800ms sẽ để lộ tài khoản thật).
- Bằng cách loại bỏ SMTP khỏi HTTP request và chỉ thực hiện câu lệnh DB transaction nhanh, thời gian phản hồi giữa tài khoản đã biết và chưa biết đồng nhất ở mức mili-giây.

### 3.5. Tác vụ định kỳ (Cron / Systemd Timer)
Cấu hình cron job chạy mỗi ngày (hoặc mỗi giờ) trên staging server để dọn dẹp các token/rate-limit buckets đã hết hạn:
```bash
0 2 * * * docker compose -f /path/to/deploy/staging/compose.staging.yaml exec -T api python manage.py cleanup_expired_auth
```

---

## 4. Kế hoạch Rollback (Khôi phục sự cố)


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

## 5. Các thành phần chưa triển khai (Planned Components)

Các thành phần sau tiếp tục được hoàn thiện theo lộ trình:
- **Asynchronous Worker**: Đã có `auth-dispatcher` daemon phục vụ email xác thực và đặt lại mật khẩu (T02). Celery/Redis worker cho outbox sự kiện nền tảng sẽ bổ sung ở B13.
- **File Upload & Scanner**: Dịch vụ quét mã độc và pipeline trích xuất học liệu (B08–B09).
- **Transactional Email Provider**: Cấu hình SendGrid / AWS SES thực tế (B13).

## CA và proxy bắt buộc

Tải CA chính thức từ database provider, đặt ngoài Git và cấu hình PGSSLROOTCERT_FILE bằng đường dẫn host. Không dùng backend/tests/fixtures/test-ca.crt: đây chỉ là CA tự ký cho kiểm thử cấu hình, không chứng minh TLS với database thật. Compose mount CA read-only cho API và migrator, không tự tạo đường dẫn host khi thiếu. Chạy Compose với `--env-file .env.staging` để nạp cả biến interpolation; env_file của service chỉ cấp biến bên trong container.

Proxy phải loại bỏ/ghi đè các header X-Forwarded-Proto và X-Forwarded-Host do client gửi. HTTPS kết thúc tại proxy; API chỉ bind loopback. Health endpoints được miễn redirect HTTP và vẫn kiểm database ở readiness. Bridge network của Compose không tự tạo cloud VPC. Trước staging thật cần kiểm verify-full với CA/hostname provider, không chỉ validate YAML.
