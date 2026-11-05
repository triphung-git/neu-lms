"""Learning workflows. Existing submission and grade history remain immutable."""

from django.conf import settings
from django.db import models
from django.utils import timezone

U = settings.AUTH_USER_MODEL


class EnrollmentKey(models.Model):
    course = models.OneToOneField("courses.Course", on_delete=models.CASCADE)
    password_hash = models.CharField(max_length=128)


class AttendanceSession(models.Model):
    course = models.ForeignKey("courses.Course", on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    code_hash = models.CharField(max_length=128)
    opens_at = models.DateTimeField()
    late_at = models.DateTimeField()
    closes_at = models.DateTimeField()
    closed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class AttendanceRecord(models.Model):
    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE)
    student = models.ForeignKey(U, on_delete=models.PROTECT)
    status = models.CharField(max_length=16, default="absent")
    checked_at = models.DateTimeField(null=True)
    corrections = models.JSONField(default=list)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["session", "student"], name="attendance_once")
        ]


class LessonProgress(models.Model):
    lesson = models.ForeignKey("courses.Lesson", on_delete=models.CASCADE)
    student = models.ForeignKey(U, on_delete=models.CASCADE)
    completed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["lesson", "student"], name="lesson_progress_once")
        ]


class Discussion(models.Model):
    course = models.ForeignKey("courses.Course", on_delete=models.PROTECT)
    lesson = models.ForeignKey("courses.Lesson", null=True, blank=True, on_delete=models.SET_NULL)
    author = models.ForeignKey(U, on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    body = models.TextField()
    pinned = models.BooleanField(default=False)
    locked = models.BooleanField(default=False)
    hidden = models.BooleanField(default=False)
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class DiscussionReply(models.Model):
    discussion = models.ForeignKey(Discussion, on_delete=models.CASCADE, related_name="replies")
    author = models.ForeignKey(U, on_delete=models.PROTECT)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL)
    body = models.TextField()
    accepted = models.BooleanField(default=False)
    hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class LearningNotice(models.Model):
    user = models.ForeignKey(U, on_delete=models.CASCADE)
    course = models.ForeignKey("courses.Course", on_delete=models.CASCADE)
    text = models.CharField(max_length=300)
    read_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class DownloadEvent(models.Model):
    assignment = models.ForeignKey("assignments.Assignment", on_delete=models.PROTECT)
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT)
    user = models.ForeignKey(U, on_delete=models.PROTECT)
    kind = models.CharField(max_length=12, default="download")
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)


class LibraryDocument(models.Model):
    owner = models.ForeignKey(U, on_delete=models.PROTECT)
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=100, blank=True)
    tags = models.CharField(max_length=300, blank=True)
    visibility = models.CharField(max_length=16, default="private")
    hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class AppealPolicy(models.Model):
    assignment = models.OneToOneField("assignments.Assignment", on_delete=models.CASCADE)
    deadline = models.DateTimeField()


class GradeAppeal(models.Model):
    grade = models.OneToOneField("assignments.SubmissionGradeEntry", on_delete=models.PROTECT)
    reason = models.TextField()
    status = models.CharField(max_length=16, default="pending")
    response = models.TextField(blank=True)
    resolved_grade = models.ForeignKey(
        "assignments.SubmissionGradeEntry", null=True, on_delete=models.PROTECT, related_name="+"
    )
    reviewed_by = models.ForeignKey(U, null=True, on_delete=models.PROTECT)
    reviewed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class GroupPolicy(models.Model):
    assignment = models.OneToOneField("assignments.Assignment", on_delete=models.PROTECT)
    max_members = models.PositiveSmallIntegerField(default=5)
    formation_deadline = models.DateTimeField()


class StudyGroup(models.Model):
    policy = models.ForeignKey(GroupPolicy, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    leader = models.ForeignKey(U, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)


class GroupMember(models.Model):
    policy = models.ForeignKey(GroupPolicy, on_delete=models.CASCADE)
    group = models.ForeignKey(StudyGroup, on_delete=models.CASCADE, related_name="members")
    student = models.ForeignKey(U, on_delete=models.PROTECT)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["policy", "student"], name="one_group_per_assignment")
        ]


class GroupSubmission(models.Model):
    group = models.ForeignKey(StudyGroup, on_delete=models.PROTECT, related_name="submissions")
    file = models.OneToOneField("files.StoredFile", on_delete=models.PROTECT)
    number = models.PositiveIntegerField()
    submitted_at = models.DateTimeField(default=timezone.now)
    is_late = models.BooleanField(default=False)
    member_ids = models.JSONField(default=list)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["group", "number"], name="group_revision_number")
        ]


class GroupGrade(models.Model):
    submission = models.ForeignKey(GroupSubmission, on_delete=models.PROTECT, related_name="grades")
    version = models.PositiveIntegerField()
    score = models.DecimalField(max_digits=10, decimal_places=2)
    feedback = models.TextField(blank=True)
    adjustments = models.JSONField(default=dict)
    published = models.BooleanField(default=False)
    teacher = models.ForeignKey(U, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["submission", "version"], name="group_grade_version")
        ]


class GroupGradeAppeal(models.Model):
    grade = models.ForeignKey(GroupGrade, on_delete=models.PROTECT)
    student = models.ForeignKey(U, on_delete=models.PROTECT)
    reason = models.TextField()
    response = models.TextField(blank=True)
    status = models.CharField(max_length=16, default="pending")
    resolved_grade = models.ForeignKey(
        GroupGrade, null=True, on_delete=models.PROTECT, related_name="+"
    )
    reviewed_by = models.ForeignKey(U, null=True, on_delete=models.PROTECT, related_name="+")
    reviewed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["grade", "student"], name="group_appeal_once")
        ]
