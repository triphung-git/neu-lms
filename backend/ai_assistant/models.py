
import uuid

from django.db import models


class MaterialChunkEmbedding(models.Model):
    """
    Lưu embedding của từng chunk thuộc một lần trích xuất học liệu.

    JSONField được sử dụng trong MVP để không cần cài thêm
    pgvector extension. Có thể nâng cấp sang pgvector sau.
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
        return (
            f"Embedding {self.extraction_id} "
            f"chunk {self.chunk_index}"
        )
