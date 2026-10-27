from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone

from courses.models import Course
from files.constants import DEFAULT_COURSE_QUOTA_BYTES
from files.models import CourseFilePolicy, FileScanResult, FileStatus, StoredFile
from files.scanner import (
    EICAR_SIGNATURE,
    ELF_MAGIC,
    PE_MAGIC,
    MockScanner,
)
from files.services import (
    commit_upload,
    create_upload_intent,
    scan_stored_file,
)
from files.storage import get_storage
from identity.models import RoleGrant, RoleRequest, VerifiedEmail
from identity.services.common import digest
from platform_core.models import AuditEvent

User = get_user_model()


def make_test_teacher(email: str = "teacher_scan@neu.edu.vn") -> User:
    now = timezone.now()
    user = User.objects.create_user(
        email=email,
        password="ValidPassword123!",
        display_name="TS. Giảng Viên Scan",
    )
    VerifiedEmail.objects.create(
        user=user,
        email_digest=digest(user.email),
        verified_at=now,
    )
    req = RoleRequest.objects.create(
        user=user,
        role="teacher",
        status="approved",
        reviewed_by=user,
        reviewed_at=now,
        review_reason="test_setup",
    )
    RoleGrant.objects.create(
        user=user,
        role="teacher",
        grant_source="teacher_approval",
        source_request=req,
        granted_by=user,
    )
    return user


@pytest.fixture
def teacher(db):
    return make_test_teacher()


@pytest.fixture
def course(teacher):
    c = Course.objects.create(
        code="CS-SCAN-101",
        name="An toàn và bảo mật hệ thống",
        term="HK1-2026",
        teacher=teacher,
        enrollment_open=True,
    )
    CourseFilePolicy.objects.create(
        course=c,
        max_file_size_bytes=10 * 1024 * 1024,
        course_quota_bytes=DEFAULT_COURSE_QUOTA_BYTES,
        allowed_extensions=["pdf", "docx", "zip", "png", "jpg"],
    )
    return c


@pytest.mark.django_db
class TestFileScanningService:
    def test_scan_clean_pdf_file_success(self, teacher, course):
        pdf_content = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="lecture_clean.pdf",
            file_size=len(pdf_content),
        )

        storage = get_storage()
        storage.save(intent["storage_path"], pdf_content)

        committed = commit_upload(
            actor=teacher,
            file_id=intent["file_id"],
            client_checksum=__import__("hashlib").sha256(pdf_content).hexdigest(),
        )
        assert committed.status == FileStatus.SCANNING

        # Thực thi quét
        scanned = scan_stored_file(file_id=committed.id)

        assert scanned.status == FileStatus.CLEAN
        assert scanned.storage_path.startswith("active/")
        assert storage.exists(scanned.storage_path) is True
        assert storage.exists(intent["storage_path"]) is True  # retained until DB commit

        # clean != published
        assert scanned.is_published is False

        # Kiểm tra kết quả quét lưu trong DB
        scan_result = FileScanResult.objects.get(file=scanned)
        assert scan_result.is_clean is True
        assert scan_result.scan_engine == "builtin_signature"

        # Quota vẫn ghi nhận used_quota_bytes
        policy = CourseFilePolicy.objects.get(course=course)
        assert policy.used_quota_bytes == len(pdf_content)
        assert policy.reserved_quota_bytes == 0

    def test_scan_disguised_executable_pe_detected(self, teacher, course):
        # Tệp đuôi .pdf nhưng bắt đầu bằng PE/MZ magic bytes
        fake_pe_content = PE_MAGIC + b"\x90\x00\x03\x00\x00\x00\x04\x00This is malicious PE exe"
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="trojan.pdf",
            file_size=len(fake_pe_content),
        )

        storage = get_storage()
        storage.save(intent["storage_path"], fake_pe_content)

        committed = commit_upload(actor=teacher, file_id=intent["file_id"])
        assert committed.status == FileStatus.SCANNING

        policy_before = CourseFilePolicy.objects.get(course=course)
        assert policy_before.used_quota_bytes == len(fake_pe_content)

        # Thực thi quét
        scanned = scan_stored_file(file_id=committed.id)

        assert scanned.status == FileStatus.INFECTED
        assert storage.exists(intent["storage_path"]) is False

        # Quota được hoàn trả ngay lập tức
        policy_after = CourseFilePolicy.objects.get(course=course)
        assert policy_after.used_quota_bytes == 0

        # Kiểm tra kết quả quét
        scan_result = FileScanResult.objects.get(file=scanned)
        assert scan_result.is_clean is False
        assert scan_result.details.get("threat_type") == "disguised_executable"

        # Kiểm tra AuditEvent an ninh được phát sinh
        event = AuditEvent.objects.filter(
            action="files.virus_detected",
            resource_id=str(scanned.id),
        ).first()
        assert event is not None
        assert event.system_actor == "scan_worker"
        assert event.metadata["threat_name"] == "Disguised-Binary-Executable-PE"

    def test_scan_disguised_executable_elf_detected(self, teacher, course):
        # Tệp đuôi .docx nhưng bắt đầu bằng Linux ELF magic bytes
        fake_elf_content = ELF_MAGIC + b"\x02\x01\x01\x00Linux binary in disguise"
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="assignment.docx",
            file_size=len(fake_elf_content),
        )

        storage = get_storage()
        storage.save(intent["storage_path"], fake_elf_content)

        committed = commit_upload(actor=teacher, file_id=intent["file_id"])

        scanned = scan_stored_file(file_id=committed.id)

        assert scanned.status == FileStatus.INFECTED
        assert storage.exists(intent["storage_path"]) is False

        scan_result = FileScanResult.objects.get(file=scanned)
        assert scan_result.is_clean is False
        assert "ELF" in scan_result.details.get("signature", "")

    def test_scan_mime_mismatch_disguised_file(self, teacher, course):
        # Tệp .pdf nhưng nội dung text thường không có %PDF- magic bytes
        plain_content = b"This is plain text with no PDF headers whatsoever"
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="fake.pdf",
            file_size=len(plain_content),
        )

        storage = get_storage()
        storage.save(intent["storage_path"], plain_content)

        committed = commit_upload(actor=teacher, file_id=intent["file_id"])
        scanned = scan_stored_file(file_id=committed.id)

        assert scanned.status == FileStatus.INFECTED
        scan_result = FileScanResult.objects.get(file=scanned)
        assert scan_result.is_clean is False
        assert scan_result.details.get("expected_mime") == "application/pdf"

    def test_scan_eicar_test_virus_detected(self, teacher, course):
        # Tệp zip chứa chuỗi EICAR test string
        eicar_content = b"PK\x03\x04" + EICAR_SIGNATURE
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="eicar_test.zip",
            file_size=len(eicar_content),
        )

        storage = get_storage()
        storage.save(intent["storage_path"], eicar_content)

        committed = commit_upload(actor=teacher, file_id=intent["file_id"])
        scanned = scan_stored_file(file_id=committed.id)

        assert scanned.status == FileStatus.INFECTED
        assert storage.exists(intent["storage_path"]) is False

        scan_result = FileScanResult.objects.get(file=scanned)
        assert scan_result.is_clean is False
        assert scan_result.details.get("threat_type") == "virus_test_signature"

    def test_scan_missing_storage_file_handles_gracefully(self, teacher, course):
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="ghost.pdf",
            file_size=len(b"%PDF-dummy"),
        )
        storage = get_storage()
        storage.save(intent["storage_path"], b"%PDF-dummy")
        committed = commit_upload(actor=teacher, file_id=intent["file_id"])

        # Giả lập file vật lý bị xóa trước khi worker quét
        storage.delete(intent["storage_path"])

        scanned = scan_stored_file(file_id=committed.id)
        assert scanned.status == FileStatus.DELETED

        policy = CourseFilePolicy.objects.get(course=course)
        assert policy.used_quota_bytes == 0

    def test_scan_non_scanning_status_noop(self, teacher, course):
        # Tệp ở trạng thái QUARANTINE_PENDING chưa commit
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="pending.pdf",
            file_size=500,
        )
        scanned = scan_stored_file(file_id=intent["file_id"])
        assert scanned.status == FileStatus.QUARANTINE_PENDING

    def test_mock_scanner_exception_keeps_state_safe(self, teacher, course):
        pdf_content = b"%PDF-1.4 sample content"
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="timeout.pdf",
            file_size=len(pdf_content),
        )
        storage = get_storage()
        storage.save(intent["storage_path"], pdf_content)
        committed = commit_upload(actor=teacher, file_id=intent["file_id"])

        mock_scanner = MockScanner(force_exception=TimeoutError("ClamAV socket timeout"))

        with pytest.raises(TimeoutError):
            scan_stored_file(file_id=committed.id, scanner=mock_scanner)

        # File vẫn giữ nguyên trạng thái SCANNING trong quarantine, transaction rollback
        refreshed = StoredFile.objects.get(id=committed.id)
        assert refreshed.status == FileStatus.SCANNING
        assert storage.exists(intent["storage_path"]) is True


