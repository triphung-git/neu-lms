from django.db import models


class ExtractionStatus(models.TextChoices):
    PENDING = "pending", "Chờ trích xuất"
    EXTRACTING = "extracting", "Đang trích xuất"
    SUCCESS = "success", "Thành công"
    FAILED = "failed", "Thất bại"
    NO_TEXT = "no_text", "Không có văn bản"
    UNSUPPORTED = "unsupported", "Không hỗ trợ"
