class AssignmentDomainError(Exception):
    """Lớp ngoại lệ cơ sở cho phân hệ Bài tập."""

    def __init__(self, message: str, code: str = "ASSIGNMENT_ERROR"):
        super().__init__(message)
        self.message = message
        self.code = code


class AssignmentImmutableError(AssignmentDomainError):
    """Ném ra khi có thao tác cố tình sửa đổi đề bài hoặc rubric đã công bố."""

    def __init__(
        self,
        message: str = (
            "Nội dung đề bài và tiêu chí đánh giá (rubric) đã đóng băng sau khi công bố. "
            "Chỉ được phép điều chỉnh hạn nộp, chính sách tệp nộp hoặc cấu hình chấm điểm."
        ),
    ):
        super().__init__(message, code="IMMUTABLE_AFTER_PUBLISH")


class AssignmentValidationError(AssignmentDomainError):
    """Lỗi dữ liệu đầu vào hoặc quy tắc nghiệp vụ không hợp lệ."""

    def __init__(self, message: str, field_errors: dict | None = None):
        super().__init__(message, code="VALIDATION_ERROR")
        self.field_errors = field_errors or {}


class AssignmentConflictError(AssignmentDomainError):
    """Lỗi xung đột phiên bản tương tranh lạc quan (Optimistic Concurrency Control)."""

    def __init__(
        self,
        message: str = (
            "Dữ liệu bài tập đã được cập nhật bởi một phiên làm việc khác. Vui lòng tải lại trang."
        ),
    ):
        super().__init__(message, code="CONFLICT")


class CourseArchivedError(AssignmentDomainError):
    """Ném ra khi thực hiện thao tác sửa đổi trên môn học đã bị lưu trữ."""

    def __init__(
        self,
        message: str = "Môn học đã được lưu trữ (chỉ đọc), không thể tạo hoặc chỉnh sửa bài tập.",
    ):
        super().__init__(message, code="COURSE_ARCHIVED")


class AssignmentNotFoundError(AssignmentDomainError):
    """Không tìm thấy bài tập theo yêu cầu."""

    def __init__(self, message: str = "Không tìm thấy bài tập tương ứng."):
        super().__init__(message, code="NOT_FOUND")


class AssignmentPermissionDeniedError(AssignmentDomainError):
    """Từ chối quyền truy cập hoặc thực hiện thao tác."""

    def __init__(self, message: str = "Bạn không có quyền thực hiện thao tác này."):
        super().__init__(message, code="PERMISSION_DENIED")
