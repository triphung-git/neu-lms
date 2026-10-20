# Hợp đồng API
Chưa có server/OpenAPI triển khai. Không có URL, HTTP verb, DTO hoặc session production đã chốt. Context/mock không phải API thật.

Hợp đồng mới cần actor/quyền, input/output, validation, mã lỗi, phân trang, transaction, audit và cách xử lý yêu cầu lặp. Bao phủ tài khoản/email/vai trò; môn/ghi danh; file; bài tập/nộp/điểm; thi/câu hỏi; báo cáo; AI/email; SCORM/xAPI/LTI.

Server kiểm quyền cả đọc và ghi, danh tính lấy từ phiên, deadline kiểm tại lúc commit. Không chứa database credentials ở frontend. Thêm tài liệu API và contract test cùng PR triển khai.

