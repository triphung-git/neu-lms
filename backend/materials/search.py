import uuid
from collections.abc import Sequence
from typing import Any

from django.contrib.postgres.search import SearchQuery, SearchVector
from django.core.exceptions import ValidationError
from django.db.models import (
    Case,
    Exists,
    F,
    Func,
    IntegerField,
    OuterRef,
    Q,
    Subquery,
    TextField,
    UUIDField,
    Value,
    When,
)
from django.db.models.functions import Cast, Coalesce, Greatest, StrIndex, Substr

from courses.models import Membership
from files.models import CourseFilePolicy, FileStatus
from identity.models import Role
from identity.services.common import has_role, require_verified

from .models import (
    ExtractionStatus,
    Material,
    MaterialFile,
    MaterialFileExtraction,
    MaterialVersion,
)

MAX_SEARCH_QUERY_LENGTH = 200


class Unaccent(Func):
    function = "UNACCENT"
    output_field = TextField()


def update_material_search_vector(material):
    Material.objects.filter(pk=material.pk).update(
        search_vector=(
            SearchVector(Unaccent("title"), weight="A", config="simple")
            + SearchVector(Unaccent("description"), weight="B", config="simple")
        )
    )


def update_extraction_search_vector(extraction):
    MaterialFileExtraction.objects.filter(pk=extraction.pk).update(
        search_vector=SearchVector(Unaccent("extracted_text"), config="simple")
    )


def _strip_vietnamese_accents(text: str) -> str:
    """Chuyển đổi ký tự tiếng Việt có dấu thành không dấu để hỗ trợ tìm kiếm linh hoạt."""
    s1 = "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
    s0 = "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd"
    mapping = str.maketrans(s1 + s1.upper(), s0 + s0.upper())
    return text.translate(mapping)


def _extract_snippet(text: str, query: str, max_chars: int = 160) -> str:
    """Trích xuất đoạn văn bản ngữ cảnh xung quanh từ khóa tìm kiếm."""
    if not text or not query:
        return ""

    # Thử tìm trực tiếp
    idx = text.lower().find(query.lower())
    if idx == -1:
        # Thử tìm không dấu
        norm_text = _strip_vietnamese_accents(text.lower())
        norm_query = _strip_vietnamese_accents(query.lower())
        idx = norm_text.find(norm_query)

    if idx == -1:
        # Trả về đoạn đầu
        return text[:max_chars].strip() + ("..." if len(text) > max_chars else "")

    start = max(0, idx - 50)
    end = min(len(text), idx + len(query) + 90)
    snippet = text[start:end].replace("\n", " ").strip()
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{snippet}{suffix}"


def _find_page_number(metadata: dict, query: str) -> int | None:
    """Xác định số trang xuất hiện từ khóa dựa vào provenance metadata."""
    pages = metadata.get("pages")
    if not isinstance(pages, list):
        return None

    query_lower = query.lower()
    norm_query = _strip_vietnamese_accents(query_lower)

    for p in pages:
        if not isinstance(p, dict):
            continue
        p_text = p.get("text", "") or p.get("snippet", "")
        if query_lower in p_text.lower() or norm_query in _strip_vietnamese_accents(p_text.lower()):
            return p.get("page_number")
    return None


class MaterialSearchResults(Sequence):
    """SQL count/order/slice first; render snippets only for the requested page."""

    def __init__(self, queryset, query, file_type):
        self.queryset, self.query, self.file_type = queryset, query, file_type

    def __len__(self):
        return self.queryset.count()

    def __getitem__(self, key):
        rows = self.queryset[key]
        return [self.render(row) for row in rows] if isinstance(key, slice) else self.render(rows)

    def __iter__(self):
        return (self.render(row) for row in self.queryset.iterator())

    def render(self, mat):
        version = MaterialVersion.objects.filter(pk=mat.target_version_id).first()
        files = (
            MaterialFile.objects.filter(
                material_version=version, file__status=FileStatus.CLEAN
            ).select_related("file")
            if version
            else MaterialFile.objects.none()
        )
        if self.file_type and self.file_type != "all":
            files = files.filter(file_name__iendswith="." + self.file_type)
        matches = []
        q = self.query
        norm = _strip_vietnamese_accents(q.lower())
        if q:
            for kind, text in [
                ("title", mat.title),
                ("description", mat.description),
                ("tag", " ".join(map(str, mat.tags or []))),
            ]:
                if norm in _strip_vietnamese_accents(text.lower()):
                    matches.append(
                        dict(
                            file_id=None,
                            file_name="",
                            mime_type="",
                            page_number=None,
                            snippet=_extract_snippet(text, q),
                            match_type=kind,
                        )
                    )
            for mf in files:
                if norm in _strip_vietnamese_accents(mf.file_name.lower()):
                    matches.append(
                        dict(
                            file_id=mf.file_id,
                            file_name=mf.file_name,
                            mime_type=mf.mime_type,
                            page_number=None,
                            snippet=mf.file_name,
                            match_type="file_name",
                        )
                    )
                if mat.can_search_body:
                    ext = (
                        valid_extractions()
                        .filter(material_file=mf)
                        .annotate(
                            normalized=Unaccent("extracted_text"),
                            snippet=Substr(
                                "extracted_text",
                                Greatest(
                                    StrIndex(Unaccent("extracted_text"), Value(norm)) - 50, Value(1)
                                ),
                                160,
                            ),
                        )
                        .filter(
                            Q(normalized__icontains=norm)
                            | Q(search_vector=SearchQuery(norm, config="simple"))
                        )
                        .values("snippet", "metadata")
                        .first()
                    )
                    if ext:
                        matches.append(
                            dict(
                                file_id=mf.file_id,
                                file_name=mf.file_name,
                                mime_type=mf.mime_type,
                                page_number=_find_page_number(ext["metadata"] or {}, q),
                                snippet=ext["snippet"],
                                match_type="body",
                            )
                        )
        return dict(
            id=mat.id,
            course_id=mat.course_id,
            course_name=mat.course.name,
            course_code=mat.course.code,
            title=mat.title,
            description=mat.description,
            tags=mat.tags or [],
            material_type=mat.material_type,
            chapter_id=mat.chapter_id,
            chapter_title=mat.chapter.title if mat.chapter else None,
            lesson_id=mat.lesson_id,
            lesson_title=mat.lesson.title if mat.lesson else None,
            version_id=version.id if version else None,
            version_number=version.version_number if version else 1,
            is_hidden=mat.is_hidden,
            published_at=mat.published_version.published_at if mat.published_version else None,
            created_at=mat.created_at,
            updated_at=mat.updated_at,
            rank=float(mat.rank),
            matches=matches,
        )


