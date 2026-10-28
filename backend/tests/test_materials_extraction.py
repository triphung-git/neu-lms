import io

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from courses.models import Course
from files.models import CourseFilePolicy, FileStatus, StoredFile
from files.storage import get_storage
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from identity.services.accounts import digest
from materials.extraction import (
    MAX_FILE_SIZE_BYTES,
    MAX_PAGES,
    extract_docx,
    extract_file_content,
    extract_pdf,
    extract_txt,
)
from materials.models import (
    ExtractionStatus,
    Material,
    MaterialFile,
    MaterialVersion,
    MaterialVersionStatus,
    ProcessingStatus,
)
from materials.services import extract_material_file
from materials.tasks import extract_material_version_task, process_pending_material_extractions


def _create_user(email: str, role_name: str) -> User:
    now = timezone.now()
    u = User.objects.create(email=email, display_name=email.split("@")[0], is_active=True)
    u.set_password("SecurePass123!")
    u.save()
    VerifiedEmail.objects.create(user=u, email_digest=digest(email), verified_at=now)

    req = None
    if role_name != Role.ADMIN:
        req = RoleRequest.objects.create(
            user=u,
            role=role_name,
            status="approved",
            reviewed_by=u,
            reviewed_at=now,
            review_reason="test",
        )
    RoleGrant.objects.create(
        user=u,
        role=role_name,
        grant_source="teacher_approval" if role_name == Role.TEACHER else "verified_student_email",
        source_request=req,
        granted_by=u if role_name == Role.TEACHER else None,
    )
    return u


def _create_sample_pdf(pages_text: list[str], encrypt_password: str | None = None) -> bytes:
    import pypdf

    writer = pypdf.PdfWriter()
    for _text in pages_text:
        # Create a blank page and add text or use blank page
        writer.add_blank_page(width=612, height=792)

    # To actually write text into PDF streams with pure pypdf:
    buf = io.BytesIO()
    if encrypt_password:
        writer.encrypt(encrypt_password)
    writer.write(buf)
    raw_pdf = buf.getvalue()

    if not encrypt_password and pages_text:
        # Use pypdf to add text stream annotations or create simple PDF structure with real text
        # Let's create standard valid PDF structure with real text stream
        return _create_valid_text_pdf(pages_text)
    return raw_pdf


