# Phạm vi sản phẩm
Yêu cầu cập nhật ngày 20/10/2026. Đây là mục tiêu đã duyệt; xem [trạng thái triển khai](../development/STATUS.md).

## Tài khoản
Trang chủ, tính năng, hướng dẫn, đăng nhập/đăng ký, hồ sơ và 404.
Email sinh viên khớp `^1124[0-9]{4}@st\.neu\.edu\.vn$`, cần xác minh quyền sở hữu. Giảng viên dùng email bất kỳ, xác minh và chờ quản trị duyệt.
Một tài khoản nhiều vai trò; người dùng chọn vai trò yêu cầu, chỉ dùng quyền được cấp. Vai trò quản trị cấp nội bộ. Liên kết email sinh viên đã xác minh vào tài khoản; một email không thuộc nhiều tài khoản.
Đổi mật khẩu, quên mật khẩu và quản trị khởi tạo đặt lại; liên kết có thời hạn và dùng một lần.

## Môn học và ghi danh
Giảng viên tạo môn, quản lý chương/bài, sắp xếp và xóa có điều kiện; quản lý thành viên, lưu trữ môn. Giảng viên bật nhận ghi danh, sinh viên tìm môn được mở, gửi/hủy yêu cầu, giảng viên duyệt/từ chối. Chờ duyệt chưa có quyền nội dung.
Rút/thêm lại giữ bài nộp, điểm và lịch sử. Mô hình kế thừa: một môn/lớp học phần do một giảng viên phụ trách. Lưu trữ chỉ đọc, chưa có khôi phục.

## Học liệu và AI
Upload nhiều file, metadata/thẻ, phiên bản, nháp/công bố/ẩn. Quét an toàn, trích xuất, lập chỉ mục; retry bước lỗi. Xem trước định dạng hỗ trợ và tải đúng quyền. Tìm theo từ khóa/môn/loại/thẻ; xem phiên bản công bố và tóm tắt đã xác nhận.
Sinh viên hỏi AI theo học liệu được phép, câu trả lời có nguồn phiên bản/trang hoặc đoạn. Giảng viên tạo/sửa/xác nhận tóm tắt và bản nháp bài tập; không tự công bố. Quota/tắt/lỗi không chặn học thông thường. Chưa có lịch sử hội thoại dài hạn hay AI tự chấm.

## Bài tập và điểm
Soạn, xem trước, lưu nháp, công bố với đề/file/hạn/allowLate/rubric. Sau công bố chỉ sửa hạn và cho nộp muộn theo quy tắc kế thừa.
Một submission mỗi sinh viên/bài tập; một file mỗi revision. Thay trước hạn; sau hạn chỉ nộp lần đầu nếu được phép; đóng thủ công/lưu trữ chặn nộp. Upload lỗi không thay bản cũ; không tự trừ điểm muộn.
Chấm rubric/nhận xét, lưu nháp, công bố đơn/hàng loạt hợp lệ. Điểm gắn revision; sửa điểm giữ lịch sử và bản công bố cũ tới khi công bố mới. Sinh viên chỉ thấy điểm của mình đã công bố. Chưa có tổng điểm môn/GPA/xếp hạng.

## Trắc nghiệm và ngân hàng câu hỏi
Tạo/sửa/phân loại/tìm/tái sử dụng câu hỏi: một đáp án, nhiều đáp án, đúng/sai, trả lời ngắn. Chọn cố định hoặc ngẫu nhiên theo chủ đề/độ khó. Cấu hình điểm và cách chấm nhiều đáp án.
Giờ mở/đóng, thời lượng, số lượt, cách chọn kết quả; đảo câu/đáp án; cho/chặn quay lại câu. Tự lưu, tự nộp, cấu hình công bố điểm/đáp án/giải thích. Cách đối sánh câu trả lời ngắn cần chi tiết hóa.

## Thông báo, báo cáo và tích hợp
Thông báo theo môn, đã/chưa đọc; chọn gửi email khi công bố học liệu/bài tập/điểm/thông báo; mặc định không gửi; retry chỉ người nhận lỗi.
Xuất XLSX/CSV thành viên, ghi danh, bài nộp, điểm bài tập, kết quả thi, tiến trình học. Chọn bộ lọc/cột/thứ tự, lưu cấu hình; đúng quyền và phân biệt nháp/công bố.
SCORM nhập gói/mở học/tiến trình/kết quả. xAPI ghi sự kiện và LRS. LTI kết nối công cụ ngoài và quản lý dữ liệu chia sẻ.

## Quản trị
Tổng quan, danh sách email/tài khoản, duyệt giảng viên, quản lý vai trò, khóa/mở khóa. Danh mục môn, chuyển giảng viên, lưu trữ. Theo giới hạn kế thừa, không biên soạn môn/chấm điểm hoặc đọc file học liệu/bài nộp; xem điểm công bố.
Nhật ký chỉ đọc không chứa dữ liệu nhạy cảm. Cấu hình file, AI/quota, email.
Danh sách email cấp trước của demo cần điều chỉnh theo đăng ký bằng domain và duyệt giảng viên mới.

## Chi tiết còn mở
Không suy ra lựa chọn từ danh sách nhiều phương án: xử lý điểm khi thay bài đã chấm; mở lại nhận bài; giới hạn file/OCR; phiên bản và mức hỗ trợ SCORM/xAPI/LTI; nhà cung cấp/ngân sách AI/email; thời gian giữ dữ liệu; điểm thi vào điểm môn; lịch phát hành; tên NPC/NEU LMS. Chức năng bổ sung đã duyệt nhưng các thông số này chưa chốt.

