import io

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from courses.models import Course, Membership
from files.models import CourseFilePolicy, FileStatus, StoredFile
from files.storage import get_storage
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from identity.services.accounts import digest
from materials.search import search_materials
from materials.services import (
    create_material,
    extract_material_file,
    finalize_material_version,
    hide_material,
    publish_material_version,
)


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
    grant_src = (
        "internal_administration"
        if role_name == Role.ADMIN
        else ("teacher_approval" if role_name == Role.TEACHER else "verified_student_email")
    )
    RoleGrant.objects.create(
        user=u,
        role=role_name,
        grant_source=grant_src,
        source_request=req,
        granted_by=u if role_name == Role.TEACHER else None,
    )
    return u


def _create_valid_text_pdf(pages_text: list[str]) -> bytes:
    """Tạo tệp PDF hợp lệ chứa text stream có thể trích xuất."""
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


@pytest.fixture
def teacher():
    return _create_user("teacher_search@neu.edu.vn", Role.TEACHER)


@pytest.fixture
def other_teacher():
    return _create_user("other_teacher@neu.edu.vn", Role.TEACHER)


@pytest.fixture
def student():
    return _create_user("student_search@neu.edu.vn", Role.STUDENT)


@pytest.fixture
def admin_user():
    return _create_user("admin_search@neu.edu.vn", Role.ADMIN)


