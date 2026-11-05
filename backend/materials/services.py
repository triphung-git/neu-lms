import hashlib
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import models, transaction
from django.utils import timezone

from courses.models import Course, Membership
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from files.services import current_actor
from files.storage import get_storage
from identity.models import Role
from identity.services.common import has_role, require_verified
from platform_core.events import append_audit, record_change

from .isolated_parser import extract_file_isolated
from .models import (
    ExtractionStatus,
    Material,
    MaterialFile,
    MaterialFileExtraction,
    MaterialType,
    MaterialVersion,
    MaterialVersionStatus,
    ProcessingStatus,
)


def _check_teacher_course_permission(course: Course, user: Any) -> None:
    """Serialize with identity, course lifecycle, file policy and B08 mutations."""
    actor = current_actor(user)
    course.refresh_from_db()
    Course.objects.select_for_update().get(pk=course.pk)
    course.refresh_from_db()
    if course.status == Course.Status.ARCHIVED:
        raise PermissionDenied("Môn học đã lưu trữ, không thể thực hiện thay đổi.")
    if not has_role(actor, Role.TEACHER) or course.teacher_id != actor.id:
        raise PermissionDenied("Chỉ giảng viên phụ trách môn học được thao tác.")


@transaction.atomic
def create_material(
    course: Course,
    teacher: Any,
    title: str,
    description: str = "",
    material_type: str = MaterialType.DOCUMENT,
    tags: list[str] | None = None,
    chapter_id: Any | None = None,
    lesson_id: Any | None = None,
    initial_file_ids: list[Any] | None = None,
) -> tuple[Material, MaterialVersion]:
    """
    Khởi tạo học liệu mới kèm phiên bản nháp v1.
    Nếu có initial_file_ids, kiểm tra tính hợp lệ và gắn vào manifest của v1.
    """
    _check_teacher_course_permission(course, teacher)

    clean_title = title.strip()
    if not clean_title:
        raise ValidationError({"title": "Tiêu đề học liệu không được để trống."})

    material = Material(
        course=course,
        chapter_id=chapter_id,
        lesson_id=lesson_id,
        title=clean_title,
        description=description,
        tags=tags or [],
        material_type=material_type,
        created_by=teacher,
        updated_by=teacher,
    )
    material.full_clean()
    material.save()

    version = MaterialVersion(
        material=material,
        version_number=1,
        title=clean_title,
        description=description,
        changelog="Khởi tạo phiên bản đầu tiên.",
        lifecycle_status=MaterialVersionStatus.DRAFT,
        processing_status=ProcessingStatus.PENDING,
        created_by=teacher,
    )
    version.full_clean()
    version.save()

    if initial_file_ids:
        position = 1
        total_size = 0
        for fid in initial_file_ids:
            try:
                sfile = StoredFile.objects.select_for_update().get(id=fid)
            except StoredFile.DoesNotExist as err:
                raise ValidationError(
                    {"initial_file_ids": f"Tệp tin {fid} không tồn tại."}
                ) from err

            if sfile.purpose != FilePurpose.COURSE_MATERIAL:
                raise ValidationError("Chỉ được gắn tệp học liệu đúng scope.")
            if sfile.course_id != course.id:
                raise ValidationError(
                    {"initial_file_ids": f"Tệp tin {sfile.file_name} không thuộc môn học này."}
                )
            if sfile.status != FileStatus.CLEAN:
                raise ValidationError(
                    {"initial_file_ids": f"Tệp {sfile.file_name} chưa được quét an toàn (clean)."}
                )

            mf = MaterialFile(
                material_version=version,
                file=sfile,
                position=position,
                file_name=sfile.file_name,
                file_size=sfile.file_size,
                mime_type=sfile.mime_type,
                sha256_hash=sfile.sha256_hash,
            )
            mf.full_clean()
            mf.save()
            position += 1
            total_size += sfile.file_size

        version.file_count = len(initial_file_ids)
        version.total_size_bytes = total_size
        version.save(update_fields=["file_count", "total_size_bytes", "updated_at"])

    from .search import update_material_search_vector

    update_material_search_vector(material)

    record_change(
        actor=teacher,
        action="materials.created",
        resource_type="material",
        resource_id=material.id,
        metadata={"course_id": str(material.course_id), "material_id": str(material.id)},
    )
    return material, version


