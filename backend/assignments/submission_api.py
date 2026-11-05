from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from courses.models import Course, Membership
from files.models import FilePurpose, FileStatus, StoredFile
from files.services import current_actor
from identity.models import Role
from identity.services.common import has_role

from .models import Assignment, SubmissionRevision
from .services import validate_submission_commit_eligibility


class SubmissionInput(serializers.Serializer):
    file_id = serializers.UUIDField()


class SubmissionReceipt(serializers.ModelSerializer):
    file_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = SubmissionRevision
        fields = ["id", "file_id", "number", "submitted_at", "is_late"]


class SubmissionView(APIView):
    @extend_schema(
        request=SubmissionInput,
        responses={200: SubmissionReceipt, 201: SubmissionReceipt},
    )
    @transaction.atomic
    def post(self, request, course_id, id):
        data = SubmissionInput(data=request.data)
        data.is_valid(raise_exception=True)

        actor = current_actor(request.user)
        course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)

        if (
            not has_role(actor, Role.STUDENT)
            or not Membership.objects.filter(
                course=course,
                student=actor,
                status=Membership.Status.ACTIVE,
            ).exists()
        ):
            raise PermissionDenied()

        assignment = get_object_or_404(
            Assignment.objects.select_for_update(),
            pk=id,
            course=course,
        )
        from learning.models import GroupPolicy

        if GroupPolicy.objects.filter(assignment=assignment).exists():
            raise ValidationError("Bài tập nhóm: nộp tại mục Học tập mở rộng / Submit via Groups.")
        item = get_object_or_404(
            StoredFile.objects.select_for_update(),
            pk=data.validated_data["file_id"],
            course=course,
            uploader=actor,
            purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
            policy_snapshot__assignment_id=str(assignment.pk),
        )

        revisions = SubmissionRevision.objects.filter(
            assignment=assignment,
            student=actor,
        )

        # Nếu máy chủ đã ghi nhận tệp này, trả lại đúng biên nhận trước đó.
        previous = revisions.filter(file=item).first()
        if previous:
            return Response(SubmissionReceipt(previous).data)

        if item.status != FileStatus.CLEAN:
            raise ValidationError("Chỉ được nộp tệp đã quét sạch.")

        latest = revisions.order_by("-number").first()
        now = timezone.now()

        # Kiểm tra lại hạn và chính sách tại lúc xác nhận nộp.
        result = validate_submission_commit_eligibility(
            assignment=assignment,
            student=actor,
            files_info=[{"name": item.file_name, "size": item.file_size}],
            commit_time=now,
            has_existing_submission=latest is not None,
        )
        if not result["valid"]:
            raise ValidationError(result["errors"])

        revision = revisions.create(
            assignment=assignment,
            student=actor,
            file=item,
            number=latest.number + 1 if latest else 1,
            submitted_at=now,
            is_late=result["is_late"],
        )
        return Response(SubmissionReceipt(revision).data, status=201)
