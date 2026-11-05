import re

from django.db import transaction
from django.utils import timezone

from identity.models import Role, RoleGrant, RoleRequest, VerifiedEmail
from identity.services.common import (
    digest,
    invalidate_sessions,
    lock_role_policy,
    locked_user,
    preserve_last_admin,
    require_active,
    require_admin,
    require_verified,
)
from platform_core.errors import DomainError
from platform_core.events import record_change


@transaction.atomic
def request_role(*, user_id, role):
    if role not in {Role.STUDENT, Role.TEACHER}:
        raise DomainError("ROLE_NOT_REQUESTABLE")
    lock_role_policy()
    user = locked_user(user_id)
    require_active(user)
    if RoleGrant.objects.filter(user=user, role=role, revoked_at__isnull=True).exists():
        raise DomainError("ROLE_ALREADY_GRANTED")
    request, created = RoleRequest.objects.get_or_create(user=user, role=role, status="pending")
    if created:
        record_change(
            action="role.requested",
            resource_type="role_request",
            resource_id=request.id,
            actor=user,
            metadata={"role": role},
        )
    return request


def _approve(request, user, actor, source):
    if request.status == "approved":
        return RoleGrant.objects.get(source_request=request)
    if request.status != "pending":
        raise DomainError("INVALID_ROLE_TRANSITION")
    request.status = "approved"
    request.reviewed_by = actor
    request.reviewed_at = timezone.now()
    request.review_reason = source
    request.save()
    grant = RoleGrant.objects.create(
        user=user, role=request.role, granted_by=actor, grant_source=source, source_request=request
    )
    invalidate_sessions(user, "role_changed")
    record_change(
        action="role.reviewed",
        resource_type="role_request",
        resource_id=request.id,
        actor=actor,
        metadata={"role": request.role, "status": "approved"},
    )
    record_change(
        action="role.granted",
        resource_type="role_grant",
        resource_id=grant.id,
        actor=actor,
        metadata={"role": grant.role},
    )
    return grant


@transaction.atomic
def approve_teacher_request(*, actor_id, request_id):
    lock_role_policy()
    actor = require_admin(actor_id)
    request = RoleRequest.objects.select_for_update().get(pk=request_id)
    if request.role != Role.TEACHER:
        raise DomainError("WRONG_ROLE_REQUEST")
    user = locked_user(request.user_id)
    require_active(user)
    require_verified(user)
    return _approve(request, user, actor, "teacher_approval")


@transaction.atomic
def grant_student_role(*, user_id):
    lock_role_policy()
    user = locked_user(user_id)
    require_active(user)
    require_verified(user)
    if not re.fullmatch(r"1124[0-9]{4}@st\.neu\.edu\.vn", user.email):
        raise DomainError("STUDENT_EMAIL_REQUIRED")
    existing = RoleGrant.objects.filter(
        user=user, role=Role.STUDENT, revoked_at__isnull=True
    ).first()
    if existing:
        return existing
    if RoleGrant.objects.filter(user=user, role=Role.STUDENT, revoked_at__isnull=False).exists():
        raise DomainError("ROLE_POLICY_VIOLATION")
    request = (
        RoleRequest.objects.select_for_update()
        .filter(user=user, role=Role.STUDENT, status="pending")
        .first()
    )
    if request is None:
        raise DomainError("ROLE_REQUEST_REQUIRED")
    # Automated eligibility uses the authenticated requesting user as actor;
    # grant_source records the verified-email rule, not an administrative approval.
    return _approve(request, user, user, "verified_student_email")


@transaction.atomic
def close_request(*, actor_id, request_id, decision):
    if decision not in {"rejected", "cancelled"}:
        raise DomainError("INVALID_ROLE_TRANSITION")
    lock_role_policy()
    request = RoleRequest.objects.select_for_update().get(pk=request_id)
    actor = locked_user(actor_id)
    require_active(actor)
    if decision == "cancelled":
        if request.user_id != actor.id:
            raise DomainError("FORBIDDEN")
    else:
        require_admin(actor.id)
    if request.status != "pending":
        raise DomainError("INVALID_ROLE_TRANSITION")
    request.status = decision
    request.reviewed_by = actor
    request.reviewed_at = timezone.now()
    request.review_reason = "admin_rejected" if decision == "rejected" else "user_cancelled"
    request.save()
    record_change(
        action="role.reviewed",
        resource_type="role_request",
        resource_id=request.id,
        actor=actor,
        metadata={"role": request.role, "status": decision},
    )
    return request


@transaction.atomic
def grant_admin_role(*, actor_id, user_id, current_password=None, enforce_reauth=False):
    lock_role_policy()
    actor = require_admin(actor_id)
    if enforce_reauth:
        if not current_password:
            raise DomainError("REAUTH_REQUIRED")
        if not actor.check_password(current_password):
            raise DomainError("INVALID_CREDENTIALS")
    user = locked_user(user_id)
    require_active(user)
    existing = RoleGrant.objects.filter(user=user, role=Role.ADMIN, revoked_at__isnull=True).first()
    if existing:
        return existing
    grant = RoleGrant.objects.create(
        user=user,
        role=Role.ADMIN,
        granted_by=actor,
        grant_source="internal_administration",
    )
    invalidate_sessions(user, "admin_granted")
    record_change(
        action="role.granted",
        resource_type="role_grant",
        resource_id=grant.id,
        actor=actor,
        metadata={"role": Role.ADMIN},
    )
    return grant


@transaction.atomic
def revoke_role(*, actor_id, grant_id, current_password=None, enforce_reauth=False):
    lock_role_policy()
    actor = require_admin(actor_id)
    grant = RoleGrant.objects.select_for_update().filter(pk=grant_id).first()
    if grant is None:
        raise DomainError("ROLE_GRANT_NOT_FOUND")
    user = locked_user(grant.user_id)
    if grant.revoked_at:
        return grant
    if grant.role == Role.ADMIN:
        if enforce_reauth:
            if not current_password:
                raise DomainError("REAUTH_REQUIRED")
            if not actor.check_password(current_password):
                raise DomainError("INVALID_CREDENTIALS")
        preserve_last_admin(user)
    grant.revoked_at = timezone.now()
    grant.revoked_by = actor
    grant.revoke_reason = "administrative_revocation"
    grant.save()
    invalidate_sessions(user, "role_revoked")
    record_change(
        action="role.revoked",
        resource_type="role_grant",
        resource_id=grant.id,
        actor=actor,
        metadata={"role": grant.role},
    )
    return grant


@transaction.atomic
def submit_role_request(*, user_id, role):
    # Keep duplicate checking, request creation and any automatic grant atomic.
    lock_role_policy()
    user = locked_user(user_id)
    require_active(user)
    if role == Role.STUDENT and not re.fullmatch(r"1124[0-9]{4}@st\.neu\.edu\.vn", user.email):
        raise DomainError("STUDENT_EMAIL_REQUIRED")
    if RoleRequest.objects.filter(user=user, role=role, status="pending").exists():
        raise DomainError("ONE_PENDING_ROLE_REQUEST")
    role_request = request_role(user_id=user.id, role=role)
    if (
        role == Role.STUDENT
        and VerifiedEmail.objects.filter(
            user=user, verified_at__isnull=False, email_digest=digest(user.email)
        ).exists()
    ):
        grant_student_role(user_id=user.id)
        role_request.refresh_from_db()
    return role_request
