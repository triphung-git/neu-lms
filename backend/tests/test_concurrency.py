import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.db import close_old_connections, connections

from identity.models import RoleGrant, RoleRequest, User
from identity.services.accounts import confirm_email, create_account
from identity.services.bootstrap import bootstrap_admin
from identity.services.roles import approve_teacher_request, request_role, revoke_role
from platform_core.errors import DomainError
from platform_core.idempotency import ResultReference, execute_once
from platform_core.models import IdempotencyRecord

pytestmark = pytest.mark.django_db(transaction=True)


def race(*callbacks):
    barrier = Barrier(len(callbacks))

    def worker(callback):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return callback()
        except DomainError as error:
            return error.code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=len(callbacks)) as pool:
        return list(pool.map(worker, callbacks))


def admin(email):
    account = create_account(email=email)
    return bootstrap_admin(email=account.email, ownership_confirmed=True)


def test_concurrent_email_registration():
    def create():
        return create_account(email="Same@example.test").id

    result = race(create, create)
    assert result.count("EMAIL_ALREADY_REGISTERED") == 1
    assert User.objects.filter(email="same@example.test").count() == 1


def test_concurrent_request_and_approval():
    user = create_account(email="teacher@example.test")
    confirm_email(user_id=user.id, expected_email=user.email)
    actor, _ = admin("admin@example.test")

    def request():
        return request_role(user_id=user.id, role="teacher").id

    ids = race(request, request)
    assert ids[0] == ids[1]
    assert RoleRequest.objects.filter(user=user).count() == 1

    def approve():
        return approve_teacher_request(actor_id=actor.id, request_id=ids[0]).id

    grants = race(approve, approve)
    assert grants[0] == grants[1]
    assert RoleGrant.objects.filter(user=user, role="teacher").count() == 1


def test_concurrent_last_admin_protection():
    first, grant1 = admin("first@example.test")
    second, grant2 = admin("second@example.test")
    results = race(
        lambda: revoke_role(actor_id=first.id, grant_id=grant1.id).id,
        lambda: revoke_role(actor_id=second.id, grant_id=grant2.id).id,
    )
    assert results.count("LAST_ACTIVE_ADMIN") == 1
    assert (
        RoleGrant.objects.filter(
            role="admin", revoked_at__isnull=True, user__is_active=True
        ).count()
        == 1
    )


def test_concurrent_idempotency_mutates_once():
    scope = f"operation:{uuid.uuid4()}"

    def mutation():
        user = create_account(email="once@example.test")
        return ResultReference("user", user.id)

    def invoke():
        return execute_once(
            scope=scope, operation="account.create", key="same-key", payload={}, mutation=mutation
        )

    results = race(invoke, invoke)
    assert results[0] == results[1]
    assert isinstance(results[0], ResultReference)
    assert User.objects.filter(email="once@example.test").count() == 1
    assert IdempotencyRecord.objects.count() == 1
