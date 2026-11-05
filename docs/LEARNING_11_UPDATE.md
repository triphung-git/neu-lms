# NEU LMS — bản mở rộng 11 chức năng, bản sửa ngày 05/11/2026

Bản nền: `neu-lms(5).zip` hoặc bản cập nhật 11 chức năng trước đó. Dùng local với Docker và Mailpit. Không cần triển khai Vercel hoặc cấu hình SMTP thật.

## Chức năng và vị trí

| # | Chức năng | Vị trí và hành vi |
|---|---|---|
| 1 | Điểm danh online | Trong trang môn học → Điểm danh, cho cả GV và SV. Đã bỏ tab Điểm danh khỏi Không gian học tập. GV mở phiên, đặt mã và giờ mở/muộn/đóng; SV nhập mã. Chống ghi trùng; GV sửa trạng thái kèm lý do và lịch sử; CSV. |
| 2 | Log tải tài liệu bài tập | GV → Không gian học tập → Log tải tệp; có lối tắt từ danh sách bài tập. Xem người tải, tệp, bài tập, thời điểm, số lượt; lọc và CSV. Phân biệt preview/download. |
| 3 | Thư viện số | Menu Thư viện số của SV/GV/Admin. GV upload, sửa metadata, chọn riêng tư/trong môn/toàn trường, ẩn/xóa mục. SV tìm kiếm, xem PDF và tải tệp được phép. Admin quản lý mục. |
| 4 | Đổi ngôn ngữ | Bộ chọn Việt/Anh ở thanh trên và trang đăng nhập; nhớ lựa chọn khi tải lại. Áp dụng cho chuỗi giao diện của cả màn mới và màn cũ, với danh mục dịch dùng chung. Đổi ngôn ngữ sẽ tải lại trang để cập nhật các nhãn được khởi tạo từ module; hãy lưu biểu mẫu trước khi chuyển. Nội dung học liệu, tên môn và văn bản GV/SV nhập giữ nguyên. |
| 5 | Xóa bản nháp AI | GV → Bản nháp AI → Xóa; có xác nhận. Có thể xóa cả bản đã xác nhận. Học liệu gốc và tóm tắt đã công bố được giữ lại; ghi AuditEvent. Có tab Bản nháp AI ngay trong môn GV phụ trách. |
| 6 | Ghi danh bằng mật khẩu | GV → Không gian học tập → Ghi danh: mở/đóng, đặt/đổi mật khẩu. SV → Ghi danh vào lớp: xem toàn bộ lớp đang mở, tìm theo tên/mã môn/giảng viên, lọc học kỳ và cách ghi danh. Lớp có mật khẩu cho phép tham gia trực tiếp; lớp không có mật khẩu dùng quy trình yêu cầu GV duyệt hiện có. Có phân trang và trạng thái đã tham gia/đang chờ. Mật khẩu lưu dạng hash; giới hạn số lần thử. |
| 7 | Báo cáo admin | Admin → Báo cáo. Chọn khoảng ngày, xem chỉ số, biểu đồ cột hoạt động, biểu đồ đường lượt tải theo ngày, biểu đồ cơ cấu bài nộp cá nhân/nhóm và xuất CSV. Ngày không có lượt tải vẫn xuất hiện với giá trị 0. Chỉ admin truy cập được API. |
| 8 | Tiến độ học tập | Không gian học tập → Tiến độ. SV tự đánh dấu từng bài học; GV xem toàn lớp/CSV. Số bài nộp cá nhân và nhóm tính riêng với hoàn thành bài học. |
| 9 | Thảo luận | Không gian học tập → Thảo luận. Chủ đề theo môn/bài học, trả lời, trả lời tiếp; GV ghim/khóa/ẩn/đánh dấu đã giải quyết, chọn câu trả lời. Có thông báo trong workspace. |
| 10 | Phúc khảo | GV đặt hạn tại tab Phúc khảo; SV gửi yêu cầu cho điểm đã công bố; GV tiếp nhận/giải quyết/giữ hoặc sửa điểm. Giữ lịch sử và kiểm tra phiên bản điểm. Phúc khảo điểm nhóm ở tab Bài tập nhóm. |
| 11 | Bài tập nhóm | GV cấu hình bài tập chưa có bài nộp; GV phân nhóm hoặc SV tự lập/tham gia. Có trưởng nhóm, hạn lập nhóm, giới hạn thành viên. Trưởng nhóm nộp tệp đã quét. GV chấm chung, điều chỉnh điểm cá nhân có lý do, lưu nháp/công bố. SV chỉ thấy điểm đã công bố và điều chỉnh của mình. |