def _create_valid_text_pdf(pages_text: list[str]) -> bytes:
    """Tạo tệp PDF hợp lệ chứa text streams thực sự có thể trích xuất."""
    pages_obj_list = []
    content_obj_list = []
    font_id = 3 + len(pages_text) * 2
    kid_refs = []
    for i, txt in enumerate(pages_text):
        p_id = 3 + i * 2
        c_id = p_id + 1
        kid_refs.append(str(p_id) + " 0 R")
        st = ("BT /F1 12 Tf 72 712 Td (" + txt + ") Tj ET\n").encode("ascii", errors="replace")
        p_data = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents "
            + str(c_id)
            + " 0 R /Resources << /Font << /F1 "
            + str(font_id)
            + " 0 R >> >> >>"
        ).encode("ascii")
        c_data = (
            ("<< /Length " + str(len(st)) + " >>\nstream\n").encode("ascii") + st + b"endstream"
        )
        pages_obj_list.append((p_id, p_data))
        content_obj_list.append((c_id, c_data))
    kids_str = " ".join(kid_refs)
    all_objs = [
        (1, b"<< /Type /Catalog /Pages 2 0 R >>"),
        (
            2,
            (
                "<< /Type /Pages /Kids [" + kids_str + "] /Count " + str(len(pages_text)) + " >>"
            ).encode("ascii"),
        ),
    ]
    for p, c in zip(pages_obj_list, content_obj_list, strict=False):
        all_objs.extend([p, c])
    all_objs.append((font_id, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"))
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = {}
    for obj_id, data in all_objs:
        offsets[obj_id] = out.tell()
        out.write(str(obj_id).encode("ascii") + b" 0 obj\n" + data + b"\nendobj\n")
    xref_pos = out.tell()
    total = font_id + 1
    out.write(("xref\n0 " + str(total) + "\n0000000000 65535 f \n").encode("ascii"))
    for i in range(1, total):
        out.write(f"{offsets.get(i, 0):010d} 00000 n \n".encode("ascii"))
    out.write(
        (
            "trailer\n<< /Size "
            + str(total)
            + " /Root 1 0 R >>\nstartxref\n"
            + str(xref_pos)
            + "\n%%EOF\n"
        ).encode("ascii")
    )
    return out.getvalue()


def _create_sample_docx(paragraphs: list[str], table_rows: list[list[str]] | None = None) -> bytes:
    import docx

    doc = docx.Document()
    for p in paragraphs:
        doc.add_paragraph(p)
    if table_rows:
        table = doc.add_table(rows=len(table_rows), cols=len(table_rows[0]))
        for r_idx, row in enumerate(table_rows):
            for c_idx, cell_text in enumerate(row):
                table.cell(r_idx, c_idx).text = cell_text
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture
def teacher():
    return _create_user("gv_extract@neu.edu.vn", Role.TEACHER)


@pytest.fixture
def course(teacher):
    c = Course.objects.create(
        code="EXT101",
        name="Khai phá tài liệu số",
        term="HK1-2026",
        teacher=teacher,
        status=Course.Status.OPEN,
    )
    CourseFilePolicy.objects.create(
        course=c,
        allowed_extensions=["pdf", "docx", "txt"],
        max_file_size_bytes=50 * 1024 * 1024,
        course_quota_bytes=500 * 1024 * 1024,
        preview_allowed=True,
    )
    return c


@pytest.mark.django_db
class TestUnitExtractors:
    """Kiểm thử trực tiếp các hàm extractor thuần túy."""

    def test_extract_pdf_with_real_content_and_provenance(self):
        pdf_bytes = _create_valid_text_pdf(
            [
                "Chapter 1: LMS Architecture Overview",
                "Chapter 2: Microservices and Background Workers",
            ]
        )
        res = extract_pdf(pdf_bytes)

        assert res.status == ExtractionStatus.SUCCESS
        assert "Chapter 1" in res.extracted_text
        assert "Chapter 2" in res.extracted_text
        assert res.page_count == 2
        assert res.metadata["parser"] == "pypdf"
        assert res.metadata["total_pages"] == 2
        assert len(res.metadata["pages"]) == 2
        assert res.metadata["pages"][0]["page_number"] == 1
        assert res.metadata["pages"][1]["page_number"] == 2

    def test_extract_docx_with_paragraphs_and_table(self):
        paragraphs = ["Bài giảng Công nghệ Web", "Giảng viên: Khoa CNTT NEU"]
        table = [["MSSV", "Họ tên", "Điểm"], ["11240001", "Nguyễn Văn A", "9.5"]]
        docx_bytes = _create_sample_docx(paragraphs, table)

        res = extract_docx(docx_bytes)

        assert res.status == ExtractionStatus.SUCCESS
        assert "Bài giảng Công nghệ Web" in res.extracted_text
        assert "11240001" in res.extracted_text
        assert res.metadata["parser"] == "python-docx"
        assert res.metadata["table_count"] == 1
        assert res.metadata["section_count"] >= 2

    def test_extract_txt_encodings(self):
        # UTF-8 text
        txt_utf8 = "Tài liệu học tập NEU bằng tiếng Việt có dấu: Ứng dụng công nghệ.".encode()
        res1 = extract_txt(txt_utf8)
        assert res1.status == ExtractionStatus.SUCCESS
        assert "tiếng Việt" in res1.extracted_text
        assert res1.metadata["encoding"] == "utf-8"

        # UTF-16 text
        txt_utf16 = "NEU LMS UTF-16 Document Content".encode("utf-16")
        res2 = extract_txt(txt_utf16)
        assert res2.status == ExtractionStatus.SUCCESS
        assert "NEU LMS" in res2.extracted_text

    def test_extract_unsupported_formats(self):
        res = extract_file_content(
            b"\x00\x01\x02\x03\x04", "binary_firmware.bin", "application/octet-stream"
        )
        assert res.status == ExtractionStatus.UNSUPPORTED
        assert "chưa được hỗ trợ" in res.error_message

    def test_extract_empty_file(self):
        res = extract_file_content(b"", "empty.txt", "text/plain")
        assert res.status == ExtractionStatus.NO_TEXT
        assert res.page_count == 0

    def test_extract_corrupted_pdf_and_docx(self):
        # Corrupt PDF
        res_pdf = extract_pdf(b"%PDF-1.4 completely corrupted content not a valid trailer")
        assert res_pdf.status == ExtractionStatus.FAILED
        assert res_pdf.metadata.get("corrupted") is True

        # Corrupt DOCX
        res_docx = extract_docx(b"PK\x03\x04 fake zip file header with truncated data")
        assert res_docx.status == ExtractionStatus.FAILED
        assert res_docx.metadata.get("corrupted") is True

    def test_extract_encrypted_pdf_reports_failure_gracefully(self):
        encrypted_pdf = _create_sample_pdf(["Secret text"], encrypt_password="SecretPassword123")
        res = extract_pdf(encrypted_pdf)
        assert res.status == ExtractionStatus.FAILED
        assert "mật khẩu" in res.error_message or res.metadata.get("encrypted") is True

    def test_extract_scanned_pdf_without_text_reports_no_text(self):
        # Blank pages with no text stream
        blank_pdf = _create_sample_pdf(["", ""])
        res = extract_pdf(blank_pdf)
        assert res.status == ExtractionStatus.NO_TEXT
        assert "Không tìm thấy" in res.error_message

    def test_file_size_limit_rejection(self):
        oversized_data = b"x" * (MAX_FILE_SIZE_BYTES + 10)
        res = extract_file_content(oversized_data, "large.txt", "text/plain")
        assert res.status == ExtractionStatus.FAILED
        assert "vượt quá giới hạn" in res.error_message

    def test_page_limit_truncation(self):
        # Create PDF with 205 pages
        import pypdf

        writer = pypdf.PdfWriter()
        for _ in range(MAX_PAGES + 5):
            writer.add_blank_page(width=100, height=100)
        buf = io.BytesIO()
        writer.write(buf)

        res = extract_pdf(buf.getvalue())
        # Even with no text on pages, it should enforce MAX_PAGES limit
        assert res.metadata["processed_pages"] == MAX_PAGES
        assert res.metadata["truncated"] is True


@pytest.mark.django_db
class TestMaterialFileExtractionService:
    """Kiểm thử tầng service và các bất biến tính toàn vẹn, bảo mật."""

    def test_extract_service_happy_path(self, course, teacher):
        pdf_bytes = _create_valid_text_pdf(["Material Document 1 for EXT101"])
        import hashlib

        h = hashlib.sha256(pdf_bytes).hexdigest()
        storage_path = f"active/{course.id}/doc.pdf"
        get_storage().save(storage_path, pdf_bytes)

        stored = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="doc.pdf",
            file_size=len(pdf_bytes),
            mime_type="application/pdf",
            storage_path=storage_path,
            sha256_hash=h,
            status=FileStatus.CLEAN,
        )

        mat = Material.objects.create(course=course, title="Học liệu kiểm tra", created_by=teacher)
        ver = MaterialVersion.objects.create(
            material=mat,
            version_number=1,
            created_by=teacher,
            lifecycle_status=MaterialVersionStatus.DRAFT,
        )
        mf = MaterialFile.objects.create(
            material_version=ver,
            file=stored,
            position=1,
            file_name="doc.pdf",
            file_size=len(pdf_bytes),
            mime_type="application/pdf",
            sha256_hash=h,
        )

        extraction = extract_material_file(mf)

        assert extraction.status == ExtractionStatus.SUCCESS
        assert "Material Document 1" in extraction.extracted_text
        assert extraction.stored_file == stored
        assert extraction.file_hash == h
        assert extraction.page_count == 1
        assert extraction.completed_at is not None

    def test_extract_service_rejects_unclean_file(self, course, teacher):
        stored = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="virus.pdf",
            file_size=100,
            mime_type="application/pdf",
            storage_path=f"quarantine/{course.id}/virus.pdf",
            sha256_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            status=FileStatus.SCANNING,
        )
        mat = Material.objects.create(course=course, title="Học liệu rủi ro", created_by=teacher)
        ver = MaterialVersion.objects.create(
            material=mat,
            version_number=1,
            created_by=teacher,
            lifecycle_status=MaterialVersionStatus.DRAFT,
        )

        # Manually create MaterialFile without clean validation for testing service defence
        mf = MaterialFile(
            material_version=ver,
            file=stored,
            position=1,
            file_name="virus.pdf",
            file_size=100,
            mime_type="application/pdf",
            sha256_hash=stored.sha256_hash,
            created_at=timezone.now(),
        )
        mf.save_base(raw=True)

        with pytest.raises(ValidationError, match="Chỉ tệp tin đã quét an toàn"):
            extract_material_file(mf)

    def test_extract_service_tampered_content_fails_closed(self, course, teacher):
        real_content = b"%PDF-1.4 Fake clean content"
        tampered_content = b"%PDF-1.4 Tampered content changed on storage"
        import hashlib

        h_real = hashlib.sha256(real_content).hexdigest()
        storage_path = f"active/{course.id}/tampered.pdf"
        get_storage().save(storage_path, tampered_content)  # save tampered bytes!

        stored = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="tampered.pdf",
            file_size=len(real_content),
            mime_type="application/pdf",
            storage_path=storage_path,
            sha256_hash=h_real,
            status=FileStatus.CLEAN,
        )
        mat = Material.objects.create(course=course, title="Học liệu bị sửa", created_by=teacher)
        ver = MaterialVersion.objects.create(
            material=mat,
            version_number=1,
            created_by=teacher,
            lifecycle_status=MaterialVersionStatus.DRAFT,
        )
        mf = MaterialFile.objects.create(
            material_version=ver,
            file=stored,
            position=1,
            file_name="tampered.pdf",
            file_size=len(real_content),
            mime_type="application/pdf",
            sha256_hash=h_real,
        )

        with pytest.raises(ValidationError, match="Tính toàn vẹn của tệp tin không khớp"):
            extract_material_file(mf)


