"""Accounts: email verification, password reset, sessions (token versions) and Google sign-in."""
import email
import re
import uuid

import pytest

import routers.auth as auth_router
import services.auth_service as auth_service

PASSWORD = "Password123!"


def new_email() -> str:
    return f"user{uuid.uuid4().hex[:10]}@example.com"


def latest_code(outbox, to: str, word: str) -> str:
    for path in sorted(outbox.glob("*.eml"), reverse=True):
        msg = email.message_from_bytes(path.read_bytes())
        if msg["To"] == to and word in msg["Subject"]:
            return re.match(r"(\d{6})", msg["Subject"]).group(1)
    raise AssertionError(f"no {word} email for {to}")


def signup_and_verify(client, outbox, addr: str) -> str:
    client.post("/api/auth/signup", json={"name": "Test User", "email": addr, "password": PASSWORD})
    code = latest_code(outbox, addr, "verification")
    return client.post("/api/auth/verify-email", json={"email": addr, "code": code}).json()["token"]


@pytest.fixture(autouse=True)
def no_resend_cooldown(monkeypatch):
    monkeypatch.setattr(auth_service, "CODE_RESEND_COOLDOWN_MS", 0)


def test_signup_needs_email_confirmation(client, outbox):
    addr = new_email()
    r = client.post("/api/auth/signup", json={"name": "Vera Tester", "email": addr, "password": PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["verification_required"] is True and not body["token"]
    # Signing in before confirming gives no token either (and sends a fresh code)
    r = client.post("/api/auth/login", json={"email": addr, "password": PASSWORD})
    assert r.json()["verification_required"] is True and not r.json()["token"]


def test_verification_email_is_branded(client, outbox):
    addr = new_email()
    client.post("/api/auth/signup", json={"name": "Vera Tester", "email": addr, "password": PASSWORD})
    path = sorted(outbox.glob("*.eml"))[-1]
    msg = email.message_from_bytes(path.read_bytes())
    assert msg["From"].startswith("MindAI")
    html = next(p for p in msg.walk() if p.get_content_type() == "text/html").get_payload(decode=True).decode()
    code = latest_code(outbox, addr, "verification")
    assert all(d in html for d in code)


def test_right_code_signs_in_and_cannot_be_reused(client, outbox):
    addr = new_email()
    client.post("/api/auth/signup", json={"name": "A", "email": addr, "password": PASSWORD})
    code = latest_code(outbox, addr, "verification")
    r = client.post("/api/auth/verify-email", json={"email": addr, "code": code})
    assert r.status_code == 200 and r.json()["token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()["email"] == addr
    assert client.post("/api/auth/verify-email", json={"email": addr, "code": code}).status_code == 400
    assert client.post("/api/auth/login", json={"email": addr, "password": PASSWORD}).json()["token"]


def test_five_wrong_codes_burn_the_code(client, outbox):
    addr = new_email()
    client.post("/api/auth/signup", json={"name": "A", "email": addr, "password": PASSWORD})
    code = latest_code(outbox, addr, "verification")
    wrong = "000000" if code != "000000" else "111111"
    auth_service._login_attempts.clear()
    for _ in range(5):
        assert client.post("/api/auth/verify-email", json={"email": addr, "code": wrong}).status_code == 400
    auth_service._login_attempts.clear()
    assert client.post("/api/auth/verify-email", json={"email": addr, "code": code}).status_code == 400


def test_wrong_password(client, outbox):
    addr = new_email()
    signup_and_verify(client, outbox, addr)
    r = client.post("/api/auth/login", json={"email": addr, "password": "WrongPass999"})
    assert r.status_code == 401 and r.json()["detail"] == "Incorrect email or password."


def test_rate_limit_buckets_are_separate_per_purpose(client, outbox):
    addr = new_email()
    signup_and_verify(client, outbox, addr)
    auth_service._login_attempts.clear()
    for _ in range(5):
        client.post("/api/auth/login", json={"email": addr, "password": "WrongPass999"})
    assert client.post("/api/auth/login", json={"email": addr, "password": PASSWORD}).status_code == 429
    # Failed sign-ins don't block asking for a reset code
    assert client.post("/api/auth/forgot-password", json={"email": addr}).status_code == 200
    auth_service._login_attempts.clear()


def test_forgot_password_does_not_reveal_accounts(client, outbox):
    addr = new_email()
    signup_and_verify(client, outbox, addr)
    known = client.post("/api/auth/forgot-password", json={"email": addr})
    unknown = client.post("/api/auth/forgot-password", json={"email": new_email()})
    assert known.status_code == unknown.status_code == 200 and known.json() == unknown.json()


def test_reset_password_signs_out_other_devices(client, outbox):
    addr = new_email()
    old_token = signup_and_verify(client, outbox, addr)
    client.post("/api/auth/forgot-password", json={"email": addr})
    code = latest_code(outbox, addr, "reset")
    assert client.post("/api/auth/reset-password", json={"email": addr, "code": code, "new_password": "short"}).status_code == 422
    r = client.post("/api/auth/reset-password", json={"email": addr, "code": code, "new_password": "NewPassword456"})
    assert r.status_code == 200
    new_token = r.json()["token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_token}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": addr, "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/login", json={"email": addr, "password": "NewPassword456"}).json()["token"]


def test_change_password_keeps_this_device_signed_in(client, outbox):
    addr = new_email()
    token = signup_and_verify(client, outbox, addr)
    r = client.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "Another789x"},
                    headers={"Authorization": f"Bearer {token}"})
    fresh = r.json()["token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {fresh}"}).status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_refresh_gives_a_working_token(client, outbox):
    token = signup_and_verify(client, outbox, new_email())
    r = client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200


def test_google_rejects_a_forged_token(client):
    r = client.post("/api/auth/google", json={"id_token": "eyJhbGciOiJSUzI1NiJ9.forged.signature-not-real"})
    assert r.status_code == 401


def test_google_creates_and_links_accounts(client, outbox, monkeypatch):
    claims = {}
    monkeypatch.setattr(auth_router, "verify_google_token", lambda token: dict(claims))
    gmail = f"G.User{uuid.uuid4().hex[:6]}@Gmail.com"
    claims.update(sub=f"g-{uuid.uuid4().hex}", email=gmail, email_verified=True, name="Gina Google")
    first = client.post("/api/auth/google", json={"id_token": "x" * 30}).json()
    assert first["token"] and first["user"]["email"] == gmail.lower()
    again = client.post("/api/auth/google", json={"id_token": "x" * 30}).json()
    assert again["user"]["id"] == first["user"]["id"]
    # A Google-only account has no usable password
    assert client.post("/api/auth/login", json={"email": gmail, "password": "anything123"}).status_code == 401

    # Same email as an existing password account: linked, not duplicated, and the password still works
    addr = new_email()
    token = signup_and_verify(client, outbox, addr)
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    claims.update(sub=f"g-{uuid.uuid4().hex}", email=addr, name="Other")
    linked = client.post("/api/auth/google", json={"id_token": "x" * 30}).json()
    assert linked["user"]["id"] == me["id"]
    assert client.post("/api/auth/login", json={"email": addr, "password": PASSWORD}).json()["token"]
