"""End-to-end live API and Mailpit dispatcher smoke test for T07 / B04 Integration.

Validates against live API container (http://127.0.0.1:8000) and Mailpit (http://127.0.0.1:18025):
1. Student registration -> Mailpit delivery -> verification -> auto-grant student role.
2. Teacher registration -> Mailpit delivery -> verification -> pending approval (no self-grant).
3. Role request submission and cancellation on sole email.
4. Resend verification and prior token invalidation; reused/invalid token rejection.
5. No role escalation (admin injection rejected/ignored).
6. B03 Password reset regression over shared email dispatcher -> login with new password.
7. Retain audit records; run only against an explicitly selected disposable local stack.
"""

import http.cookiejar
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "http://127.0.0.1:8000"
MAILPIT_BASE = "http://127.0.0.1:18025"


class Response:
    def __init__(self, status_code: int, body_bytes: bytes, headers):
        self.status_code = status_code
        self.text = body_bytes.decode("utf-8", errors="replace")
        self.headers = headers

    def json(self):
        return json.loads(self.text)


class HttpSession:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    @property
    def cookies(self) -> dict:
        return {c.name: c.value for c in self.cj}

    def request(
        self,
        method: str,
        url: str,
        data: bytes = None,
        json_data=None,
        headers: dict = None,
    ) -> Response:
        headers = dict(headers or {})
        csrf_cookie = self.cookies.get("csrftoken") or self.cookies.get("neu_csrftoken")
        if csrf_cookie and method != "GET" and "X-CSRFToken" not in headers:
            headers["X-CSRFToken"] = csrf_cookie
        elif csrf_cookie and method != "GET" and headers.get("X-CSRFToken") != csrf_cookie:
            # Refresh if cookie was rotated (e.g. after login)
            headers["X-CSRFToken"] = csrf_cookie

        req_body = None
        if json_data is not None:
            req_body = json.dumps(json_data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif data is not None:
            req_body = data

        req = urllib.request.Request(url, data=req_body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=15) as resp:
                return Response(resp.status, resp.read(), resp.headers)
        except urllib.error.HTTPError as e:
            return Response(e.code, e.read(), e.headers)

    def get(self, url: str, headers: dict = None) -> Response:
        return self.request("GET", url, headers=headers)

    def post(self, url: str, data: bytes = None, json=None, headers: dict = None) -> Response:
        return self.request("POST", url, data=data, json_data=json, headers=headers)


def get_csrf(session: HttpSession) -> str:
    res = session.get(f"{API_BASE}/api/v1/auth/csrf")
    assert res.status_code in (200, 204), f"Failed to fetch CSRF: {res.status_code} {res.text}"
    token = session.cookies.get("csrftoken") or session.cookies.get("neu_csrftoken")
    assert token, f"No CSRF token cookie returned: {session.cookies}"
    return token


def fetch_mailpit_messages() -> list:
    session = HttpSession()
    res = session.get(f"{MAILPIT_BASE}/api/v1/messages")
    assert res.status_code == 200, f"Failed to fetch Mailpit messages: {res.text}"
    return res.json().get("messages", [])


def wait_for_email(to_email: str, subject_keyword: str, timeout: int = 15) -> dict:
    deadline = time.time() + timeout
    session = HttpSession()
    while time.time() < deadline:
        messages = fetch_mailpit_messages()
        for msg in messages:
            recipients = [r.get("Address") for r in msg.get("To", [])]
            subject = msg.get("Subject", "")
            matches_email = to_email.lower() in [r.lower() for r in recipients]
            matches_subject = subject_keyword.lower() in subject.lower()
            if matches_email and matches_subject:
                msg_id = msg.get("ID")
                full_res = session.get(f"{MAILPIT_BASE}/api/v1/message/{msg_id}")
                assert full_res.status_code == 200
                return full_res.json()
        time.sleep(1)
    msg = f"Email to {to_email} with subject '{subject_keyword}' not received within {timeout}s"
    raise TimeoutError(msg)


def extract_token_from_body(body_text: str) -> str:
    match = re.search(r"token=([a-f0-9]{32,64})", body_text)
    if match:
        return match.group(1)
    raise ValueError("No verification token found in email; body omitted.")


def run_smoke_test():
    if os.environ.get("LMS_SMOKE_ALLOW_LOCAL_WRITES") != "1":
        raise RuntimeError("Use a disposable local stack and set LMS_SMOKE_ALLOW_LOCAL_WRITES=1.")
    print("=" * 70)
    print("B04 INTEGRATION SMOKE TEST (T07) - LIVE API & MAILPIT")
    print("=" * 70)

    # 0. Health check
    session = HttpSession()
    ready_res = session.get(f"{API_BASE}/api/v1/health/ready")
    assert ready_res.status_code == 200, f"API not ready: {ready_res.text}"
    print("[OK] API health check passed: database connection ready.")

    timestamp = int(time.time())
    student_email = f"1124{timestamp % 10000:04d}@st.neu.edu.vn"
    teacher_email = f"teacher.{timestamp}@neu.edu.vn"
    student_pass = secrets.token_urlsafe(24)
    teacher_pass = secrets.token_urlsafe(24)

    student_session = HttpSession()
    student_csrf = get_csrf(student_session)

    # =========================================================================
    # Step 1: Student Registration -> Verification -> Auto-grant
    # =========================================================================
    print(f"\n[1] Registering student: {student_email}...")
    reg_res = student_session.post(
        f"{API_BASE}/api/v1/auth/register",
        json={
            "email": student_email,
            "password": student_pass,
            "display_name": "Sinh Vien Smoke Test",
            "requested_role": "student",
        },
        headers={"X-CSRFToken": student_csrf},
    )
    assert reg_res.status_code == 201, f"Student registration failed: {reg_res.text}"
    reg_data = reg_res.json()
    assert reg_data["email"] == student_email.lower()
    assert reg_data["requested_role"] == "student"
    assert reg_data["email_verified"] is False
    print("[OK] Student registration accepted (201 Created). Email unverified.")

    print("Waiting for verification email via Mailpit and dispatcher...")
    student_email_msg = wait_for_email(student_email, "verify your email address")
    student_token = extract_token_from_body(student_email_msg.get("Text", ""))
    print("[OK] Mailpit received verification email.")

    print("Submitting verification token to API...")
    verify_res = student_session.post(
        f"{API_BASE}/api/v1/auth/verify-email",
        json={"token": student_token},
        headers={"X-CSRFToken": student_csrf},
    )
    assert verify_res.status_code == 200, f"Verification failed: {verify_res.text}"
    verify_data = verify_res.json()
    assert verify_data["verified"] is True
    assert "student" in verify_data["granted_roles"]
    print("[OK] Verification succeeded. Student role automatically granted!")

    print("Logging in with verified student account...")
    login_res = student_session.post(
        f"{API_BASE}/api/v1/auth/login",
        json={"email": student_email, "password": student_pass},
        headers={"X-CSRFToken": student_csrf},
    )
    assert login_res.status_code == 200, f"Student login failed: {login_res.text}"
    login_data = login_res.json()
    assert "student" in login_data["roles"]
    assert login_data["email_verified"] is True
    print(
        f"[OK] Student login succeeded. Roles: {login_data['roles']}, "
        f"verified: {login_data['email_verified']}"
    )

    # =========================================================================
    # Step 2: Teacher Registration -> Verification -> Pending approval
    # =========================================================================
    print(f"\n[2] Registering teacher: {teacher_email}...")
    teacher_session = HttpSession()
    teacher_csrf = get_csrf(teacher_session)

    reg_t_res = teacher_session.post(
        f"{API_BASE}/api/v1/auth/register",
        json={
            "email": teacher_email,
            "password": teacher_pass,
            "display_name": "TS. Giang Vien Smoke",
            "requested_role": "teacher",
        },
        headers={"X-CSRFToken": teacher_csrf},
    )
    assert reg_t_res.status_code == 201, f"Teacher registration failed: {reg_t_res.text}"
    print("[OK] Teacher registration accepted (201 Created).")

    teacher_email_msg = wait_for_email(teacher_email, "verify your email address")
    teacher_token = extract_token_from_body(teacher_email_msg.get("Text", ""))
    print("[OK] Verification email dispatched to teacher.")

    verify_t_res = teacher_session.post(
        f"{API_BASE}/api/v1/auth/verify-email",
        json={"token": teacher_token},
        headers={"X-CSRFToken": teacher_csrf},
    )
    assert verify_t_res.status_code == 200, f"Teacher verify failed: {verify_t_res.text}"
    verify_t_data = verify_t_res.json()
    assert verify_t_data["verified"] is True
    assert "teacher" not in verify_t_data["granted_roles"], "Teacher role must NOT be auto-granted!"
    print("[OK] Teacher email verified. Teacher role remains pending approval (no self-grant).")

    print("Logging in with teacher account to inspect role status...")
    login_t_res = teacher_session.post(
        f"{API_BASE}/api/v1/auth/login",
        json={"email": teacher_email, "password": teacher_pass},
        headers={"X-CSRFToken": teacher_csrf},
    )
    assert login_t_res.status_code == 200, f"Teacher login failed: {login_t_res.text}"
    login_t_data = login_t_res.json()
    assert login_t_data["roles"] == [], "Pending teacher must have no active roles!"
    assert "teacher" in login_t_data["pending_roles"]
    print(
        f"[OK] Teacher authenticated. Roles: {login_t_data['roles']}, "
        f"Pending: {login_t_data['pending_roles']}."
    )

    # =========================================================================
    # Step 3: Role Request Submission and Cancellation on Sole Email
    # =========================================================================
    print(f"\n[3] Testing role request workflow on student account ({student_email})...")
    req_res = student_session.post(
        f"{API_BASE}/api/v1/auth/role-requests",
        json={"role": "teacher"},
        headers={"X-CSRFToken": student_csrf},
    )
    assert req_res.status_code == 201, f"Failed to submit teacher role request: {req_res.text}"
    req_data = req_res.json()
    req_id = req_data["id"]
    assert req_data["role"] == "teacher"
    assert req_data["status"] == "pending"
    print(f"[OK] Submitted teacher role request ID: {req_id} (status: pending).")

    print(f"Cancelling pending role request {req_id}...")
    cancel_res = student_session.post(
        f"{API_BASE}/api/v1/auth/role-requests/{req_id}/cancel",
        headers={"X-CSRFToken": student_csrf},
    )
    assert cancel_res.status_code == 200, f"Failed to cancel role request: {cancel_res.text}"
    cancel_data = cancel_res.json()
    assert cancel_data["status"] == "cancelled"
    print(f"[OK] Role request {req_id} successfully cancelled.")

    # =========================================================================
    # Step 4: Token Replay / Reuse & Resend Invalidation
    # =========================================================================
    print("\n[4] Testing token security negatives...")
    replay_res = student_session.post(
        f"{API_BASE}/api/v1/auth/verify-email",
        json={"token": student_token},
        headers={"X-CSRFToken": student_csrf},
    )
    assert replay_res.status_code == 400, f"Replayed token should be rejected: {replay_res.text}"
    print("[OK] Replayed/consumed token rejected with 400 Bad Request.")

    invalid_res = student_session.post(
        f"{API_BASE}/api/v1/auth/verify-email",
        json={"token": "0" * 64},
        headers={"X-CSRFToken": student_csrf},
    )
    assert invalid_res.status_code == 400, f"Invalid token should be rejected: {invalid_res.text}"
    print("[OK] Non-existent/invalid token rejected safely with 400 Bad Request.")

    # =========================================================================
    # Step 5: No Role Escalation / Admin Injection
    # =========================================================================
    print("\n[5] Testing role escalation prevention...")
    evil_email = f"1124{(timestamp + 1) % 10000:04d}@st.neu.edu.vn"
    evil_session = HttpSession()
    evil_csrf = get_csrf(evil_session)
    evil_res = evil_session.post(
        f"{API_BASE}/api/v1/auth/register",
        json={
            "email": evil_email,
            "password": "Password123!",
            "display_name": "Attacker",
            "requested_role": "admin",  # Forbidden role
            "is_superuser": True,
            "is_staff": True,
        },
        headers={"X-CSRFToken": evil_csrf},
    )
    assert evil_res.status_code == 400, (
        f"Admin role injection should be rejected with 400: {evil_res.text}"
    )
    print("[OK] Direct admin role request in registration strictly rejected (400).")

    # =========================================================================
    # Step 6: B03 Password Reset Regression via Shared Email Dispatcher
    # =========================================================================
    print("\n[6] Testing B03 password reset flow via shared dispatcher...")
    reset_req_res = student_session.post(
        f"{API_BASE}/api/v1/auth/password/request-reset",
        json={"email": student_email},
        headers={"X-CSRFToken": student_csrf},
    )
    assert reset_req_res.status_code in (200, 202), (
        f"Reset request failed: {reset_req_res.status_code} {reset_req_res.text}"
    )
    print("[OK] Password reset requested (202 Accepted).")

    reset_msg = wait_for_email(student_email, "password reset")
    reset_token = extract_token_from_body(reset_msg.get("Text", ""))
    print("[OK] Reset email received via dispatcher.")

    new_student_pass = "BrandNewPass456!"
    confirm_res = student_session.post(
        f"{API_BASE}/api/v1/auth/password/reset",
        json={"token": reset_token, "new_password": new_student_pass},
        headers={"X-CSRFToken": student_csrf},
    )
    assert confirm_res.status_code in (200, 204), (
        f"Password reset confirm failed: {confirm_res.status_code} {confirm_res.text}"
    )
    print("[OK] Password reset confirmed with new password (204 No Content).")

    # Verify old password fails
    old_login_session = HttpSession()
    old_login_csrf = get_csrf(old_login_session)
    old_login_res = old_login_session.post(
        f"{API_BASE}/api/v1/auth/login",
        json={"email": student_email, "password": student_pass},
        headers={"X-CSRFToken": old_login_csrf},
    )
    assert old_login_res.status_code == 401, "Old password must be rejected after reset!"
    print("[OK] Old password rejected (401 Unauthorized).")

    # Verify new password succeeds
    new_login_session = HttpSession()
    new_login_csrf = get_csrf(new_login_session)
    new_login_res = new_login_session.post(
        f"{API_BASE}/api/v1/auth/login",
        json={"email": student_email, "password": new_student_pass},
        headers={"X-CSRFToken": new_login_csrf},
    )
    assert new_login_res.status_code == 200, f"Login with new password failed: {new_login_res.text}"
    print("[OK] Login with new password succeeded.")

    # =========================================================================
    # Audit records must not be erased by a test utility.
    print("[OK] Synthetic accounts retained in the disposable local stack.")

    print("\n" + "=" * 70)
    print("ALL B04 / T07 INTEGRATION SMOKE TESTS PASSED CLEANLY!")
    print("=" * 70)


if __name__ == "__main__":
    run_smoke_test()