## Quy tắc sử dụng

- Chọn môn trước khi dùng workspace. Môn phải đang mở để thao tác; thành viên đã rút/không thuộc lớp bị từ chối.
- File thư viện dùng kho và hạn mức của môn do GV phụ trách; chưa có kho độc lập ngoài môn. Xóa mục thư viện không xóa tệp vật lý dùng chung.
- Upload dùng luồng intent → content → commit → quét hiện có. Worker và ClamAV phải chạy; file không sạch không được dùng. Quét quá 90 giây báo đang chờ, chưa tự tạo tài liệu/bài nộp thành công.
- Điểm danh bằng mã không xác nhận vị trí vật lý. Chưa điểm danh trong phiên đang mở hiển thị `pending`, hết phiên là vắng. Không dùng theo dõi vị trí hoặc nhận diện khuôn mặt.
- Log ghi yêu cầu tải hợp lệ do server phục vụ, không chứng minh người dùng đọc hoặc tải xong. Không hồi dựng lượt tải trước bản cập nhật. Tối đa 5.000 dòng log mỗi lần xuất, khoảng ngày tối đa 366 ngày.
- Nhóm khóa thành viên khi hết hạn lập nhóm hoặc khi bài tập có bài nộp nhóm đầu tiên. Không đổi bài tập đã có bài nộp cá nhân sang nhóm. Một lần nộp nhóm gồm một tệp; nếu cần nhiều tài liệu, chọn định dạng gộp nằm trong chính sách tệp của môn.
- Bài tập nhóm, điểm nhóm và phúc khảo nhóm được quản lý tại workspace; bảng điểm cá nhân cũ không tự gộp điểm nhóm. Trang bài tập có liên kết sang workspace thay cho nút nộp cá nhân.
- Khi sửa điểm sau phúc khảo cá nhân, lưu phiên bản điểm tổng mới cùng lý do, không giả lập lại điểm từng tiêu chí rubric. Phúc khảo nhóm chỉ sửa điểm cá nhân của người yêu cầu, giữ điểm các thành viên còn lại.
- Thông báo thảo luận/phúc khảo hiện ở tab Thảo luận trong workspace; chưa gộp vào badge thông báo cũ hoặc gửi email riêng.
- Lựa chọn ngôn ngữ không tự dịch tài liệu, nội dung AI hoặc nội dung GV/SV nhập. Một số thông báo API là song ngữ.

## Bản sửa này

Workspace trước đây đọc `results` trong khi API trả `items`, dẫn đến lỗi render. Bản sửa dùng service có kiểu dữ liệu, tải đủ các trang môn và hiển thị trạng thái tải/lỗi/rỗng. Thư viện số cũng đã sửa cách đọc danh sách môn.

## Cài vào bản đang dùng trên Windows

### 1. Ghép source

Giải nén gói cập nhật ra một thư mục riêng, ví dụ `C:\neu-lms-11-update`. Mở PowerShell ở thư mục đó. Sửa `$project` thành đường dẫn thư mục dự án của bạn:

```powershell
$project = 'C:\Users\DELL INSPIRON 5420\OneDrive\Máy tính\neu-lms'
.\apply-update.ps1 -ProjectPath $project
```

Lệnh đầu chỉ kiểm tra. Nếu không có xung đột:

```powershell
.\apply-update.ps1 -ProjectPath $project -Apply
```

Script xác minh SHA-256, sao lưu toàn bộ file sẽ thay, rồi mới ghi. Không chép `.env`, dữ liệu, `.git`, `.venv` hoặc `node_modules`. Nếu báo xung đột, dùng VS Code Compare để ghép file đó; không ghi đè mù lên bản bạn đã sửa thêm. `manifest.json` chỉ phục vụ kiểm tra và danh sách file, không phải cấu hình ứng dụng.