@transaction.atomic
def create_material_version(
    material: Material,
    teacher: Any,
    changelog: str = "",
    clone_from_version: MaterialVersion | None = None,
) -> MaterialVersion:
    """
    Tạo một phiên bản nháp (draft) mới cho học liệu.
    Không làm thay đổi con trỏ công bố (published_version) hiện tại.
    """
    _check_teacher_course_permission(material.course, teacher)
    material.refresh_from_db()

    # Next version number
    max_ver = material.versions.aggregate(max_v=models.Max("version_number"))["max_v"] or 0
    next_ver = max_ver + 1

    new_version = MaterialVersion(
        material=material,
        version_number=next_ver,
        title=material.title,
        description=material.description,
        changelog=changelog,
        lifecycle_status=MaterialVersionStatus.DRAFT,
        processing_status=ProcessingStatus.PENDING,
        created_by=teacher,
    )
    new_version.full_clean()
    new_version.save()

    if clone_from_version:
        if clone_from_version.material_id != material.id:
            raise ValidationError(
                {"clone_from_version": "Phiên bản sao chép phải thuộc cùng một học liệu."}
            )
        total_size = 0
        file_count = 0
        for src_mf in clone_from_version.material_files.all().order_by("position"):
            mf = MaterialFile(
                material_version=new_version,
                file=src_mf.file,
                position=src_mf.position,
                label=src_mf.label,
                file_name=src_mf.file_name,
                file_size=src_mf.file_size,
                mime_type=src_mf.mime_type,
                sha256_hash=src_mf.sha256_hash,
            )
            mf.full_clean()
            mf.save()
            total_size += src_mf.file_size
            file_count += 1
        new_version.file_count = file_count
        new_version.total_size_bytes = total_size
        new_version.save(update_fields=["file_count", "total_size_bytes", "updated_at"])

    record_change(
        actor=teacher,
        action="materials.version_created",
        resource_type="material",
        resource_id=material.id,
        metadata={
            "course_id": str(material.course_id),
            "material_id": str(material.id),
            "version_id": str(new_version.id),
        },
    )
    return new_version


@transaction.atomic
def add_file_to_version(
    material_version: MaterialVersion,
    stored_file: StoredFile,
    teacher: Any,
    label: str = "",
    position: int | None = None,
) -> MaterialFile:
    """Thêm một tệp clean vào phiên bản nháp."""
    _check_teacher_course_permission(material_version.material.course, teacher)
    material_version.refresh_from_db()

    if material_version.lifecycle_status != MaterialVersionStatus.DRAFT:
        raise ValidationError("Không thể thêm tệp vào phiên bản đã đóng băng (finalized).")

    stored_file.refresh_from_db()
    if stored_file.purpose != FilePurpose.COURSE_MATERIAL:
        raise ValidationError("Chỉ được gắn tệp học liệu đúng scope.")
    if stored_file.course_id != material_version.material.course_id:
        raise ValidationError({"file": "Tệp tin không thuộc cùng môn học với học liệu."})

    if stored_file.status != FileStatus.CLEAN:
        raise ValidationError(
            {"file": "Chỉ tệp tin đã quét an toàn (clean) mới được gắn vào học liệu."}
        )

    if MaterialFile.objects.filter(material_version=material_version, file=stored_file).exists():
        raise ValidationError({"file": "Tệp tin này đã có trong danh sách của phiên bản."})

    if position is None:
        max_pos = (
            material_version.material_files.aggregate(max_p=models.Max("position"))["max_p"] or 0
        )
        position = max_pos + 1

    mf = MaterialFile(
        material_version=material_version,
        file=stored_file,
        position=position,
        label=label,
        file_name=stored_file.file_name,
        file_size=stored_file.file_size,
        mime_type=stored_file.mime_type,
        sha256_hash=stored_file.sha256_hash,
    )
    mf.full_clean()
    mf.save()

    # Cập nhật tổng quan
    material_version.file_count = material_version.material_files.count()
    material_version.total_size_bytes = (
        material_version.material_files.aggregate(total=models.Sum("file_size"))["total"] or 0
    )
    material_version.save(update_fields=["file_count", "total_size_bytes", "updated_at"])

    return mf