def valid_extractions():
    return MaterialFileExtraction.objects.filter(
        status=ExtractionStatus.SUCCESS,
        stored_file__status=FileStatus.CLEAN,
        file_hash=F("material_file__sha256_hash"),
        file_hash__isnull=False,
    ).filter(file_hash=F("stored_file__sha256_hash"))


def search_materials(
    user: Any, q="", course_id=None, file_type=None, chapter_id=None, tag=None, sort_by="relevance"
):
    require_verified(user)
    q = q.strip()
    if len(q) > MAX_SEARCH_QUERY_LENGTH:
        raise ValidationError("Từ khóa tìm kiếm không được vượt quá 200 ký tự.")
    if file_type not in (None, "", "all", "pdf", "docx", "txt", "png", "jpg", "jpeg", "webp"):
        raise ValidationError("Loại tệp không hợp lệ.")
    if sort_by not in {"relevance", "newest", "title_asc", "title_desc"}:
        raise ValidationError("Thứ tự không hợp lệ.")
    teacher = Q(course__teacher=user) if has_role(user, Role.TEACHER) else Q(pk__in=[])
    student = Q(pk__in=[])
    if has_role(user, Role.STUDENT):
        student = Q(
            course_id__in=Membership.objects.filter(
                student=user, status=Membership.Status.ACTIVE
            ).values("course_id"),
            is_hidden=False,
            published_version__isnull=False,
        )
    qs = Material.objects.filter(teacher | student).select_related(
        "course", "chapter", "lesson", "published_version"
    )
    for field, value in [("course_id", course_id), ("chapter_id", chapter_id)]:
        if value:
            try:
                value = uuid.UUID(str(value))
            except (ValueError, TypeError) as exc:
                raise ValidationError("Mã tài nguyên không hợp lệ.") from exc
            qs = qs.filter(**{field: value})
    if tag:
        qs = qs.filter(tags__contains=[tag.strip()])
    latest = (
        MaterialVersion.objects.filter(material_id=OuterRef("pk"))
        .order_by("-version_number")
        .values("id")[:1]
    )
    qs = qs.annotate(
        target_version_id=Coalesce(
            "published_version_id", Subquery(latest, output_field=UUIDField())
        ),
        can_search_body=Case(
            When(teacher, then=Value(True)),
            default=~Exists(
                CourseFilePolicy.objects.filter(
                    course_id=OuterRef("course_id"), preview_allowed=False
                )
            ),
        ),
    )
    files = MaterialFile.objects.filter(
        material_version_id=OuterRef("target_version_id"), file__status=FileStatus.CLEAN
    )
    if file_type and file_type != "all":
        files = files.filter(file_name__iendswith="." + file_type)
        qs = qs.filter(Exists(files))
    if q:
        norm = _strip_vietnamese_accents(q.lower())
        qs = qs.annotate(
            nt=Unaccent("title"), nd=Unaccent("description"), ng=Unaccent(Cast("tags", TextField()))
        )
        file_matches = files.annotate(nf=Unaccent("file_name")).filter(nf__icontains=norm)
        ext = valid_extractions().filter(material_version_id=OuterRef("target_version_id"))
        if file_type and file_type != "all":
            ext = ext.filter(material_file__file_name__iendswith="." + file_type)
        ext = ext.annotate(nb=Unaccent("extracted_text")).filter(
            Q(search_vector=SearchQuery(norm, config="simple")) | Q(nb__icontains=norm)
        )
        qs = qs.annotate(body_match=Exists(ext), filename_match=Exists(file_matches))
        qs = qs.filter(
            Q(search_vector=SearchQuery(norm, config="simple"))
            | Q(nt__icontains=norm)
            | Q(nd__icontains=norm)
            | Q(ng__icontains=norm)
            | Q(filename_match=True)
            | Q(body_match=True, can_search_body=True)
        )
        qs = qs.annotate(
            rank=Case(When(nt__icontains=norm, then=10), default=0, output_field=IntegerField())
            + Case(When(nd__icontains=norm, then=5), default=0, output_field=IntegerField())
            + Case(When(ng__icontains=norm, then=4), default=0, output_field=IntegerField())
            + Case(When(filename_match=True, then=3), default=0, output_field=IntegerField())
            + Case(
                When(body_match=True, can_search_body=True, then=2),
                default=0,
                output_field=IntegerField(),
            )
        )
    else:
        qs = qs.annotate(rank=Value(1))
    ordering = {
        "newest": ["-created_at"],
        "title_asc": ["title"],
        "title_desc": ["-title"],
        "relevance": ["-rank", "-created_at"],
    }[sort_by]
    return MaterialSearchResults(qs.order_by(*ordering, "id"), q, file_type)
