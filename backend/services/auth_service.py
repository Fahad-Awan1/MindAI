"""
Accounts: password hashing, login tokens (JWT) and the current-user dependency.

Every API route except signup/login/health depends on `get_current_user`, and every query
is scoped to that user so each account's documents and progress stay private.
"""
import hashlib
import hmac
import random
import secrets
import time
import uuid
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models import ChatMessage, Document, EmailCode, StudyActivity, StudySet, User

settings = get_settings()

JWT_ALGORITHM = "HS256"
AVATAR_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f97316", "#10b981", "#0ea5e9", "#14b8a6", "#ef4444"]
LOGIN_ATTEMPTS_PER_MINUTE = 5

_bearer = HTTPBearer(auto_error=False)
_login_attempts: Dict[str, Deque[float]] = defaultdict(deque)


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    # bcrypt only uses the first 72 bytes; longer passwords are rejected at validation time
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_token(user: User) -> str:
    issued = int(time.time())
    payload = {
        "sub": user.id,
        # A password change/reset bumps the user's version, which signs out older tokens
        "tv": user.token_version or 0,
        "iat": issued,
        "exp": issued + settings.access_token_expire_days * 24 * 3600,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def user_from_token(db: Session, token: str) -> Optional[User]:
    """The user a token belongs to, or None if it is invalid/expired."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if user is None or payload.get("tv", 0) != (user.token_version or 0):
        return None
    return user


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency: the signed-in user (401 when missing or invalid)."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Please sign in to continue.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized
    user = user_from_token(db, credentials.credentials)
    if user is None:
        raise unauthorized
    return user


def check_login_rate(request: Request, email: str) -> None:
    """Slow down password guessing: at most N attempts per minute per email + client IP."""
    key = f"{normalize_email(email)}|{request.client.host if request.client else ''}"
    attempts = _login_attempts[key]
    cutoff = time.time() - 60
    while attempts and attempts[0] < cutoff:
        attempts.popleft()
    if len(attempts) >= LOGIN_ATTEMPTS_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Please wait a minute and try again.")
    attempts.append(time.time())


def clear_login_attempts(request: Request, email: str) -> None:
    _login_attempts.pop(f"{normalize_email(email)}|{request.client.host if request.client else ''}", None)


def create_user(db: Session, name: str, email: str, password: Optional[str], email_verified: bool = False,
                google_sub: Optional[str] = None) -> User:
    """A new account. Without a password (Google sign-in) it gets an unusable one until the user sets one via reset."""
    user = User(
        id=uuid.uuid4().hex,
        email=normalize_email(email),
        name=name.strip(),
        password_hash=hash_password(password) if password else "!" + secrets.token_hex(16),
        avatar_color=random.choice(AVATAR_COLORS),
        created_at=now_ms(),
        email_verified=email_verified,
        google_sub=google_sub,
        token_version=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def claim_unowned_data(db: Session, user: User) -> int:
    """
    Give the first account the data created before accounts existed.

    Returns the number of documents claimed (0 when there was nothing to claim).
    """
    claimed = db.query(Document).filter(Document.user_id.is_(None)).update({Document.user_id: user.id}, synchronize_session=False)
    for model in (ChatMessage, StudySet, StudyActivity):
        db.query(model).filter(model.user_id.is_(None)).update({model.user_id: user.id}, synchronize_session=False)
    db.commit()
    return claimed


# --- One-time email codes (verify the address / reset the password) -------------------------------

CODE_TTL_MS = 15 * 60 * 1000
CODE_MAX_ATTEMPTS = 5
CODE_RESEND_COOLDOWN_MS = 60 * 1000
CODES_PER_HOUR = 5


def _hash_code(code: str) -> str:
    # Keyed with the token secret, so a leaked database alone doesn't reveal codes
    return hmac.new(settings.secret_key.encode(), code.encode(), hashlib.sha256).hexdigest()


def issue_code(db: Session, user: User, purpose: str) -> str:
    """A fresh 6-digit code for the user (earlier unused codes for the same purpose stop working)."""
    now = now_ms()
    recent = db.query(EmailCode).filter(
        EmailCode.user_id == user.id, EmailCode.purpose == purpose, EmailCode.created_at > now - 3600 * 1000
    ).order_by(EmailCode.created_at.desc()).all()
    if recent and now - recent[0].created_at < CODE_RESEND_COOLDOWN_MS:
        wait = max(1, (CODE_RESEND_COOLDOWN_MS - (now - recent[0].created_at)) // 1000)
        raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds before asking for another code.",
                            headers={"Retry-After": str(wait)})
    if len(recent) >= CODES_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many codes requested. Please try again in an hour.")

    db.query(EmailCode).filter(
        EmailCode.user_id == user.id, EmailCode.purpose == purpose, EmailCode.used_at.is_(None)
    ).update({EmailCode.used_at: now}, synchronize_session=False)
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(EmailCode(id=uuid.uuid4().hex, user_id=user.id, purpose=purpose, code_hash=_hash_code(code),
                     expires_at=now + CODE_TTL_MS, attempts=0, created_at=now))
    db.commit()
    return code


def consume_code(db: Session, user: Optional[User], purpose: str, code: str) -> bool:
    """True (and the code is used up) when `code` is the user's current, unexpired code."""
    if user is None:
        return False
    now = now_ms()
    entry = db.query(EmailCode).filter(
        EmailCode.user_id == user.id, EmailCode.purpose == purpose, EmailCode.used_at.is_(None)
    ).order_by(EmailCode.created_at.desc()).first()
    if entry is None or entry.expires_at < now:
        return False
    entry.attempts = (entry.attempts or 0) + 1
    ok = hmac.compare_digest(entry.code_hash, _hash_code(code.strip()))
    if ok or entry.attempts >= CODE_MAX_ATTEMPTS:
        entry.used_at = now
    db.commit()
    return ok


# --- Google sign-in ------------------------------------------------------------------------------------

def google_client_ids() -> list:
    return [c.strip() for c in settings.google_client_ids.split(",") if c.strip()]


def verify_google_token(id_token: str) -> dict:
    """The verified claims of a Google ID token (401 when it is invalid, expired or for another app)."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    audiences = google_client_ids()
    if not audiences:
        raise HTTPException(status_code=503, detail="Google sign-in isn't set up on this server yet.")
    try:
        claims = google_id_token.verify_oauth2_token(id_token, google_requests.Request(), audience=audiences)
    except ValueError:
        raise HTTPException(status_code=401, detail="Google sign-in failed. Please try again.")
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=401, detail="Google sign-in failed. Please try again.")
    if not claims.get("email") or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Your Google account's email isn't verified.")
    return claims


def get_user_document(db: Session, user: User, document_id: str) -> Document:
    """A document owned by the user (404 otherwise, so other users' IDs aren't revealed)."""
    document = db.query(Document).filter(Document.id == document_id, Document.user_id == user.id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document