@transaction.atomic
def remove_file_from_version(
    material_version: MaterialVersion,
    material_file_id: Any,
    teacher: Any,
) -> None:
    """Xóa một tệp khỏi phiên bản nháp."""
    _check_teacher_course_permission(material_version.material.course, teacher)
    material_version.refresh_from_db()

    if material_version.lifecycle_status != MaterialVersionStatus.DRAFT:
        raise ValidationError("Không thể xóa tệp khỏi phiên bản đã đóng băng (finalized).")

    try:
        mf = material_version.material_files.get(id=material_file_id)
    except MaterialFile.DoesNotExist as err:
        raise ValidationError("Tệp tin không tồn tại trong phiên bản này.") from err

    mf.delete()

    # Đánh lại số thứ tự position
    remaining = material_version.material_files.order_by("position", "created_at")
    for idx, item in enumerate(remaining, start=1):
        if item.position != idx:
            item.position = idx
            item.save(update_fields=["position"])

    material_version.file_count = material_version.material_files.count()
    material_version.total_size_bytes = (
        material_version.material_files.aggregate(total=models.Sum("file_size"))["total"] or 0
    )
    material_version.save(update_fields=["file_count", "total_size_bytes", "updated_at"])


@transaction.atomic
def finalize_material_version(
    material_version: MaterialVersion,
    teacher: Any,
) -> MaterialVersion:
    """
    Đóng băng manifest của phiên bản học liệu.
    Tính toán hash bất biến SHA-256 và lưu snapshot CourseFilePolicy.
    """
    _check_teacher_course_permission(material_version.material.course, teacher)
    material_version.refresh_from_db()

    if material_version.lifecycle_status != MaterialVersionStatus.DRAFT:
        return material_version

    # Kiểm tra phải có ít nhất 1 tệp tin
    files_count = material_version.material_files.count()
    if files_count == 0:
        raise ValidationError(
            {"manifest": "Phiên bản học liệu phải có ít nhất một tệp tin trước khi đóng băng."}
        )

    # Đối soát lại tính an toàn của tất cả các file
    for mf in material_version.material_files.select_related("file"):
        if mf.file.status != FileStatus.CLEAN:
            raise ValidationError(
                {"manifest": f"Tệp tin {mf.file_name} không còn ở trạng thái an toàn (clean)."}
            )
        if mf.file.course_id != material_version.material.course_id:
            raise ValidationError({"manifest": f"Tệp tin {mf.file_name} không thuộc môn học này."})

    # Snapshot CourseFilePolicy
    policy = CourseFilePolicy.objects.filter(course=material_version.material.course).first()
    policy_snapshot = {}
    if policy:
        if files_count > policy.max_files_per_assignment:
            raise ValidationError("Manifest vượt số tệp tối đa theo chính sách.")
        for mf in material_version.material_files.select_related("file"):
            extension = mf.file_name.rsplit(".", 1)[-1].lower()
            if (
                mf.file.purpose != FilePurpose.COURSE_MATERIAL
                or extension not in policy.allowed_extensions
                or mf.file_size > policy.max_file_size_bytes
                or mf.file_size != mf.file.file_size
                or mf.sha256_hash != mf.file.sha256_hash
            ):
                raise ValidationError("Tệp không còn phù hợp policy hoặc fingerprint manifest.")
        policy_snapshot = {
            "version": policy.version,
            "max_files_per_manifest": policy.max_files_per_assignment,
            "max_file_size_bytes": policy.max_file_size_bytes,
            "course_quota_bytes": policy.course_quota_bytes,
            "preview_allowed": policy.preview_allowed,
            "allowed_extensions": policy.allowed_extensions,
        }

    # Tính toán hash bất biến
    manifest_hash = material_version.compute_manifest_hash()
    total_size = (
        material_version.material_files.aggregate(total=models.Sum("file_size"))["total"] or 0
    )

    material_version.lifecycle_status = MaterialVersionStatus.FINALIZED
    material_version.finalized_at = timezone.now()
    material_version.manifest_hash = manifest_hash
    material_version.file_count = files_count
    material_version.total_size_bytes = total_size
    material_version.policy_snapshot = policy_snapshot
    material_version.processing_status = ProcessingStatus.PENDING
    material_version.full_clean()
    material_version.save()

    record_change(
        actor=teacher,
        action="materials.version_finalized",
        resource_type="material",
        resource_id=material_version.material_id,
        metadata={
            "course_id": str(material_version.material.course_id),
            "material_id": str(material_version.material_id),
            "version_id": str(material_version.id),
        },
    )
    # The committed PENDING row is the durable job; beat dispatches it without broker I/O in HTTP.

    return material_version


