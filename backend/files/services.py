import hashlib
import os
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from courses.models import Course
from identity.models import Role, User
from identity.services.common import has_role, lock_role_policy, require_verified
from platform_core.errors import DomainError
from platform_core.events import record_change

from .constants import SYSTEM_MAX_FILE_SIZE_BYTES
from .models import CourseFilePolicy, FilePurpose, FileScanResult, FileStatus, StoredFile
from .scanner import BaseScannerEngine, get_scanner_engine
from .storage import get_storage


def sanitize_filename(name):
    base = os.path.basename(name.replace("\\", "/"))
    return ("".join(c for c in base if c.isalnum() or c in ".-_ ()").strip() or "unnamed_file")[
        :255
    ]


def get_file_extension(filename):
    return filename.rsplit(".", 1)[-1].strip().lower() if "." in filename else ""


def manager(actor, course):
    return has_role(actor, Role.TEACHER) and course.teacher_id == actor.id


def current_actor(actor):
    lock_role_policy()
    fresh = User.objects.filter(pk=actor.id, is_active=True).first()
    if fresh is None:
        raise DomainError("ACCOUNT_INACTIVE")
    require_verified(fresh)
    return fresh


def require_file_upload_permission(actor, course, purpose):
    if not actor.is_active:
        raise DomainError("ACCOUNT_INACTIVE")
    require_verified(actor)
    if course.status == Course.Status.ARCHIVED:
        raise DomainError("COURSE_ARCHIVED")
    if not manager(actor, course):
        raise DomainError("FORBIDDEN")
    if purpose not in (FilePurpose.COURSE_MATERIAL, FilePurpose.GENERAL):
        # Assignment/submission resources and their eligibility checks arrive with B10/B11.
        raise DomainError("INVALID_FILE_PURPOSE")


def locked_file(file_id):
    course_id = StoredFile.objects.filter(pk=file_id).values_list("course_id", flat=True).first()
    if course_id is None:
        raise DomainError("FILE_NOT_FOUND")
    course = Course.objects.select_for_update().get(pk=course_id)
    policy = CourseFilePolicy.objects.select_for_update().get(course=course)
    item = StoredFile.objects.select_for_update().get(pk=file_id)
    item.course = course
    return item, policy


def event(action, item, actor=None, system_actor="", **extra):
    metadata = {"course_id": str(item.course_id), "file_id": str(item.id), **extra}
    return record_change(
        action=action,
        resource_type="file",
        resource_id=item.id,
        actor=actor,
        system_actor=system_actor,
        metadata=metadata,
    )


@transaction.atomic
def create_upload_intent(
    *,
    actor,
    course_id,
    file_name,
    file_size,
    mime_type="application/octet-stream",
    purpose=FilePurpose.COURSE_MATERIAL,
):
    actor = current_actor(actor)
    try:
        course = Course.objects.select_for_update().get(pk=course_id)
    except Course.DoesNotExist as error:
        raise DomainError("COURSE_NOT_FOUND") from error
    require_file_upload_permission(actor, course, purpose)
    policy, _ = CourseFilePolicy.objects.select_for_update().get_or_create(course=course)
    if type(file_size) is not int or file_size <= 0:
        raise DomainError("INVALID_FILE_SIZE")
    if file_size > min(policy.max_file_size_bytes, SYSTEM_MAX_FILE_SIZE_BYTES):
        raise DomainError("FILE_SIZE_EXCEEDS_LIMIT")
    if get_file_extension(file_name) not in policy.allowed_extensions:
        raise DomainError("FILE_EXTENSION_NOT_ALLOWED")
    if (
        policy.used_quota_bytes + policy.reserved_quota_bytes + file_size
        > policy.course_quota_bytes
    ):
        raise DomainError("QUOTA_EXCEEDED")
    policy.reserved_quota_bytes += file_size
    policy.save(update_fields=["reserved_quota_bytes", "updated_at"])
    file_id = uuid.uuid4()
    name = sanitize_filename(file_name)
    snapshot = {
        "version": policy.version,
        "allowed_extensions": policy.allowed_extensions,
        "max_file_size_bytes": policy.max_file_size_bytes,
        "max_files_per_assignment": policy.max_files_per_assignment,
    }
    item = StoredFile.objects.create(
        id=file_id,
        course=course,
        uploader=actor,
        file_name=name,
        file_size=file_size,
        mime_type=mime_type,
        storage_path=f"quarantine/{course.id}/{file_id}/{name}",
        purpose=purpose,
        policy_snapshot=snapshot,
    )
    event("files.upload_intent_created", item, actor, uploader_id=str(actor.id))
    return {
        "file_id": str(item.id),
        "file_name": name,
        "file_size": file_size,
        "storage_path": item.storage_path,
        "status": item.status,
        "purpose": purpose,
        "expires_in_seconds": 900,
        "expires_at": item.expires_at,
    }


@transaction.atomic
def receive_upload(*, actor, file_id, content):
    actor = current_actor(actor)
    item, _ = locked_file(file_id)
    require_file_upload_permission(actor, item.course, item.purpose)
    if item.uploader_id != actor.id:
        raise DomainError("FORBIDDEN")
    if item.status != FileStatus.QUARANTINE_PENDING or item.expires_at <= timezone.now():
        raise DomainError("INVALID_FILE_STATE")
    if len(content) != item.file_size:
        raise DomainError("INVALID_FILE_SIZE")
    get_storage().save(item.storage_path, content)
    return item


