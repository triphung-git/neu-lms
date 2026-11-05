# Bản cập nhật hoàn thiện NEU LMS — 04/11/2026

## Chức năng đã bổ sung trong mã nguồn

- Chat AI lưu tối đa 50 câu hỏi/câu trả lời theo user + học phần; tải lại trang vẫn đọc được lịch sử từ backend. Lịch sử chỉ riêng chủ tài khoản truy cập; có xác nhận xóa. Xóa trong lúc một yêu cầu đang chạy không khôi phục lịch sử cũ.
- POST chat nhận request_id. Gửi lại cùng mã/câu hỏi trả bản đã lưu, khác câu hỏi bị 409. Hai yêu cầu đồng thời vẫn có thể gọi provider hai lần nhưng chỉ lưu một kết quả.
- Chặn chatbot/lịch sử sinh viên khi preview_allowed=false hoặc mất membership. Quyền được kiểm tra lại sau khi provider trả lời.
- Không trả lời khẳng định nếu thiếu mã [Sx], dùng mã nguồn không có trong retrieval hoặc provider trả NO_SUPPORT. Kiểm tra mã không chứng minh nội dung có quan hệ suy ra với nguồn; phải nghiệm thu chất lượng RAG bằng dữ liệu thật.
- Lưu version_id, file_id, checksum cùng citation; lịch sử có nguồn không còn công bố, bị ẩn, thay phiên bản hoặc không CLEAN sẽ bị bỏ khỏi kết quả đọc. Nguồn cũng được kiểm tra lại trước khi trả câu trả lời mới.
- Nút mở học liệu và xem đúng trang PDF được trích dẫn. Kiểm tra phiên bản công bố trước khi mở; preview API tiếp tục thực thi phân quyền.
- Worker embeddings tự đối soát mỗi 60 giây, phát hiện đổi nguồn/tên/model/dimensions, tránh gọi lại provider khi đã hoàn tất; retry tăng dần tối đa một giờ. Tối đa 5 extraction mỗi lượt. Đây vẫn là truy xuất vector JSON giới hạn ứng viên, chưa phải hạ tầng vector database cho dữ liệu lớn.
- Worker email môn học/điểm có hàng đợi DB, chống enqueue trùng, tối đa 5 lần thử, kiểm tra lại quyền trước gửi; SMTP là at-least-once, có thể gửi trùng nếu worker chết sau khi SMTP nhận thư. Email chỉ chứa thông báo chung và link đăng nhập, không chứa điểm/nội dung thông báo.
- Admin hiển thị cờ bật/tắt và số job embeddings/email chờ/lỗi. Có lệnh retry một job thất bại.
- Dashboard giảng viên hiển thị số bản nháp AI pending của môn đang mở và số bài tập công bố, chưa đóng thủ công, có hạn nộp gốc trong 7 ngày.
- Có CSS responsive, focus bàn phím, trạng thái tải/lỗi, thử lại, xóa có xác nhận cho chat; bảng trạng thái job admin.
- Chặn duyệt tóm tắt AI khi môn đã lưu trữ, học liệu bị ẩn, phiên bản cũ hoặc tệp nguồn không còn sạch.
- Tách queue files, ai, notifications và bổ sung worker trong Compose local/staging.

## Cập nhật Windows

1. Giữ bản sao hoặc commit phần đang làm. Áp dụng gói cập nhật bằng script đi kèm. Script kiểm tra hash bản ZIP gốc, không ghi đè nếu file đã thay đổi sau lần gửi ZIP. `.env`, `.git`, dữ liệu tệp và database không nằm trong gói.
2. Tại thư mục gốc dự án, kiểm tra `.env` tồn tại. Bổ sung các biến bên dưới, không sao chép đè `.env` hiện có.
3. Khởi động PostgreSQL/Redis rồi migrate trước khi chạy worker mới.

```powershell
docker compose up -d postgres redis
Set-Location backend
uv sync --frozen --group dev
uv run --env-file ../.env python manage.py check
uv run --env-file ../.env python manage.py migrate
Set-Location ..
docker compose --profile files up -d --build api file-worker ai-worker notification-worker file-scheduler
Set-Location frontend
npm ci
npm run api:check
npm run typecheck
npm test -- --run
npm run build
npm run dev
```

Migrations mới: `ai_assistant.0004_chatconversation_chatturn_embeddingindexstate_and_more` và `platform_core.0002_notificationemaildelivery`. Không cần tự tạo migration cho các model này.

## Cấu hình nền

```dotenv
AI_AUTO_INDEX_ENABLED=true
NOTIFICATION_EMAIL_ENABLED=false
NOTIFICATION_EMAIL_START_AT=
```

AI cần key/model hợp lệ từ cấu hình hiện có. Khi thử email trên Mailpit local, đặt `NOTIFICATION_EMAIL_ENABLED=true` và mốc ISO có múi giờ, ví dụ `2026-11-04T16:00:00+07:00`; thay bằng thời điểm bạn muốn bắt đầu gửi. Chỉ thông báo công bố từ mốc này được enqueue. Restart API và workers sau thay đổi env. Không bật email trên SMTP thật trước khi xác nhận người nhận và chính sách gửi của dự án.