@transaction.atomic
def publish_material_version(
    material: Material,
    material_version: MaterialVersion,
    teacher: Any,
) -> Material:
    """
    Công bố phiên bản học liệu chỉ định.
    Cập nhật con trỏ published_version trên Material và mở cờ is_published trên MaterialVersion.
    """
    _check_teacher_course_permission(material.course, teacher)
    material.refresh_from_db()

    if material_version.material_id != material.id:
        raise ValidationError("Phiên bản công bố không thuộc về học liệu này.")

    if material_version.lifecycle_status not in [
        MaterialVersionStatus.FINALIZED,
        MaterialVersionStatus.ARCHIVED,
    ]:
        raise ValidationError("Chỉ phiên bản đã đóng băng (finalized) mới được công bố.")

    material_version.refresh_from_db()
    for mf in material_version.material_files.select_related("file"):
        if (
            mf.file.status != FileStatus.CLEAN
            or mf.file.sha256_hash != mf.sha256_hash
            or mf.file.file_size != mf.file_size
        ):
            raise ValidationError("Manifest không còn toàn vẹn hoặc tệp chưa sạch.")
    now = timezone.now()

    # Nếu có version đang công bố khác, đánh dấu archived nếu cần
    prev_published = material.published_version
    if prev_published and prev_published.id != material_version.id:
        prev_published.lifecycle_status = MaterialVersionStatus.ARCHIVED
        prev_published.save(update_fields=["lifecycle_status", "updated_at"])

    material_version.is_published = True
    if not material_version.published_at:
        material_version.published_at = now
    material_version.save(update_fields=["is_published", "published_at", "updated_at"])

    material.published_version = material_version
    material.is_hidden = False
    material.updated_by = teacher
    material.save(update_fields=["published_version", "is_hidden", "updated_by", "updated_at"])

    record_change(
        actor=teacher,
        action="materials.published",
        resource_type="material",
        resource_id=material.id,
        metadata={
            "course_id": str(material.course_id),
            "material_id": str(material.id),
            "version_id": str(material_version.id),
        },
    )

    return material


@transaction.atomic
def hide_material(material: Material, teacher: Any) -> Material:
    """Ẩn học liệu khỏi tầm nhìn của sinh viên."""
    _check_teacher_course_permission(material.course, teacher)
    material.refresh_from_db()

    material.is_hidden = True
    material.updated_by = teacher
    material.save(update_fields=["is_hidden", "updated_by", "updated_at"])
    record_change(
        actor=teacher,
        action="materials.hidden",
        resource_type="material",
        resource_id=material.id,
        metadata={"course_id": str(material.course_id), "material_id": str(material.id)},
    )
    return material