Nếu PowerShell chặn script, có thể mở `payload` rồi chép các thư mục `backend`, `frontend`, `schema`, `docs` vào dự án sau khi tự sao lưu. Cách này không có kiểm tra xung đột tự động.

### 2. Sao lưu database trước migration

Bật Docker Desktop, đợi Engine running. Tại thư mục dự án:

```powershell
Set-Location -LiteralPath $project
docker compose up -d postgres
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/neu-lms-before-11.dump'
docker compose cp postgres:/tmp/neu-lms-before-11.dump .\neu-lms-before-11.dump
```

Kiểm tra file dump đã xuất thành công. Không dùng `docker compose down -v` vì sẽ xóa volume dữ liệu.

### 3. Build backend và migrate

Chạy từng lệnh, dừng nếu một lệnh lỗi:

```powershell
docker compose build api
docker compose run --rm api python manage.py check
docker compose run --rm api python manage.py migrate
docker compose --profile files up -d --build api file-worker ai-worker notification-worker file-scheduler auth-dispatcher mailpit
docker compose exec api python manage.py showmigrations learning
docker compose logs --tail=80 api
```

Hai migration `learning.0001_initial` và `learning.0002_groupgradeappeal` phải có `[X]`. Dockerfile đã được thêm `COPY learning`; phải build lại, chỉ restart container cũ là chưa đủ.

### 4. Frontend

Trong terminal mới:

```powershell
Set-Location -LiteralPath (Join-Path $project 'frontend')
npm ci
npm run typecheck
npm run api:check
npm test
npm run build
npm run dev
```

Nếu Vite đang chạy thì dừng bằng Ctrl+C trước khi chạy lại. Không cần chỉnh SMTP hoặc mật khẩu `.env`.

### 5. Kiểm thử backend trên PostgreSQL của bạn

Runtime Docker không cài pytest; chạy từ môi trường uv local đang dùng, với `.env` có PGHOST/PGPORT trỏ đúng cổng PostgreSQL Docker (mặc định host `127.0.0.1`, port `55432`; giữ cấu hình thực tế của bạn).

```powershell
Set-Location -LiteralPath (Join-Path $project 'backend')
uv sync --frozen
uv run --env-file ../.env python -m pytest --ds=config.settings.test tests/test_learning_workflows.py tests/test_file_api.py tests/test_rubric_grading.py tests/test_ai_summary_drafts.py -v --tb=short
```

## Kịch bản nghiệm thu bằng trình duyệt

Dùng 1 GV, 2 SV cùng lớp và 1 SV ngoài lớp; dùng cửa sổ riêng tư để tách phiên.

1. GV mở ghi danh và đặt mật khẩu; SV nhập sai bị từ chối, nhập đúng tham gia. Gửi lại không tạo hai membership. Đóng ghi danh rồi thử lại phải thất bại.
2. GV mở phiên điểm danh; SV điểm danh hai lần chỉ có một bản ghi; thử mã sai, ngoài giờ, ngoài lớp. Sửa vắng/muộn phải có lý do và thấy lịch sử.
3. GV tải tài liệu lên thư viện, đợi sạch. Thử ba phạm vi chia sẻ và ẩn mục. SV không được sửa/xóa; xóa mục không phá file gốc của học liệu.
4. SV tải cùng tệp đề bài hai lần và preview một lần. GV thấy hai lượt tải + một preview với đúng thời điểm; lọc theo SV và xuất CSV.
5. SV đánh dấu bài học, F5 vẫn giữ tiến độ. GV thấy phần trăm và số bài nộp riêng.
6. SV tạo thảo luận, GV trả lời/ghim/khóa. SV không gửi thêm vào chủ đề khóa, không xem chủ đề ẩn.
7. GV đặt hạn phúc khảo; SV gửi cho điểm đã công bố. GV sửa điểm và kiểm tra phiên bản cũ vẫn còn. Hai màn chấm cùng phiên bản: thao tác lỗi thời phải yêu cầu tải lại.
8. GV tạo chính sách nhóm; lập nhóm/phân nhóm, thử giới hạn thành viên và chuyển trưởng nhóm. Chỉ trưởng nhóm nộp; sau bài nộp đầu không sửa roster. Điểm nháp không lộ cho SV; điểm cá nhân không lộ cho bạn khác. Thử phúc khảo điểm cá nhân nhóm.
9. GV xóa bản nháp pending và confirmed trong môn phụ trách; kiểm tra học liệu gốc và tóm tắt đã công bố còn nguyên. GV khác và SV không được xóa.
10. Admin xem báo cáo/ngày/CSV; SV gọi URL báo cáo bị từ chối. Kiểm tra bộ chọn Việt/Anh và F5.
11. Kiểm tra các màn mới trên cửa sổ hẹp; bảng có cuộn ngang, form và menu không đè nhau.

