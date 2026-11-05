import uuid

from django.conf import settings
from django.db import models


class MaterialChunkEmbedding(models.Model):
    """
    LÆ°u embedding cá»§a tá»«ng chunk thuá»™c má»™t láº§n trÃ­ch xuáº¥t há»c liá»‡u.

    JSONField Ä‘Æ°á»£c sá»­ dá»¥ng trong MVP Ä‘á»ƒ khÃ´ng cáº§n cÃ i thÃªm
    pgvector extension. CÃ³ thá»ƒ nÃ¢ng cáº¥p sang pgvector sau.
    """

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    extraction = models.ForeignKey(
        "materials.MaterialFileExtraction",
        on_delete=models.CASCADE,
        related_name="ai_chunk_embeddings",
    )

    chunk_index = models.PositiveIntegerField()

    page_number = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    text = models.TextField()

    content_hash = models.CharField(
        max_length=64,
    )

    embedding_model = models.CharField(
        max_length=100,
    )

    dimensions = models.PositiveSmallIntegerField(
        default=768,
    )

    embedding = models.JSONField(
        default=list,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["extraction_id", "chunk_index"]

        constraints = [
            models.UniqueConstraint(
                fields=[
                    "extraction",
                    "chunk_index",
                    "embedding_model",
                ],
                name="ai_chunk_emb_extr_model_uq",
            ),
            models.CheckConstraint(
                condition=models.Q(dimensions__gt=0),
                name="ai_chunk_emb_dims_positive",
            ),
        ]

        indexes = [
            models.Index(
                fields=["extraction", "chunk_index"],
                name="ai_chunk_emb_extr_idx",
            ),
        ]

    def __str__(self):
        return f"Embedding {self.extraction_id} chunk {self.chunk_index}"


class MaterialSummaryDraft(models.Model):
    """Teacher-reviewed AI summary tied to one immutable material version."""

    class Status(models.TextChoices):
        PENDING = "pending", "..."
        CONFIRMED = "confirmed", "Confirmed"
        DISCARDED = "discarded", "..."

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    course = models.ForeignKey(
        "courses.Course",
        on_delete=models.CASCADE,
        related_name="ai_summary_drafts",
    )
    material = models.ForeignKey(
        "materials.Material",
        on_delete=models.CASCADE,
        related_name="ai_summary_drafts",
    )
    material_version = models.ForeignKey(
        "materials.MaterialVersion",
        on_delete=models.CASCADE,
        related_name="ai_summary_drafts",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_ai_summary_drafts",
    )
    summary = models.TextField()
    source_file_names = models.JSONField(default=list)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reviewed_ai_summary_drafts",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]
        indexes = [
            models.Index(
                fields=["course", "status", "created_at"],
                name="ai_sum_course_status_idx",
            ),
            models.Index(
                fields=["material_version", "status"],
                name="ai_sum_version_status_idx",
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=["pending", "confirmed", "discarded"]),
                name="ai_sum_status_valid",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status="pending", reviewed_by__isnull=True, reviewed_at__isnull=True)
                    | models.Q(
                        status__in=["confirmed", "discarded"],
                        reviewed_by__isnull=False,
                        reviewed_at__isnull=False,
                    )
                ),
                name="ai_sum_review_consistent",
            ),
            models.UniqueConstraint(
                fields=["material_version"],
                condition=models.Q(status="pending"),
                name="ai_sum_one_pending_per_version",
            ),
        ]

    def __str__(self):
        return (
            f"AI summary {self.material_id} v{self.material_version.version_number} ({self.status})"
        )


class ChatConversation(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    course = models.ForeignKey("courses.Course", on_delete=models.CASCADE)
    generation = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "course"], name="ai_chat_user_course_unique")
        ]


class ChatTurn(models.Model):
    conversation = models.ForeignKey(
        ChatConversation, on_delete=models.CASCADE, related_name="turns"
    )
    request_id = models.UUIDField(default=uuid.uuid4)
    question = models.TextField()
    answer = models.TextField()
    citations = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "request_id"], name="ai_chat_request_unique"
            )
        ]


class EmbeddingIndexState(models.Model):
    extraction = models.OneToOneField("materials.MaterialFileExtraction", on_delete=models.CASCADE)
    signature = models.CharField(max_length=64)
    status = models.CharField(max_length=16, default="pending")
    attempts = models.PositiveIntegerField(default=0)
    retry_at = models.DateTimeField(null=True)
    last_error_code = models.CharField(max_length=64, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