@transaction.atomic
def unhide_material(material: Material, teacher: Any) -> Material:
    """Mở lại học liệu nếu đã có phiên bản công bố."""
    _check_teacher_course_permission(material.course, teacher)
    material.refresh_from_db()

    if not material.published_version_id:
        raise ValidationError("Học liệu chưa có phiên bản nào được công bố để hiển thị.")

    material.is_hidden = False
    material.updated_by = teacher
    material.save(update_fields=["is_hidden", "updated_by", "updated_at"])
    record_change(
        actor=teacher,
        action="materials.unhidden",
        resource_type="material",
        resource_id=material.id,
        metadata={"course_id": str(material.course_id), "material_id": str(material.id)},
    )
    return material


@transaction.atomic
def update_material(
    material: Material,
    teacher: Any,
    *,
    title: str | None = None,
    description: str | None = None,
    material_type: str | None = None,
    tags: list[str] | None = None,
    chapter_id: Any | None = ...,
    lesson_id: Any | None = ...,
    display_order: int | None = None,
    is_hidden: bool | None = None,
) -> Material:
    """Cập nhật thông tin metadata của học liệu."""
    _check_teacher_course_permission(material.course, teacher)
    material.refresh_from_db()
    update_fields = ["updated_by", "updated_at"]
    material.updated_by = teacher

    if title is not None:
        clean_title = title.strip()
        if not clean_title:
            raise ValidationError({"title": "Tiêu đề học liệu không được để trống."})
        material.title = clean_title
        update_fields.append("title")

    if description is not None:
        material.description = description
        update_fields.append("description")

    if material_type is not None:
        if material_type not in MaterialType.values:
            raise ValidationError({"material_type": "Loại học liệu không hợp lệ."})
        material.material_type = material_type
        update_fields.append("material_type")

    if tags is not None:
        material.tags = [str(t).strip() for t in tags if str(t).strip()]
        update_fields.append("tags")

    if display_order is not None:
        material.display_order = display_order
        update_fields.append("display_order")

    if is_hidden is not None:
        material.is_hidden = is_hidden
        update_fields.append("is_hidden")

    if chapter_id is not ...:
        if chapter_id is not None:
            from courses.models import Chapter

            try:
                chap = Chapter.objects.get(id=chapter_id, course_id=material.course_id)
                material.chapter = chap
            except Chapter.DoesNotExist as err:
                raise ValidationError(
                    {"chapter_id": "Chương không tồn tại trong môn học."}
                ) from err
        else:
            material.chapter = None
        update_fields.append("chapter")

    if lesson_id is not ...:
        if lesson_id is not None:
            from courses.models import Lesson

            try:
                les = Lesson.objects.get(id=lesson_id, chapter__course_id=material.course_id)
                if material.chapter_id and les.chapter_id != material.chapter_id:
                    raise ValidationError({"lesson_id": "Bài học không thuộc chương đã chọn."})
                material.lesson = les
            except Lesson.DoesNotExist as err:
                raise ValidationError(
                    {"lesson_id": "Bài học không tồn tại trong môn học."}
                ) from err
        else:
            material.lesson = None
        update_fields.append("lesson")

    material.full_clean()
    material.save(update_fields=update_fields)
    from .search import update_material_search_vector

    update_material_search_vector(material)

    record_change(
        actor=teacher,
        action="materials.updated",
        resource_type="material",
        resource_id=material.id,
        metadata={"course_id": str(material.course_id), "material_id": str(material.id)},
    )
    return material


@transaction.atomic
def delete_material(material: Material, teacher: Any) -> None:
    """Xóa học liệu khi chưa từng được công bố."""
    _check_teacher_course_permission(material.course, teacher)
    material.refresh_from_db()
    if material.published_version_id is not None:
        raise ValidationError(
            "Không thể xóa học liệu đã từng công bố. Vui lòng sử dụng tính năng Ẩn (Hide)."
        )
    mat_id = material.id
    course_id = material.course_id
    material.delete()
    record_change(
        actor=teacher,
        action="materials.deleted",
        resource_type="material",
        resource_id=mat_id,
        metadata={"course_id": str(course_id), "material_id": str(mat_id)},
    )