@transaction.atomic
def commit_upload(*, actor, file_id, client_checksum=None, actual_size=None):
    actor = current_actor(actor)
    item, policy = locked_file(file_id)
    require_file_upload_permission(actor, item.course, item.purpose)
    if item.uploader_id != actor.id:
        raise DomainError("FORBIDDEN")
    if item.status in (FileStatus.SCANNING, FileStatus.CLEAN):
        if client_checksum and item.sha256_hash != client_checksum:
            raise DomainError("INVALID_FILE_STATE")
        return item
    if item.status != FileStatus.QUARANTINE_PENDING or item.expires_at <= timezone.now():
        raise DomainError("INVALID_FILE_STATE")
    storage = get_storage()
    if not storage.exists(item.storage_path):
        raise DomainError("FILE_NOT_FOUND")
    content = storage.read(item.storage_path)
    if len(content) != item.file_size or (actual_size is not None and actual_size != len(content)):
        raise DomainError("INVALID_FILE_SIZE")
    checksum = hashlib.sha256(content).hexdigest()
    if client_checksum and client_checksum != checksum:
        raise DomainError("INVALID_FILE_CHECKSUM")
    policy.reserved_quota_bytes -= item.file_size
    policy.used_quota_bytes += item.file_size
    policy.save(update_fields=["reserved_quota_bytes", "used_quota_bytes", "updated_at"])
    item.sha256_hash = checksum
    item.status = FileStatus.SCANNING
    item.save(update_fields=["sha256_hash", "status", "updated_at"])
    # The SCANNING row is the durable job. Celery beat retries it even if broker publication fails.
    event("files.upload_committed", item, actor, uploader_id=str(actor.id))
    return item


@transaction.atomic
def abort_upload_intent(*, file_id, actor=None, system_actor=""):
    if actor is not None:
        actor = current_actor(actor)
    elif system_actor != "cleanup_worker":
        raise DomainError("FORBIDDEN")
    item, policy = locked_file(file_id)
    if actor is not None:
        require_file_upload_permission(actor, item.course, item.purpose)
    if item.status == FileStatus.DELETED:
        return item
    get_storage().delete(item.storage_path)
    if item.status == FileStatus.QUARANTINE_PENDING:
        policy.reserved_quota_bytes -= item.file_size
    elif item.status in (FileStatus.SCANNING, FileStatus.CLEAN):
        policy.used_quota_bytes -= item.file_size
    policy.save(update_fields=["reserved_quota_bytes", "used_quota_bytes", "updated_at"])
    item.status = FileStatus.DELETED
    item.is_published = False
    item.save(update_fields=["status", "is_published", "updated_at"])
    event("files.upload_aborted", item, actor, system_actor)
    return item


def cleanup_expired_upload_intents(*, older_than_seconds=900):
    cutoff = timezone.now() - timedelta(seconds=older_than_seconds)
    ids = list(
        StoredFile.objects.filter(
            status=FileStatus.QUARANTINE_PENDING,
            created_at__lte=cutoff,
            expires_at__lte=timezone.now(),
        ).values_list("id", flat=True)[:100]
    )
    for file_id in ids:
        abort_upload_intent(file_id=file_id, system_actor="cleanup_worker")
    return len(ids)


@transaction.atomic
def scan_stored_file(*, file_id, scanner: BaseScannerEngine | None = None):
    item, policy = locked_file(file_id)
    if item.status != FileStatus.SCANNING:
        return item
    storage = get_storage()
    if not storage.exists(item.storage_path):
        policy.used_quota_bytes -= item.file_size
        policy.save(update_fields=["used_quota_bytes", "updated_at"])
        item.status = FileStatus.DELETED
        item.save(update_fields=["status", "updated_at"])
        return item
    content = storage.read(item.storage_path)
    if len(content) != item.file_size or hashlib.sha256(content).hexdigest() != item.sha256_hash:
        raise ValueError("Quarantined object integrity changed")
    verdict = (scanner or get_scanner_engine()).scan(content, item.file_name)
    FileScanResult.objects.create(
        file=item, scan_engine=verdict.engine, is_clean=verdict.is_clean, details=verdict.details
    )
    if verdict.is_clean:
        active_path = f"active/{item.id}/{item.sha256_hash}/{item.file_name}"
        # Keep source until DB commit: rollback never removes the only object copy.
        if not storage.exists(active_path):
            storage.save(active_path, content)
        elif storage.read(active_path) != content:
            raise ValueError("Active object integrity changed")
        old_path = item.storage_path
        item.storage_path = active_path
        item.status = FileStatus.CLEAN
        item.save(update_fields=["storage_path", "status", "updated_at"])
        transaction.on_commit(lambda: storage.delete(old_path), robust=True)
    else:
        storage.delete(item.storage_path)
        policy.used_quota_bytes -= item.file_size
        policy.save(update_fields=["used_quota_bytes", "updated_at"])
        item.status = FileStatus.INFECTED
        item.is_published = False
        item.save(update_fields=["status", "is_published", "updated_at"])
        event(
            "files.virus_detected",
            item,
            system_actor="scan_worker",
            threat_name=str(verdict.threat_name or "unknown")[:128],
        )
    return item
