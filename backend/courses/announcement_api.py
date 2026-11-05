from django.db import transaction
from django.db.models import BooleanField, Count, Exists, OuterRef, Value
from django.shortcuts import get_object_or_404
from django.urls import path
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.pagination import StandardPageNumberPagination

from .models import Course, CourseAnnouncement, CourseAnnouncementReceipt, Membership
from .services import (
    current_enrollment_actor,
    require_active_student,
    require_active_teacher,
    require_course_manager,
)


class NoticeInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    course_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200)
    body = serializers.CharField(max_length=10000)


class NoticeRow(serializers.Serializer):
    id = serializers.IntegerField()
    course_id = serializers.UUIDField()
    course_name = serializers.CharField(source="course.name")
    author_name = serializers.CharField(source="author.display_name")
    title = serializers.CharField()
    body = serializers.CharField()
    published_at = serializers.DateTimeField()
    is_read = serializers.BooleanField()
    recipients = serializers.IntegerField()


class CourseOption(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    status = serializers.CharField()


class NoticeFeed(serializers.Serializer):
    items = NoticeRow(many=True)
    courses = CourseOption(many=True)
    pagination = serializers.DictField()


class NoticeQuery(serializers.Serializer):
    course_id = serializers.UUIDField(required=False)
    unread = serializers.BooleanField(default=False)


class PublishedNotice(serializers.Serializer):
    id = serializers.IntegerField()


class CountResult(serializers.Serializer):
    unread_count = serializers.IntegerField()


class ReadAllQuery(serializers.Serializer):
    course_id = serializers.UUIDField(required=False)


def inbox(user):
    require_active_student(user)
    return CourseAnnouncementReceipt.objects.filter(
        membership__student=user,
        membership__status=Membership.Status.ACTIVE,
    )


class FeedView(APIView):
    permission_classes = [IsAuthenticated]
    teacher = False

    @extend_schema(
        parameters=[NoticeQuery, OpenApiParameter("page", int)],
        responses={200: NoticeFeed},
    )
    def get(self, request):
        query = NoticeQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_data

        if self.teacher:
            require_active_teacher(request.user)
            courses = Course.objects.filter(teacher=request.user)

            notices = CourseAnnouncement.objects.filter(
                course__in=courses,
            ).annotate(
                is_read=Value(True, output_field=BooleanField()),
                recipients=Count("receipts"),
            )
        else:
            own = inbox(request.user)
            courses = Course.objects.filter(
                memberships__student=request.user,
                memberships__status=Membership.Status.ACTIVE,
            )

            notices = CourseAnnouncement.objects.filter(
                pk__in=own.values("announcement_id"),
            ).annotate(
                is_read=Exists(
                    own.filter(
                        announcement_id=OuterRef("pk"),
                        read_at__isnull=False,
                    )
                ),
                recipients=Value(0),
            )

            if filters["unread"]:
                notices = notices.filter(is_read=False)

        if "course_id" in filters:
            notices = notices.filter(course_id=filters["course_id"])

        notices = notices.select_related("course", "author").order_by("-published_at", "-pk")

        pager = StandardPageNumberPagination()
        page = pager.paginate_queryset(notices, request)
        response = pager.get_paginated_response(NoticeRow(page, many=True).data)
        response.data["courses"] = CourseOption(courses.order_by("code"), many=True).data
        return response


class PublishView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=NoticeInput,
        responses={200: PublishedNotice, 201: PublishedNotice},
    )
    @transaction.atomic
    def post(self, request):
        form = NoticeInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data

        actor = current_enrollment_actor(request.user)
        require_active_teacher(actor)

        course = get_object_or_404(
            Course.objects.select_for_update(),
            pk=values["course_id"],
            teacher=actor,
        )
        require_course_manager(actor, course)

        notice, created = CourseAnnouncement.objects.get_or_create(
            request_key=values["request_key"],
            defaults={
                "course": course,
                "author": actor,
                "title": values["title"],
                "body": values["body"],
            },
        )

        if not created:
            original = (notice.course_id, notice.author_id, notice.title, notice.body)
            incoming = (course.pk, actor.pk, values["title"], values["body"])
            if original != incoming:
                raise serializers.ValidationError("Mã gửi đã được sử dụng.")
            return Response({"id": notice.pk})

        member_ids = Membership.objects.filter(
            course=course,
            status=Membership.Status.ACTIVE,
        ).values_list("pk", flat=True)

        CourseAnnouncementReceipt.objects.bulk_create(
            [CourseAnnouncementReceipt(announcement=notice, membership_id=pk) for pk in member_ids],
            batch_size=500,
        )
        return Response({"id": notice.pk}, status=201)


class UnreadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(parameters=[NoticeQuery], responses={200: CountResult})
    def get(self, request):
        query = NoticeQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        receipts = inbox(request.user).filter(read_at__isnull=True)
        course_id = query.validated_data.get("course_id")
        if course_id:
            receipts = receipts.filter(announcement__course_id=course_id)
        return Response({"unread_count": receipts.count()})


class ReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, id):
        receipts = inbox(request.user)
        get_object_or_404(receipts.only("pk"), announcement_id=id)
        receipts.filter(announcement_id=id, read_at__isnull=True).update(read_at=timezone.now())
        return Response(status=204)


class ReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[ReadAllQuery],
        request=None,
        responses={204: None},
    )
    def post(self, request):
        query = ReadAllQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        receipts = inbox(request.user)
        course_id = query.validated_data.get("course_id")
        if course_id:
            receipts = receipts.filter(announcement__course_id=course_id)
        receipts.filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response(status=204)


urlpatterns = [
    path("teacher/course-announcements", FeedView.as_view(teacher=True)),
    path("teacher/course-announcements/publish", PublishView.as_view()),
    path("me/course-announcements", FeedView.as_view()),
    path("me/course-announcements/unread", UnreadView.as_view()),
    path("me/course-announcements/read-all", ReadAllView.as_view()),
    path("me/course-announcements/<int:id>/read", ReadView.as_view()),
]
