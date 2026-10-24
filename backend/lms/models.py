from django.conf import settings
from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models
from django.db.models.functions import Lower


class AccountManager(UserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields["role"] = "admin"
        return super().create_superuser(
            username,
            email,
            password,
            **extra_fields,
        )


class User(AbstractUser):
    objects = AccountManager()

    email = models.EmailField(unique=True)

    role = models.CharField(
        max_length=10,
        choices=[
            ("admin", "Admin"),
            ("teacher", "Teacher"),
            ("student", "Student"),
        ],
        default="student",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                name="unique_user_email_ci",
            )
        ]


class EligibleEmail(models.Model):
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=150)

    role = models.CharField(
        max_length=10,
        choices=[
            ("teacher", "Teacher"),
            ("student", "Student"),
        ],
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                name="unique_eligible_email_ci",
            )
        ]


class Course(models.Model):
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=200)
    term = models.CharField(max_length=80)
    description = models.TextField(blank=True)

    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="teaching_courses",
    )

    status = models.CharField(
        max_length=10,
        choices=[
            ("open", "Open"),
            ("archived", "Archived"),
        ],
        default="open",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("code"),
                name="unique_course_code_ci",
            )
        ]


class Membership(models.Model):
    course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        related_name="memberships",
    )

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
    )

    status = models.CharField(
        max_length=10,
        choices=[
            ("active", "Active"),
            ("withdrawn", "Withdrawn"),
        ],
        default="active",
    )

    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["course", "student"],
                name="unique_course_student",
            )
        ]