Local Compose đã trỏ notification worker tới Mailpit. Staging dùng EMAIL_HOST/PORT/TLS và PUBLIC_APP_ORIGIN từ env staging. Chạy một beat instance cho mỗi môi trường. Worker AI/email không thay thế file-worker hay auth-dispatcher.

Chẩn đoán:

```powershell
docker compose logs --tail=100 ai-worker notification-worker file-scheduler
# Sau khi khắc phục nhà cung cấp/cấu hình, thay 123 bằng ID job bị lỗi:
docker compose exec api python manage.py retry_background_job email 123
docker compose exec api python manage.py retry_background_job index 123
```

Không reset hàng loạt các email đã gửi. Lệnh chỉ reset đúng một job ở trạng thái failed; scheduler thực hiện lại theo quyền hiện tại.

## Kiểm tra trước merge

Từ root trên Windows, chạy `powershell -File scripts/verify-release.ps1`. Script dùng đường dẫn tuyệt đối tới root .env và dừng ngay khi lệnh lỗi. PostgreSQL test phải cho phép tạo test database, tách khỏi dữ liệu thật. Script không tự chạy migrate production hay triển khai.

### Bằng chứng đã chạy trong đợt này

- Frontend: 282/282 tests qua; TypeScript qua; production build qua.
- Backend: 68 tests chọn lọc qua, gồm 16 regression workflows mới và các test AI serializer/history/retrieval/hybrid/evaluation/summary. DB regression chạy SQLite với schema test dựng từ model; không thay thế PostgreSQL integration/concurrency/migration suite.
- Django system check, migration drift check, Ruff check/format và OpenAPI validation được chạy riêng.
- Frontend lint không có lỗi chặn nhưng còn cảnh báo React ở code hiện hữu. Build còn cảnh báo chunk lớn; không coi các cảnh báo này là đã xử lý hết.
- Một fixture test summary cũ đã được sửa để finalized_at khớp lifecycle_status; không bỏ hay nới ràng buộc model.
- Kiểm tra trình duyệt trực quan chưa chạy được vì không tải được Chromium; không coi CSS đã nghiệm thu đa thiết bị.
- Chưa chạy PostgreSQL 17 full suite, Docker Compose thật, SMTP/S3/ClamAV/provider AI thật, browser UAT đa thiết bị, load test hay staging deploy. Không gắn nhãn 100% nghiệm thu.

## UAT bắt buộc

| Luồng | Kết quả mong đợi |
|---|---|
| Chat hỏi câu có nguồn, F5 | Câu hỏi, câu trả lời và nguồn còn trong lịch sử |
| Đăng nhập tài khoản khác | Không đọc được lịch sử của người trước |
| Hủy membership/tắt preview | Chat và lịch sử trả 403 |
| Ẩn học liệu/thay phiên bản/tệp không CLEAN | Không đọc lại citation cũ; không trả nguồn cũ cho câu trả lời mới |
| Hỏi ngoài học liệu | Từ chối rõ ràng; không kèm citation giả |
| Bấm xem trang nguồn >20 | PDF bắt đầu từ trang nguồn, không chỉ 20 trang đầu |
| Xóa lịch sử | Chỉ xóa hội thoại user hiện tại trong môn; F5 không hiện lại |
| Công bố học liệu mới | Worker tự index; admin đổi số job ready/failed đúng |
| Provider embeddings gián đoạn | Job retry, tìm kiếm từ khóa vẫn có fallback |
| Công bố điểm/thông báo | Mailpit có một thư đúng người, link yêu cầu đăng nhập |
| Sinh viên rút môn trước gửi | Job bị skipped, không gửi thư |
| SMTP lỗi | Job backoff và failed sau 5 lần; retry thủ công sau khắc phục |
| Luồng bài nộp | Upload → CLEAN → nộp → F5 → chấm nháp → công bố → điểm/thông báo |
| Mobile 360/768px, desktop | Chat không tràn ngang, nút không bị che, dialog cuộn được, focus bàn phím rõ |

## Sao lưu, phục hồi và vận hành

- Trước migrate staging, tạo snapshot PostgreSQL và bucket S3/versioning. Hai phần cần cùng mốc hợp lý để giữ quan hệ file/database.
- PostgreSQL: dùng `pg_dump --format=custom --file=backup.dump` với PGHOST/PGUSER/PGDATABASE và cơ chế secret của môi trường; không đặt password trong dòng lệnh. Khôi phục vào database thử nghiệm bằng `pg_restore --dbname=<database_thu_nghiem> backup.dump`, chạy migration/check và thử tải tệp mẫu trước khi chốt backup thành công.
- Giữ bucket versioning hoặc backup ngoài vùng lưu trữ chính; thử phục hồi tệp và kiểm tra checksum. Không chỉ sao lưu DB.
- Theo dõi HTTP 5xx/latency, tuổi job pending, số job failed, tỷ lệ AI abstention, quota/cost provider, dung lượng DB/bucket. Tên job và lỗi có log nhưng cần nối log/metrics vào hệ thống giám sát thực tế.
- Rollback app dùng image digest trước đó. Không tự reverse migration chứa lịch sử/email ledger khi đã có dữ liệu mới; ưu tiên fix-forward hoặc phục hồi snapshot đã diễn tập.
- TLS, domain, registry, credentials và môi trường production phải do nhóm triển khai cấp; đợt sửa code này chưa thực hiện deploy.