def get_material_file_for_delivery(
    *,
    actor: Any,
    course_id: Any,
    material_id: Any,
    file_id: Any,
    is_preview: bool = False,
) -> tuple[MaterialFile, bytes]:
    """Phân phối nội dung tệp học liệu với kiểm quyền chặt chẽ giữa giảng viên và sinh viên."""
    require_verified(actor)
    course = Course.objects.filter(pk=course_id).first()
    if not course:
        raise ValidationError({"course_id": "Môn học không tồn tại."})

    material = Material.objects.filter(pk=material_id, course=course).first()
    if not material:
        raise ValidationError({"material_id": "Học liệu không tồn tại."})

    is_teacher = has_role(actor, Role.TEACHER) and course.teacher_id == actor.id
    is_student = (
        has_role(actor, Role.STUDENT)
        and Membership.objects.filter(
            course=course, student=actor, status=Membership.Status.ACTIVE
        ).exists()
    )

    if not (is_teacher or is_student):
        raise PermissionDenied("Bạn không có quyền truy cập tệp học liệu này.")

    if is_student and not is_teacher:
        if material.is_hidden:
            raise PermissionDenied("Học liệu này đang bị ẩn.")
        if not material.published_version:
            raise PermissionDenied("Học liệu này chưa được công bố.")
        mf = (
            material.published_version.material_files.select_related("file")
            .filter(file_id=file_id)
            .first()
        )
        if not mf:
            raise PermissionDenied("Tệp tin không thuộc phiên bản công bố của học liệu.")
    else:
        mf = (
            MaterialFile.objects.select_related("file", "material_version")
            .filter(material_version__material=material, file_id=file_id)
            .first()
        )
        if not mf:
            raise ValidationError({"file_id": "Tệp tin không thuộc học liệu này."})

    if mf.file.status != FileStatus.CLEAN:
        raise PermissionDenied("Tệp tin chưa được quét an toàn (clean).")

    if is_preview:
        if mf.file_name.rsplit(".", 1)[-1].lower() not in {
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
        }:
            raise PermissionDenied("Định dạng không hỗ trợ xem trước an toàn.")
        policy = CourseFilePolicy.objects.filter(course=course).first()
        if policy and not policy.preview_allowed:
            raise PermissionDenied("Chính sách khóa học không cho phép xem trước tài liệu.")

    storage = get_storage()
    storage_path = mf.file.storage_path
    if not storage.exists(storage_path):
        raise ValidationError("Tệp tin không tồn tại trên hệ thống lưu trữ.")

    content = storage.read(storage_path)
    expected_hash = mf.sha256_hash or mf.file.sha256_hash
    expected_size = mf.file_size or mf.file.file_size
    if len(content) != expected_size or hashlib.sha256(content).hexdigest() != expected_hash:
        raise PermissionDenied("Tính toàn vẹn của tệp tin không hợp lệ.")

    append_audit(
        actor=actor,
        action="materials.file_delivered",
        resource_type="material",
        resource_id=material.id,
        metadata={
            "course_id": str(course.id),
            "material_id": str(material.id),
            "file_id": str(file_id),
        },
    )
    return mf, content


