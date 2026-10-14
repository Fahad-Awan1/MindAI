import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import get_db
from models import User
from services.auth_service import (
    check_login_rate,
    claim_unowned_data,
    clear_login_attempts,
    consume_code,
    create_token,
    create_user,
    get_current_user,
    hash_password,
    issue_code,
    normalize_email,
    verify_google_token,
    verify_password,
)
from services.email_service import EmailError, password_reset_email, send_email, verification_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CODE_PATTERN = r"^\d{6}$"


def _validate_email(value: str) -> str:
    value = normalize_email(value)
    if not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address.")
    return value


def _validate_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password is too long (max 72 bytes).")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("Password must contain both letters and numbers.")
    return value


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=254)
    password: str

    _email = field_validator("email")(_validate_email)
    _password = field_validator("password")(_validate_password)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter your name.")
        return value.strip()


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str

    _password = field_validator("new_password")(_validate_password)


class EmailRequest(BaseModel):
    email: str = Field(max_length=254)


class VerifyEmailRequest(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(pattern=CODE_PATTERN)


class ResetPasswordRequest(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(pattern=CODE_PATTERN)
    new_password: str

    _password = field_validator("new_password")(_validate_password)


class GoogleRequest(BaseModel):
    id_token: str = Field(min_length=20, max_length=4096)


class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    avatar_color: str
    created_at: int


class AuthResponse(BaseModel):
    # Missing while the email still has to be confirmed (then verification_required is set)
    token: Optional[str] = None
    user: Optional[UserResponse] = None
    # Documents from before accounts existed that were moved into this account
    claimed_documents: int = 0
    verification_required: bool = False
    email: Optional[str] = None


def to_user_response(user: User) -> UserResponse:
    return UserResponse(id=user.id, name=user.name, email=user.email, avatar_color=user.avatar_color, created_at=user.created_at)


async def send_verification(db: Session, user: User) -> None:
    """Email a fresh verification code (429 inside the resend cooldown, 502 when sending fails)."""
    code = issue_code(db, user, "verify")
    subject, html_body, text_body = verification_email(user.name, code)
    try:
        await send_email(user.email, subject, html_body, text_body)
    except EmailError as e:
        raise HTTPException(status_code=502, detail=str(e))


async def send_verification_quietly(db: Session, user: User) -> None:
    """Like send_verification, but a code sent moments ago (cooldown) is fine - that one still works."""
    try:
        await send_verification(db, user)
    except HTTPException as e:
        if e.status_code != 429:
            raise


def signed_in(db: Session, user: User) -> AuthResponse:
    """A login token for a confirmed user. The very first account also takes over study data from before accounts existed."""
    claimed = claim_unowned_data(db, user) if db.query(User).count() == 1 else 0
    return AuthResponse(token=create_token(user), user=to_user_response(user), claimed_documents=claimed)


def needs_verification(user: User) -> AuthResponse:
    return AuthResponse(verification_required=True, email=user.email)


def find_user(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == normalize_email(email)).first()


@router.post("/signup", response_model=AuthResponse)
async def signup(request: SignupRequest, http_request: Request, db: Session = Depends(get_db)):
    """Create an account and email a code to confirm the address; signing in works once it is confirmed."""
    check_login_rate(http_request, request.email, "signup")
    existing = find_user(db, request.email)
    if existing:
        # Signing up again before confirming, with the same password: just send a new code
        if not existing.email_verified and verify_password(request.password, existing.password_hash):
            await send_verification_quietly(db, existing)
            return needs_verification(existing)
        raise HTTPException(status_code=409, detail="An account with this email already exists. Try signing in.")

    user = create_user(db, request.name, request.email, request.password)
    await send_verification(db, user)
    return needs_verification(user)


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest, http_request: Request, db: Session = Depends(get_db)):
    """Sign in with email and password (an unconfirmed email gets a fresh code instead of a token)."""
    check_login_rate(http_request, request.email)
    user = find_user(db, request.email)
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    clear_login_attempts(http_request, request.email)
    if not user.email_verified:
        await send_verification_quietly(db, user)
        return needs_verification(user)
    return signed_in(db, user)


@router.post("/verify-email", response_model=AuthResponse)
def verify_email(request: VerifyEmailRequest, http_request: Request, db: Session = Depends(get_db)):
    """Confirm the email with the emailed code; returns a login token."""
    check_login_rate(http_request, request.email, "verify")
    user = find_user(db, request.email)
    if user and user.email_verified:
        raise HTTPException(status_code=400, detail="This email is already confirmed. Please sign in.")
    if not consume_code(db, user, "verify", request.code):
        raise HTTPException(status_code=400, detail="That code is wrong or has expired. Check the latest email or ask for a new code.")
    user.email_verified = True
    db.commit()
    clear_login_attempts(http_request, request.email, "verify")
    return signed_in(db, user)


@router.post("/resend-verification")
async def resend_verification(request: EmailRequest, db: Session = Depends(get_db)):
    """Send another verification code (the same answer whether or not the account exists)."""
    user = find_user(db, request.email)
    if user and not user.email_verified:
        await send_verification(db, user)
    return {"message": "If that account is waiting for confirmation, a new code is on its way."}


@router.post("/forgot-password")
async def forgot_password(request: EmailRequest, http_request: Request, db: Session = Depends(get_db)):
    """Email a password-reset code. Always the same answer, so it doesn't reveal which emails have accounts."""
    check_login_rate(http_request, request.email, "forgot")
    user = find_user(db, request.email)
    if user:
        try:
            code = issue_code(db, user, "reset")
            subject, html_body, text_body = password_reset_email(user.name, code)
            await send_email(user.email, subject, html_body, text_body)
        except HTTPException as e:
            if e.status_code != 429:
                raise
        except EmailError as e:
            raise HTTPException(status_code=502, detail=str(e))
    return {"message": "If an account exists for that email, we've sent a code to reset the password."}


@router.post("/reset-password", response_model=AuthResponse)
def reset_password(request: ResetPasswordRequest, http_request: Request, db: Session = Depends(get_db)):
    """Set a new password with the emailed code. Signs out every other device and signs this one in."""
    check_login_rate(http_request, request.email, "reset")
    user = find_user(db, request.email)
    if not consume_code(db, user, "reset", request.code):
        raise HTTPException(status_code=400, detail="That code is wrong or has expired. Ask for a new one.")
    user.password_hash = hash_password(request.new_password)
    user.token_version = (user.token_version or 0) + 1
    user.email_verified = True  # The code proves they own the inbox
    db.commit()
    db.refresh(user)
    clear_login_attempts(http_request, request.email, "reset")
    return signed_in(db, user)


@router.post("/google", response_model=AuthResponse)
def google_sign_in(request: GoogleRequest, db: Session = Depends(get_db)):
    """Sign in (or sign up) with a Google ID token from the web button or the Android app."""
    claims = verify_google_token(request.id_token)
    sub, email = claims["sub"], normalize_email(claims["email"])
    user = db.query(User).filter(User.google_sub == sub).first()
    if user is None:
        user = find_user(db, email)
        if user:
            # Same email as an existing account: Google has verified it, so link the two
            user.google_sub = sub
            user.email_verified = True
            db.commit()
        else:
            name = (claims.get("name") or email.split("@")[0]).strip()[:80] or "Student"
            user = create_user(db, name, email, None, email_verified=True, google_sub=sub)
    return signed_in(db, user)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return to_user_response(user)


@router.post("/refresh", response_model=AuthResponse)
def refresh_session(user: User = Depends(get_current_user)):
    """A fresh login token for the signed-in user, so a session stays alive as long as the app keeps being used."""
    return AuthResponse(token=create_token(user), user=to_user_response(user))


@router.patch("/me", response_model=UserResponse)
def update_me(request: UpdateProfileRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Enter your name.")
    user.name = name
    db.commit()
    db.refresh(user)
    return to_user_response(user)


@router.post("/change-password")
def change_password(request: ChangePasswordRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(request.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    user.password_hash = hash_password(request.new_password)
    # Other devices are signed out; this one gets a fresh token
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)
    return {"message": "Password updated", "token": create_token(user)}