@pytest.mark.django_db
class TestProcessQuarantineScansCommand:
    def test_command_processes_batch(self, teacher, course):
        storage = get_storage()

        # 1 clean file
        pdf_content = b"%PDF-1.4 Clean Document"
        intent_clean = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="clean_batch.pdf",
            file_size=len(pdf_content),
        )
        storage.save(intent_clean["storage_path"], pdf_content)
        commit_upload(actor=teacher, file_id=intent_clean["file_id"])

        # 1 infected file (PE)
        pe_content = PE_MAGIC + b"malicious binary"
        intent_infected = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="infected_batch.pdf",
            file_size=len(pe_content),
        )
        storage.save(intent_infected["storage_path"], pe_content)
        commit_upload(actor=teacher, file_id=intent_infected["file_id"])

        out = StringIO()
        call_command("process_quarantine_scans", engine="builtin", limit=10, stdout=out)
        output = out.getvalue()

        assert "Found 2 files in SCANNING state" in output
        assert "1 clean, 1 infected, 0 errors" in output

        f_clean = StoredFile.objects.get(id=intent_clean["file_id"])
        f_infected = StoredFile.objects.get(id=intent_infected["file_id"])

        assert f_clean.status == FileStatus.CLEAN
        assert f_infected.status == FileStatus.INFECTED


@pytest.mark.django_db
def test_failed_scan_batch_does_not_starve_later_uploads(teacher, course, monkeypatch):
    from files.tasks import process_pending_files

    rows = [
        StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name=f"waiting-{number}.pdf",
            file_size=1,
            storage_path=f"quarantine/test-fairness-{number}",
            status=FileStatus.SCANNING,
        )
        for number in range(51)
    ]
    failed_ids = {item.id for item in rows[:50]}

    def scan(*, file_id):
        if file_id in failed_ids:
            raise OSError("Temporary scan outage")
        StoredFile.objects.filter(pk=file_id).update(status=FileStatus.CLEAN)

    monkeypatch.setattr("files.services.scan_stored_file", scan)
    process_pending_files()
    process_pending_files()
    rows[-1].refresh_from_db()
    assert rows[-1].status == FileStatus.CLEAN
    assert StoredFile.objects.filter(pk__in=failed_ids, status=FileStatus.SCANNING).count() == 50
