import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ai_assistant", "0001_initial"),
        ("courses", "0004_courseannouncement_courseannouncementreceipt"),
        ("materials", "0004_materialversion_extraction_attempts_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="MaterialSummaryDraft",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("summary", models.TextField()),
                ("source_file_names", models.JSONField(default=list)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Chờ duyệt"),
                            ("confirmed", "Đã xác nhận"),
                            ("discarded", "Đã từ chối"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "course",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ai_summary_drafts",
                        to="courses.course",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="created_ai_summary_drafts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "material",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ai_summary_drafts",
                        to="materials.material",
                    ),
                ),
                (
                    "material_version",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ai_summary_drafts",
                        to="materials.materialversion",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="reviewed_ai_summary_drafts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "id"],
                "indexes": [
                    models.Index(
                        fields=["course", "status", "created_at"],
                        name="ai_sum_course_status_idx",
                    ),
                    models.Index(
                        fields=["material_version", "status"],
                        name="ai_sum_version_status_idx",
                    ),
                ],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("status__in", ["pending", "confirmed", "discarded"])),
                        name="ai_sum_status_valid",
                    ),
                    models.CheckConstraint(
                        condition=(
                            models.Q(
                                ("reviewed_at__isnull", True),
                                ("reviewed_by__isnull", True),
                                ("status", "pending"),
                            )
                            | models.Q(
                                ("reviewed_at__isnull", False),
                                ("reviewed_by__isnull", False),
                                ("status__in", ["confirmed", "discarded"]),
                            )
                        ),
                        name="ai_sum_review_consistent",
                    ),
                    models.UniqueConstraint(
                        fields=("material_version",),
                        condition=models.Q(("status", "pending")),
                        name="ai_sum_one_pending_per_version",
                    ),
                ],
            },
        ),
    ]