## Kết quả kiểm tra trong môi trường thực hiện

- Backend learning, rubric và AI: **34 passed** trên SQLite tạm. Bao gồm bộ lọc ghi danh và bảo toàn tóm tắt đã công bố khi xóa bản nháp.
- Frontend: **294 passed / 36 test files**, gồm hồi quy workspace đọc đúng `items`, điểm danh trong môn, biểu đồ và bản dịch.
- `manage.py check`: không lỗi; `makemigrations --check --dry-run`: không thiếu migration.
- OpenAPI validate + fail-on-warn: qua; `api:check`, TypeScript, production build: qua.
- Một test UI cũ được sửa chờ nút cấp vai trò sẵn sàng trước khi bấm, loại bỏ race khi tải quyền.
- Build còn cảnh báo bundle >500 kB. Không phải lỗi compile.
- Chưa kiểm chứng migration, advisory locks và chạy đồng thời trên PostgreSQL/Docker thật trong môi trường này. Bộ test file API cũ phụ thuộc `pg_advisory_xact_lock` không chạy được trên SQLite; cần chạy lệnh PostgreSQL ở trên. Chưa kiểm thử tương tác trình duyệt thực với ClamAV/S3/Mailpit của bạn.

Không coi gói này là xác nhận toàn dự án đã hoàn tất 100%; đây là phần mở rộng có code, migration, CSS và kiểm thử, cần nghiệm thu trên môi trường local của bạn.

Không có migration mới riêng cho bản sửa này. Nếu chưa áp dụng bản 11 chức năng trước đó, vẫn cần chạy hai migration learning như hướng dẫn. Installer chấp nhận cả bản nguồn gốc và bản cập nhật trước, sao lưu file đang tồn tại và dừng nếu gặp thay đổi riêng của bạn.

## Điều chỉnh theo yêu cầu mới

- Không gian học tập mở mặc định tab Tiến độ. Tab Điểm danh đã được bỏ, các liên kết cũ tới tab này chuyển về Tiến độ.
- Điểm danh nằm trong môn học. Mỗi phiên là một buổi, một sinh viên chỉ có một bản ghi trong phiên. Tổng đã tham dự = có mặt + đi muộn. Cột tổng buổi có tên chỉ tính các phiên có bản ghi của sinh viên, không quy vắng cho những phiên trước khi sinh viên tham gia. Cột chưa kết thúc tách khỏi vắng.
- Lịch sử được lưu trong cơ sở dữ liệu, không mất sau F5, đóng phiên hay lưu trữ môn. GV xem toàn lớp, SV chỉ xem của mình. Tổng kết bao gồm toàn bộ lịch sử, không còn giới hạn 100 phiên; có CSV tổng kết và CSV chi tiết.
- Nút xóa bản nháp có biểu tượng, màu đỏ, trạng thái đang xóa, hộp xác nhận và thông báo lỗi. Nội dung công bố giữ nguyên.
- Menu của cả ba vai trò đặt trang chính ở hàng đầu.
- Báo cáo chỉ còn bộ lọc ngày, xuất CSV và ba biểu đồ. Đã bỏ thẻ KPI và bảng số liệu lặp lại.
- Không có migration mới. Cần rebuild API và khởi động lại frontend để nhận thay đổi.
- Kiểm thử mới xác nhận 102 phiên vẫn được cộng đủ sau khi lưu trữ môn và dữ liệu từng sinh viên được phân quyền. Kiểm thử nút xóa bao gồm thành công và API báo lỗi.
