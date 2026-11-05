# Áp dụng bản cập nhật NEU LMS

Bản ZIP cập nhật này chỉ chứa source code, tài liệu và cấu hình mẫu. Nó **không chứa** `.git`, các file `.env` thực tế, thư mục dependency, database hoặc file upload để tránh ghi đè dữ liệu cục bộ.

## Cập nhật an toàn trên Windows

1. Đóng tiến trình dev server đang chạy.
2. Sao lưu thư mục `neu-lms` hiện tại trước khi cập nhật.
3. Giải nén ZIP vào **thư mục cha** đang chứa `neu-lms`, rồi gộp/ghi đè các file source cùng tên vào thư mục dự án hiện có. Không xóa thư mục cũ.
4. Kiểm tra `.env` ở root và `backend/.env` (nếu bạn tự chạy backend native) vẫn còn. ZIP không chứa file `.env` thực tế nên không ghi đè chúng.
5. Trong `frontend`, chạy `npm ci`. Trong `backend`, dùng Python 3.13 và chạy `uv sync --frozen --group dev`.
6. Khởi động dịch vụ local bằng `docker compose --profile files up -d --build`, sau đó chạy `docker compose run --rm api python manage.py migrate`.
7. Chạy các bước kiểm thử ở `docs/DEVELOPMENT.md` trước khi dùng hoặc triển khai.

## Cấu hình AI

B14 dùng cùng một Google/Gemini API key cho Gemini Embeddings và endpoint chat tương thích OpenAI. Nếu `.env` hiện tại đang trỏ `AI_API_BASE_URL` tới `https://api.openai.com/v1`, hãy đổi riêng giá trị đó sang `https://generativelanguage.googleapis.com/v1beta/openai` khi dùng Gemini. Không thay thế hoặc xóa các giá trị `.env` khác nếu chưa kiểm tra.

## Giới hạn kiểm chứng của bản này

Mã Python đã qua kiểm tra cú pháp tĩnh; JSON OpenAPI/package và các file YAML đã được parse. Bộ kiểm thử đầy đủ frontend/backend chưa chạy được trong môi trường tạo ZIP do không tải được dependencies từ registry và không có Docker/PostgreSQL. Xem `docs/PROJECT_STATUS.md` để biết chi tiết các bước cần chạy lại.