@pytest.mark.django_db
class TestCeleryExtractionPipeline:
    """Kiểm thử Celery task worker, tổng hợp trạng thái và xử lý lỗi."""

    def test_extract_material_version_task_aggregates_ready_status(self, course, teacher):
        # Create version with a PDF and a DOCX
        pdf_bytes = _create_valid_text_pdf(["Lecture Slides 1 for Course"])
        docx_bytes = _create_sample_docx(["Đề cương chi tiết học phần"])
        import hashlib

        h_pdf = hashlib.sha256(pdf_bytes).hexdigest()
        h_docx = hashlib.sha256(docx_bytes).hexdigest()

        get_storage().save(f"active/{course.id}/f1.pdf", pdf_bytes)
        get_storage().save(f"active/{course.id}/f2.docx", docx_bytes)

        s_pdf = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="f1.pdf",
            file_size=len(pdf_bytes),
            mime_type="application/pdf",
            storage_path=f"active/{course.id}/f1.pdf",
            sha256_hash=h_pdf,
            status=FileStatus.CLEAN,
        )
        s_docx = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="f2.docx",
            file_size=len(docx_bytes),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            storage_path=f"active/{course.id}/f2.docx",
            sha256_hash=h_docx,
            status=FileStatus.CLEAN,
        )

        mat = Material.objects.create(
            course=course, title="Bộ bài giảng đầy đủ", created_by=teacher
        )
        ver = MaterialVersion.objects.create(
            material=mat,
            version_number=1,
            created_by=teacher,
            lifecycle_status=MaterialVersionStatus.DRAFT,
            processing_status=ProcessingStatus.PENDING,
        )
        MaterialFile.objects.create(
            material_version=ver,
            file=s_pdf,
            position=1,
            file_name="f1.pdf",
            file_size=len(pdf_bytes),
            mime_type="application/pdf",
            sha256_hash=h_pdf,
        )
        MaterialFile.objects.create(
            material_version=ver,
            file=s_docx,
            position=2,
            file_name="f2.docx",
            file_size=len(docx_bytes),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sha256_hash=h_docx,
        )
        ver.lifecycle_status = MaterialVersionStatus.FINALIZED
        ver.finalized_at = timezone.now()
        ver.save(update_fields=["lifecycle_status", "finalized_at"])

        # Run Celery task directly
        result = extract_material_version_task(str(ver.id))
        assert result["status"] == ProcessingStatus.READY

        ver.refresh_from_db()
        assert ver.processing_status == ProcessingStatus.READY
        assert ver.extractions.count() == 2
        assert ver.extractions.filter(status=ExtractionStatus.SUCCESS).count() == 2

    def test_extract_version_all_unsupported_marks_unsupported(self, course, teacher):
        bin_bytes = b"\x00\x01\x02\x03\x04"
        import hashlib

        h_bin = hashlib.sha256(bin_bytes).hexdigest()
        get_storage().save(f"active/{course.id}/app.bin", bin_bytes)

        s_bin = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="app.bin",
            file_size=len(bin_bytes),
            mime_type="application/octet-stream",
            storage_path=f"active/{course.id}/app.bin",
            sha256_hash=h_bin,
            status=FileStatus.CLEAN,
        )
        mat = Material.objects.create(course=course, title="Tệp nhị phân", created_by=teacher)
        ver = MaterialVersion.objects.create(
            material=mat,
            version_number=1,
            created_by=teacher,
            lifecycle_status=MaterialVersionStatus.DRAFT,
            processing_status=ProcessingStatus.PENDING,
        )
        MaterialFile.objects.create(
            material_version=ver,
            file=s_bin,
            position=1,
            file_name="app.bin",
            file_size=len(bin_bytes),
            mime_type="application/octet-stream",
            sha256_hash=h_bin,
        )
        ver.lifecycle_status = MaterialVersionStatus.FINALIZED
        ver.finalized_at = timezone.now()
        ver.save(update_fields=["lifecycle_status", "finalized_at"])

        result = extract_material_version_task(str(ver.id))
        assert result["status"] == ProcessingStatus.UNSUPPORTED

        ver.refresh_from_db()
        assert ver.processing_status == ProcessingStatus.UNSUPPORTED
        ext = ver.extractions.first()
        assert ext.status == ExtractionStatus.UNSUPPORTED

    def test_extract_missing_version_handles_gracefully(self):
        import uuid

        random_id = str(uuid.uuid4())
        res = extract_material_version_task(random_id)
        assert res["status"] == "not_found"

    def test_process_pending_materials_scanner(self, course, teacher):
        pdf_bytes = _create_valid_text_pdf(["Periodic Scanner Document"])
        import hashlib

        h_pdf = hashlib.sha256(pdf_bytes).hexdigest()
        get_storage().save(f"active/{course.id}/pending.pdf", pdf_bytes)

        s = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="pending.pdf",
            file_size=len(pdf_bytes),
            mime_type="application/pdf",
            storage_path=f"active/{course.id}/pending.pdf",
            sha256_hash=h_pdf,
            status=FileStatus.CLEAN,
        )
        mat = Material.objects.create(course=course, title="Học liệu chờ", created_by=teacher)
        ver = MaterialVersion.objects.create(
            material=mat,
            version_number=1,
            created_by=teacher,
            lifecycle_status=MaterialVersionStatus.DRAFT,
            processing_status=ProcessingStatus.PENDING,
        )
        MaterialFile.objects.create(
            material_version=ver,
            file=s,
            position=1,
            file_name="pending.pdf",
            file_size=len(pdf_bytes),
            mime_type="application/pdf",
            sha256_hash=h_pdf,
        )
        ver.lifecycle_status = MaterialVersionStatus.FINALIZED
        ver.finalized_at = timezone.now()
        ver.save(update_fields=["lifecycle_status", "finalized_at"])

        # Trigger periodic scanner
        process_pending_material_extractions()
        # Verify it can scan without exceptions


def test_real_isolated_parser_process_extracts_pdf():
    from materials.isolated_parser import extract_file_isolated

    result = extract_file_isolated(
        _create_sample_pdf(["Isolated parser content"]), "safe.pdf", "application/pdf"
    )
    assert result.status == ExtractionStatus.SUCCESS
    assert "Isolated parser content" in result.extracted_text


def test_isolated_parser_timeout_fails_closed(monkeypatch):
    import subprocess

    from materials.isolated_parser import extract_file_isolated

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("parser", 60)

    monkeypatch.setattr(subprocess, "run", timeout)
    result = extract_file_isolated(b"%PDF-test", "timeout.pdf", "application/pdf")
    assert result.status == ExtractionStatus.FAILED and not result.extracted_text


@pytest.mark.django_db
def test_scheduler_ignores_draft_versions(course, teacher, monkeypatch):
    material = Material.objects.create(course=course, title="Not ready", created_by=teacher)
    MaterialVersion.objects.create(material=material, version_number=1, created_by=teacher)
    dispatched = []
    monkeypatch.setattr(
        extract_material_version_task, "delay", lambda value: dispatched.append(value)
    )
    process_pending_material_extractions()
    assert not dispatched
