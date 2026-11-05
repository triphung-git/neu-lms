from django.db.models import F
from rest_framework import serializers

from files.models import FilePurpose, FileStatus
from materials.models import MaterialFileExtraction
from materials.statuses import ExtractionStatus


class ChatTurnSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    request_id = serializers.UUIDField()
    question = serializers.CharField()
    answer = serializers.CharField()
    citations = serializers.ListField(child=serializers.DictField())
    created_at = serializers.DateTimeField()


def visible_turns(conversation, limit=50):
    """Do not replay excerpts after their source version/file was revoked or changed."""
    rows = list(conversation.turns.order_by("-id")[:limit])
    eligible = (
        MaterialFileExtraction.objects.filter(
            status=ExtractionStatus.SUCCESS,
            stored_file__status=FileStatus.CLEAN,
            stored_file__purpose=FilePurpose.COURSE_MATERIAL,
            stored_file__course_id=conversation.course_id,
            material_version__material__course_id=conversation.course_id,
            material_version__material__is_hidden=False,
            material_version__is_published=True,
            material_version__material__published_version_id=F("material_version_id"),
            material_file__material_version_id=F("material_version_id"),
            material_file__file_id=F("stored_file_id"),
            file_hash=F("material_file__sha256_hash"),
        )
        .filter(file_hash=F("stored_file__sha256_hash"))
        .exclude(file_hash="")
    )
    allowed = {
        (str(x), str(v), str(f), h)
        for x, v, f, h in eligible.values_list(
            "material_version__material_id", "material_version_id", "stored_file_id", "file_hash"
        )
    }
    return [
        row
        for row in reversed(rows)
        if all(
            (c.get("material_id"), c.get("version_id"), c.get("file_id"), c.get("file_hash"))
            in allowed
            for c in row.citations
        )
    ]