@pytest.fixture
def course(teacher):
    c = Course.objects.create(
        code="SEARCH101",
        name="Tìm kiếm và Khai phá Dữ liệu",
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


@pytest.fixture
def course_b(teacher):
    c = Course.objects.create(
        code="SEARCH202",
        name="Hệ cơ sở dữ liệu phân tán",
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


@pytest.fixture
def student_membership(course, student):
    return Membership.objects.create(
        course=course, student=student, status=Membership.Status.ACTIVE
    )


@pytest.fixture
def student_membership_b(course_b, student):
    return Membership.objects.create(
        course=course_b, student=student, status=Membership.Status.ACTIVE
    )


def _setup_material_with_content(course, teacher, title, desc, tags, pdf_texts, is_published=True):
    pdf_bytes = _create_valid_text_pdf(pdf_texts)
    import hashlib

    h = hashlib.sha256(pdf_bytes).hexdigest()
    storage_path = f"active/{course.id}/{title.replace(' ', '_')}.pdf"
    get_storage().save(storage_path, pdf_bytes)

    sfile = StoredFile.objects.create(
        course=course,
        uploader=teacher,
        file_name=f"{title.replace(' ', '_')}.pdf",
        file_size=len(pdf_bytes),
        mime_type="application/pdf",
        storage_path=storage_path,
        sha256_hash=h,
        status=FileStatus.CLEAN,
    )

    mat, ver = create_material(
        course=course,
        teacher=teacher,
        title=title,
        description=desc,
        tags=tags,
        initial_file_ids=[sfile.id],
    )

    mf = ver.material_files.first()
    extract_material_file(mf)
    fin_ver = finalize_material_version(ver, teacher)

    if is_published:
        mat = publish_material_version(mat, fin_ver, teacher)

    return mat, fin_ver


@pytest.mark.django_db
class TestMaterialSearchPermissions:
    """Kiểm thử ma trận phân quyền và cách ly dữ liệu tìm kiếm."""

    def test_teacher_can_search_draft_published_and_hidden(self, course, teacher):
        mat_pub, _ = _setup_material_with_content(
            course,
            teacher,
            "Public Arch Guide",
            "Public material",
            ["arch"],
            ["Chapter 1 Architecture"],
        )
        mat_hid, _ = _setup_material_with_content(
            course,
            teacher,
            "Hidden Secret Arch",
            "Hidden material",
            ["arch"],
            ["Chapter 2 Secret Architecture"],
        )
        hide_material(mat_hid, teacher)

        results = search_materials(teacher, q="Architecture", course_id=str(course.id))
        titles = [r["title"] for r in results]

        assert "Public Arch Guide" in titles
        assert "Hidden Secret Arch" in titles

    def test_student_only_sees_published_and_not_hidden(
        self, course, teacher, student, student_membership
    ):
        mat_pub, _ = _setup_material_with_content(
            course, teacher, "Public Student Guide", "Visible", ["guide"], ["Visible Content"]
        )
        mat_hid, _ = _setup_material_with_content(
            course, teacher, "Hidden Faculty Guide", "Hidden", ["guide"], ["Hidden Content"]
        )
        hide_material(mat_hid, teacher)

        # Tạo thêm 1 bản nháp chưa công bố
        mat_draft, _ = _setup_material_with_content(
            course,
            teacher,
            "Draft Faculty Guide",
            "Draft",
            ["guide"],
            ["Draft Content"],
            is_published=False,
        )

        results = search_materials(student, q="Guide", course_id=str(course.id))
        titles = [r["title"] for r in results]

        assert "Public Student Guide" in titles
        assert "Hidden Faculty Guide" not in titles
        assert "Draft Faculty Guide" not in titles

    def test_withdrawn_student_loses_search_access_immediately(
        self, course, teacher, student, student_membership
    ):
        _setup_material_with_content(
            course, teacher, "Enrolled Student Doc", "Docs", ["study"], ["Study Content"]
        )

        # Khi active -> tìm thấy
        res1 = search_materials(student, q="Student", course_id=str(course.id))
        assert len(res1) == 1

        # Rút khỏi môn học
        student_membership.status = Membership.Status.WITHDRAWN
        student_membership.save(update_fields=["status"])

        # Tìm kiếm tiếp theo lập tức bị chặn (0 kết quả)
        res2 = search_materials(student, q="Student", course_id=str(course.id))
        assert len(res2) == 0

    def test_admin_only_cannot_search_course_materials(self, course, teacher, admin_user):
        _setup_material_with_content(
            course, teacher, "Admin Secret Test", "Desc", ["test"], ["Admin Cannot See This"]
        )
        results = search_materials(admin_user, q="Admin", course_id=str(course.id))
        assert len(results) == 0

    def test_other_teacher_cannot_search_alien_course(self, course, teacher, other_teacher):
        _setup_material_with_content(
            course,
            teacher,
            "Course Proprietary Slides",
            "Proprietary",
            ["slides"],
            ["Lecture Text"],
        )
        results = search_materials(other_teacher, q="Proprietary", course_id=str(course.id))
        assert len(results) == 0


@pytest.mark.django_db
class TestSearchMetadataAndBodyProvenance:
    """Kiểm thử tìm kiếm tiêu đề, mô tả, tệp và phân rã provenance theo trang."""

    def test_search_by_title_ranks_higher_than_body(self, course, teacher):
        # Mat A khớp ở Title
        mat_a, _ = _setup_material_with_content(
            course,
            teacher,
            "Microservices Deep Dive",
            "Overview document",
            ["sys"],
            ["General software engineering"],
        )
        # Mat B chỉ khớp ở Body
        mat_b, _ = _setup_material_with_content(
            course,
            teacher,
            "Database Design",
            "Relational models",
            ["db"],
            ["This chapter covers microservices architectural patterns"],
        )

        results = search_materials(teacher, q="Microservices", course_id=str(course.id))
        assert len(results) == 2
        assert results[0]["id"] == mat_a.id
        assert results[0]["rank"] > results[1]["rank"]

        # Kiểm tra match types
        match_types_a = [m["match_type"] for m in results[0]["matches"]]
        assert "title" in match_types_a

        match_types_b = [m["match_type"] for m in results[1]["matches"]]
        assert "body" in match_types_b

    def test_search_body_extracts_page_provenance_and_snippet(self, course, teacher):
        mat, _ = _setup_material_with_content(
            course,
            teacher,
            "Advanced Cloud Concepts",
            "Syllabus",
            ["cloud"],
            ["Page 1 is introduction", "Page 2 covers Kubernetes orchestration in depth"],
        )

        results = search_materials(teacher, q="Kubernetes", course_id=str(course.id))
        assert len(results) == 1
        body_matches = [m for m in results[0]["matches"] if m["match_type"] == "body"]
        assert len(body_matches) >= 1
        bm = body_matches[0]
        assert bm["page_number"] == 2
        assert "Kubernetes" in bm["snippet"]


@pytest.mark.django_db
class TestPreviewOffSecurityInvariant:
    """Bất biến an toàn: Khi preview_allowed == False, sinh viên không thể rò rỉ nội dung tệp."""

    def test_preview_off_blocks_student_body_matching_and_snippets(
        self, course, teacher, student, student_membership
    ):
        policy = CourseFilePolicy.objects.get(course=course)
        policy.preview_allowed = False
        policy.save(update_fields=["preview_allowed"])

        # Tài liệu có title không chứa từ 'Quantum', nhưng trong body text có 'Quantum Computation'
        mat, _ = _setup_material_with_content(
            course,
            teacher,
            "Modern Physics Lecture",
            "General physics summary",
            ["physics"],
            ["Quantum Computation and Superposition Algorithms"],
        )

        # 1. Sinh viên tìm từ 'Quantum' -> Không được match vào body text -> Trả về rỗng!
        res_stu = search_materials(student, q="Quantum", course_id=str(course.id))
        assert len(res_stu) == 0

        # 2. Giảng viên tìm từ 'Quantum' -> Vẫn tìm thấy vì giảng viên sở hữu môn học
        res_teacher = search_materials(teacher, q="Quantum", course_id=str(course.id))
        assert len(res_teacher) == 1
        assert res_teacher[0]["id"] == mat.id

        # 3. Sinh viên tìm 'Physics' (khớp Title) -> Thấy, nhưng KHÔNG có snippet từ body
        res_title = search_materials(student, q="Physics", course_id=str(course.id))
        assert len(res_title) == 1
        body_matches = [m for m in res_title[0]["matches"] if m["match_type"] == "body"]
        assert len(body_matches) == 0


@pytest.mark.django_db
class TestCrossCourseAndSearchAPIEndpoints:
    """Kiểm thử qua HTTP API Client và tìm kiếm đa môn học."""

    def test_course_search_endpoint(self, course, teacher):
        _setup_material_with_content(
            course,
            teacher,
            "API Endpoint Lecture",
            "Description",
            ["api"],
            ["REST API Design Principles"],
        )

        client = APIClient()
        client.force_authenticate(user=teacher)

        url = f"/api/v1/courses/{course.id}/materials/search?q=REST"
        resp = client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        data = resp.json()
        assert data["pagination"]["total_items"] == 1
        assert data["items"][0]["title"] == "API Endpoint Lecture"
        assert len(data["items"][0]["matches"]) >= 1

    def test_global_search_across_multiple_courses(
        self, course, course_b, teacher, student, student_membership, student_membership_b
    ):
        # Môn 1 có tài liệu về Python
        _setup_material_with_content(
            course, teacher, "Python Basics", "Course 1", ["py"], ["Variables and Loops in Python"]
        )
        # Môn 2 có tài liệu về Python
        _setup_material_with_content(
            course_b,
            teacher,
            "Python Data Structures",
            "Course 2",
            ["py"],
            ["Lists and Dicts in Python"],
        )

        client = APIClient()
        client.force_authenticate(user=student)

        # Sinh viên tìm global không truyền course_id -> nhận kết quả cả 2 môn
        url = "/api/v1/materials/search?q=Python"
        resp = client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        data = resp.json()
        assert data["pagination"]["total_items"] == 2
        course_ids = {r["course_id"] for r in data["items"]}
        assert str(course.id) in course_ids
        assert str(course_b.id) in course_ids

    def test_search_query_too_long_rejected(self, course, teacher):
        client = APIClient()
        client.force_authenticate(user=teacher)

        long_q = "a" * 201
        url = f"/api/v1/courses/{course.id}/materials/search?q={long_q}"
        resp = client.get(url)

        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_vietnamese_diacritics_search_normalization(self, course, teacher):
        # Tạo tài liệu tiếng Việt có dấu
        mat, _ = _setup_material_with_content(
            course,
            teacher,
            "Kiến trúc phần mềm phân tán",
            "Tài liệu mô tả hệ thống",
            ["kien_truc"],
            ["Cơ chế chịu lỗi và cân bằng tải"],
        )

        # Tìm bằng từ không dấu: 'kien truc'
        client = APIClient()
        client.force_authenticate(user=teacher)

        url = f"/api/v1/courses/{course.id}/materials/search?q=kien+truc"
        resp = client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        data = resp.json()
        assert data["pagination"]["total_items"] == 1
        assert data["items"][0]["id"] == str(mat.id)
