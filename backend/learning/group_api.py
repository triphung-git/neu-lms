from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, serializers
from rest_framework.response import Response

from assignments.models import Assignment, SubmissionRevision
from assignments.services import validate_submission_commit_eligibility
from files.models import StoredFile

from .common import LearningBase, course_access, deliver, field, member_ids, require_manager
from .models import GroupGrade, GroupMember, GroupPolicy, GroupSubmission, StudyGroup


class GroupsView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, manager = course_access(request.user, course_id)
        policies = GroupPolicy.objects.filter(assignment__course=course)
        if not manager:
            policies = policies.filter(assignment__published_at__isnull=False).exclude(
                assignment__status="draft"
            )
        groups = []
        for group in StudyGroup.objects.filter(policy__in=policies).select_related("leader"):
            members = list(group.members.values("student_id", "student__display_name"))
            mine = any(x["student_id"] == request.user.pk for x in members)
            submissions = []
            if manager or mine:
                for sub in group.submissions.select_related("file").order_by("-number"):
                    grades = sub.grades.order_by("-version")
                    if not manager:
                        grades = grades.filter(published=True)
                    grade = grades.first()
                    adjustments = grade.adjustments if grade else {}
                    effective = str(grade.score) if grade else None
                    if grade and not manager:
                        effective = adjustments.get(str(request.user.pk), {}).get(
                            "score", effective
                        )
                    submissions.append(
                        {
                            "id": sub.id,
                            "number": sub.number,
                            "file_name": sub.file.file_name,
                            "submitted_at": sub.submitted_at,
                            "is_late": sub.is_late,
                            "grade": {
                                "id": grade.pk,
                                "version": grade.version,
                                "score": effective,
                                "feedback": grade.feedback,
                                "published": grade.published,
                                "adjustments": adjustments
                                if manager
                                else {str(request.user.pk): adjustments.get(str(request.user.pk))},
                            }
                            if grade
                            else None,
                        }
                    )
            groups.append(
                {
                    "id": group.id,
                    "policy_id": group.policy_id,
                    "name": group.name,
                    "leader_id": group.leader_id,
                    "members": members,
                    "mine": mine,
                    "submissions": submissions,
                }
            )
        return Response(
            {
                "policies": [
                    {
                        "id": p.pk,
                        "assignment_id": p.assignment_id,
                        "assignment__title": p.assignment.title,
                        "assignment__total_score": p.assignment.total_score,
                        "max_members": p.max_members,
                        "formation_deadline": p.formation_deadline,
                    }
                    for p in policies.select_related("assignment")
                ],
                "items": groups,
            }
        )

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, course_id):
        course, manager = course_access(request.user, course_id, write=True)
        d = request.data
        action = field(d, "action", "title")
        if action == "policy":
            require_manager(manager)
            assignment = get_object_or_404(
                Assignment.objects.select_for_update(),
                course=course,
                pk=field(d, "assignment_id", "uuid"),
            )
            if (
                SubmissionRevision.objects.filter(assignment=assignment).exists()
                or StudyGroup.objects.filter(policy__assignment=assignment).exists()
            ):
                raise exceptions.ValidationError(
                    "Đã có bài nộp/nhóm / Submission or groups already exist."
                )
            maximum = field(d, "max_members", "int")
            deadline = field(d, "formation_deadline", "time")
            if maximum > 30 or deadline <= timezone.now():
                raise exceptions.ValidationError(
                    "Tối đa 30 thành viên; hạn ở tương lai / Invalid policy."
                )
            GroupPolicy.objects.update_or_create(
                assignment=assignment,
                defaults={"max_members": maximum, "formation_deadline": deadline},
            )
            return Response({"ok": True})
        policy = get_object_or_404(
            GroupPolicy.objects.select_related("assignment"),
            pk=field(d, "policy_id", "int"),
            assignment__course=course,
        )
        if not manager and (
            not policy.assignment.published_at or policy.assignment.status == "draft"
        ):
            raise exceptions.PermissionDenied()
        if action == "roster":
            require_manager(manager)
            if (
                policy.formation_deadline <= timezone.now()
                or GroupSubmission.objects.filter(group__policy=policy).exists()
            ):
                raise exceptions.ValidationError("Đã khóa thành viên / Group formation locked.")
            ids = serializers.ListField(
                child=serializers.UUIDField(), min_length=1, max_length=30
            ).run_validation(d.get("student_ids"))
            if (
                len(set(ids)) != len(ids)
                or len(ids) > policy.max_members
                or set(ids) - set(member_ids(course))
            ):
                raise exceptions.ValidationError(
                    "Danh sách thành viên không hợp lệ / Invalid roster."
                )
            leader = field(d, "leader_id", "uuid")
            if leader not in ids:
                raise exceptions.ValidationError(
                    "Trưởng nhóm phải thuộc nhóm / Leader must be a member."
                )
            group = (
                get_object_or_404(StudyGroup, policy=policy, pk=field(d, "group_id", "int"))
                if d.get("group_id")
                else None
            )
            assigned = GroupMember.objects.filter(policy=policy, student_id__in=ids)
            if group:
                assigned = assigned.exclude(group=group)
            if assigned.exists():
                raise exceptions.ValidationError(
                    "Thành viên đã thuộc nhóm khác / Member already assigned."
                )
            if group is None:
                group = StudyGroup.objects.create(
                    policy=policy, name=field(d, "name", "title")[:120], leader_id=leader
                )
            else:
                group.name = field(d, "name", "title")[:120]
                group.leader_id = leader
                group.save(update_fields=["name", "leader"])
                group.members.exclude(student_id__in=ids).delete()
            for uid in ids:
                GroupMember.objects.get_or_create(
                    policy=policy, student_id=uid, defaults={"group": group}
                )
        elif action in ["create", "join", "leave", "leader"]:
            if (
                manager
                or policy.formation_deadline <= timezone.now()
                or GroupSubmission.objects.filter(group__policy=policy).exists()
            ):
                raise exceptions.ValidationError("Đã khóa thành viên / Group formation locked.")
            existing = GroupMember.objects.filter(policy=policy, student=request.user).first()
            if action in ["create", "join"]:
                if existing:
                    raise exceptions.ValidationError("Bạn đã ở một nhóm / Already in a group.")
                if action == "create":
                    group = StudyGroup.objects.create(
                        policy=policy, name=field(d, "name", "title")[:120], leader=request.user
                    )
                else:
                    group = get_object_or_404(
                        StudyGroup, policy=policy, pk=field(d, "group_id", "int")
                    )
                    if group.members.count() >= policy.max_members:
                        raise exceptions.ValidationError("Nhóm đã đủ / Group full.")
                GroupMember.objects.create(group=group, policy=policy, student=request.user)
            elif action == "leave":
                if not existing:
                    raise exceptions.ValidationError("Chưa tham gia / Not a member.")
                if existing.group.leader_id == request.user.pk:
                    if existing.group.members.count() > 1:
                        raise exceptions.ValidationError(
                            "Chuyển trưởng nhóm trước / Transfer leadership first."
                        )
                    existing.group.delete()
                else:
                    existing.delete()
            else:
                group = get_object_or_404(
                    StudyGroup, policy=policy, leader=request.user, pk=field(d, "group_id", "int")
                )
                member = get_object_or_404(
                    GroupMember, group=group, student_id=field(d, "student_id", "uuid")
                )
                group.leader_id = member.student_id
                group.save(update_fields=["leader"])
        elif action == "submit":
            group = get_object_or_404(
                StudyGroup.objects.select_for_update(),
                policy=policy,
                pk=field(d, "group_id", "int"),
                leader=request.user,
            )
            if not group.members.filter(student=request.user).exists():
                raise exceptions.PermissionDenied()
            snapshot = list(group.members.values_list("student_id", flat=True))
            if not snapshot or set(snapshot) - set(member_ids(course)):
                raise exceptions.ValidationError(
                    "Thành viên không còn trong lớp / Inactive member."
                )
            item = get_object_or_404(
                StoredFile.objects.select_for_update(),
                pk=field(d, "file_id", "uuid"),
                course=course,
                uploader=request.user,
                status="clean",
                purpose="assignment_submission",
                policy_snapshot__assignment_id=str(policy.assignment_id),
            )
            previous = GroupSubmission.objects.filter(group=group, file=item).first()
            if previous:
                return Response({"id": previous.id})
            latest = group.submissions.order_by("-number").first()
            result = validate_submission_commit_eligibility(
                assignment=policy.assignment,
                student=request.user,
                files_info=[{"name": item.file_name, "size": item.file_size}],
                commit_time=timezone.now(),
                has_existing_submission=latest is not None,
            )
            if not result["valid"]:
                raise exceptions.ValidationError(result["errors"])
            sub = GroupSubmission.objects.create(
                group=group,
                file=item,
                number=latest.number + 1 if latest else 1,
                is_late=result["is_late"],
                member_ids=[str(x) for x in snapshot],
            )
            return Response({"id": sub.id}, status=201)
        elif action == "grade":
            require_manager(manager)
            sub = get_object_or_404(
                GroupSubmission.objects.select_for_update(),
                group__policy=policy,
                pk=field(d, "submission_id", "int"),
            )
            latest = sub.grades.order_by("-version").first()
            version = latest.version if latest else 0
            expected = serializers.IntegerField(min_value=0).run_validation(
                d.get("expected_version")
            )
            if expected != version:
                raise exceptions.ValidationError("Điểm đã thay đổi / Grade changed. Reload.")
            score = field(d, "score", "score")
            if score > policy.assignment.total_score:
                raise exceptions.ValidationError("Điểm vượt tối đa / Score exceeds maximum.")
            adjustments = d.get("adjustments", {})
            if not isinstance(adjustments, dict):
                raise exceptions.ValidationError("Invalid adjustments")
            normalized = {}
            for uid, adjustment in adjustments.items():
                if uid not in sub.member_ids or not isinstance(adjustment, dict):
                    raise exceptions.ValidationError("Invalid member")
                personal = field(adjustment, "score", "score")
                if personal > policy.assignment.total_score:
                    raise exceptions.ValidationError("Score exceeds maximum")
                normalized[uid] = {"score": str(personal), "reason": field(adjustment, "reason")}
            GroupGrade.objects.create(
                submission=sub,
                version=version + 1,
                score=score,
                adjustments=normalized,
                feedback=str(d.get("feedback", ""))[:10000],
                published=field(d, "published", "bool"),
                teacher=request.user,
            )
        else:
            raise exceptions.ValidationError("Unknown action")
        return Response({"ok": True})


class GroupFileView(LearningBase):
    @extend_schema(responses={200: bytes})
    def get(self, request, id):
        sub = get_object_or_404(
            GroupSubmission.objects.select_related("group__policy__assignment", "file"), pk=id
        )
        _, manager = course_access(request.user, sub.group.policy.assignment.course_id)
        if not manager and str(request.user.pk) not in sub.member_ids:
            raise exceptions.PermissionDenied()
        return deliver(sub.file)