@transaction.atomic
def extract_material_file(material_file: MaterialFile) -> MaterialFileExtraction:
    """
    Trích xuất văn bản từ một MaterialFile:
    - Bắt buộc StoredFile.status == CLEAN.
    - Đọc nội dung an toàn từ storage.
    - Xác minh hash khớp sha256_hash của file.
    - Chạy extract_file_content.
    - Lưu MaterialFileExtraction với đầy đủ provenance và file_hash.
    """
    stored_file = material_file.file
    if stored_file.status != FileStatus.CLEAN:
        raise ValidationError("Chỉ tệp tin đã quét an toàn (clean) mới được trích xuất văn bản.")

    storage = get_storage()
    if not storage.exists(stored_file.storage_path):
        raise ValidationError("Tệp tin không tồn tại trên hệ thống lưu trữ.")

    content = storage.read(stored_file.storage_path)
    expected_hash = material_file.sha256_hash or stored_file.sha256_hash
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise ValidationError("Tính toàn vẹn của tệp tin không khớp với giá trị băm đã đăng ký.")

    if len(content) != material_file.file_size:
        raise ValidationError("File size differs from manifest")
    res = extract_file_isolated(
        content,
        material_file.file_name or stored_file.file_name,
        material_file.mime_type or stored_file.mime_type,
    )

    now = timezone.now()
    extraction, _ = MaterialFileExtraction.objects.update_or_create(
        material_version=material_file.material_version,
        material_file=material_file,
        defaults={
            "stored_file": stored_file,
            "status": res.status,
            "file_hash": expected_hash,
            "extracted_text": res.extracted_text,
            "page_count": res.page_count,
            "metadata": res.metadata,
            "error_message": res.error_message,
            "completed_at": now,
        },
    )
    from .search import update_extraction_search_vector

    update_extraction_search_vector(extraction)
    return extraction


def extract_version_materials(material_version: MaterialVersion) -> MaterialVersion:
    """
    Trích xuất đồng bộ toàn bộ các tệp trong phiên bản học liệu và cập nhật processing_status.
    Hữu ích cho synchronous processing và test suites.
    """
    material_version.processing_status = ProcessingStatus.PROCESSING
    material_version.save(update_fields=["processing_status", "updated_at"])

    mfiles = material_version.material_files.select_related("file").order_by("position", "id")
    if not mfiles.exists():
        material_version.processing_status = ProcessingStatus.NO_TEXT
        material_version.save(update_fields=["processing_status", "updated_at"])
        return material_version

    success_count = 0
    no_text_count = 0
    unsupported_count = 0
    failed_count = 0

    for mf in mfiles:
        try:
            extraction = extract_material_file(mf)
            if extraction.status == ExtractionStatus.SUCCESS:
                success_count += 1
            elif extraction.status == ExtractionStatus.NO_TEXT:
                no_text_count += 1
            elif extraction.status == ExtractionStatus.UNSUPPORTED:
                unsupported_count += 1
            elif extraction.status == ExtractionStatus.FAILED:
                failed_count += 1
        except (OSError, BotoCoreError, ClientError):
            raise
        except Exception:
            failed_count += 1
            MaterialFileExtraction.objects.update_or_create(
                material_version=material_version,
                material_file=mf,
                defaults={
                    "stored_file": mf.file,
                    "status": ExtractionStatus.FAILED,
                    "file_hash": mf.sha256_hash or mf.file.sha256_hash,
                    "error_message": "Extraction failed",
                    "extracted_text": "",
                    "search_vector": None,
                    "completed_at": timezone.now(),
                },
            )

    total = len(mfiles)
    if failed_count:
        final_status = ProcessingStatus.FAILED
    elif success_count > 0:
        final_status = ProcessingStatus.READY
    elif unsupported_count == total:
        final_status = ProcessingStatus.UNSUPPORTED
    elif no_text_count == total or (no_text_count + unsupported_count == total):
        final_status = ProcessingStatus.NO_TEXT
    else:
        final_status = ProcessingStatus.FAILED

    material_version.processing_status = final_status
    material_version.save(update_fields=["processing_status", "updated_at"])
    return material_version


@transaction.atomic
def retry_material_version(material_version, teacher):
    _check_teacher_course_permission(material_version.material.course, teacher)
    material_version.refresh_from_db()
    if (
        material_version.lifecycle_status == MaterialVersionStatus.DRAFT
        or material_version.processing_status == ProcessingStatus.PROCESSING
    ):
        raise ValidationError("Không thể thử lại bản nháp hoặc tác vụ đang chạy.")
    material_version.processing_status = ProcessingStatus.PENDING
    material_version.extraction_attempts = 0
    material_version.extraction_dispatched_at = None
    material_version.save(
        update_fields=[
            "processing_status",
            "extraction_attempts",
            "extraction_dispatched_at",
            "updated_at",
        ]
    )
    return material_version
