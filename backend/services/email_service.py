"""
Sending MindAI's emails (verification and password-reset codes) over SMTP.

Works with Gmail (an App password) today and any provider later (Resend, Brevo...) by changing .env only.
Without SMTP settings the email is printed to the console instead, so local development needs no setup.
"""
import html
import logging
import smtplib
import threading
import time
import uuid
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from fastapi.concurrency import run_in_threadpool

from config import get_settings, resolve_path

settings = get_settings()
logger = logging.getLogger("mindai.email")

CODE_MINUTES = 15


class EmailError(Exception):
    """The email could not be sent."""


def email_configured() -> bool:
    return bool(settings.smtp_user and settings.smtp_password)


def _send_sync(to: str, subject: str, html_body: str, text_body: str) -> None:
    sender = settings.mail_from or settings.smtp_user
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.mail_from_name, sender or "no-reply@mindai.local"))
    msg["To"] = to
    msg["Message-ID"] = make_msgid(domain=(sender.split("@")[-1] if sender else "mindai.local"))
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    if settings.email_outbox_dir:
        outbox = Path(resolve_path(settings.email_outbox_dir))
        outbox.mkdir(parents=True, exist_ok=True)
        (outbox / f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}.eml").write_bytes(bytes(msg))

    if not email_configured():
        logger.warning("SMTP is not configured - email to %s not sent:\n%s\n%s", to, subject, text_body)
        print(f"\n--- EMAIL (SMTP not configured) to {to}: {subject}\n{text_body}\n---\n", flush=True)
        return

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        logger.error("Sending email to %s failed: %s", to, e)
        raise EmailError("We couldn't send the email right now. Please try again in a minute.") from e


async def send_email(to: str, subject: str, html_body: str, text_body: str) -> None:
    await run_in_threadpool(_send_sync, to, subject, html_body, text_body)


def send_email_in_background(to: str, subject: str, html_body: str, text_body: str) -> None:
    """
    Send without making the person wait: talking to Gmail (connect, TLS, login, send) takes ~2 s, which
    signing up or asking for a reset code shouldn't sit through. The code arrives a moment later; a failure is
    logged, and "Resend code" (which does wait, to report errors) is there if it never arrives.
    Without SMTP (development, tests) the email is only written out, which is instant, so it stays in line.
    """
    if not email_configured():
        _send_sync(to, subject, html_body, text_body)
        return

    def run():
        try:
            _send_sync(to, subject, html_body, text_body)
        except EmailError:
            pass  # Already logged with the reason

    threading.Thread(target=run, name="send-email", daemon=True).start()


# ---------------------------------------------------------------------------------------------
# Templates: table layout + inline styles, the only thing every mail app (Gmail, Outlook, phones) renders reliably

def _layout(preheader: str, heading: str, intro: str, code: str, note: str) -> str:
    digits = "".join(
        f'<td style="padding:0 4px;"><div style="width:44px;height:56px;line-height:56px;border-radius:12px;'
        f'background:#f5f3ff;border:1px solid #ddd6fe;font-family:\'Segoe UI\',Arial,sans-serif;font-size:28px;'
        f'font-weight:700;color:#4c1d95;text-align:center;">{d}</div></td>'
        for d in code
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>{html.escape(heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f0f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{html.escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f0f7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(76,29,149,0.10);">
    <tr><td style="background:#0b0a1a;background-image:linear-gradient(135deg,#1e1145 0%,#0b0a1a 70%);padding:28px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:44px;height:44px;border-radius:12px;background:#7c3aed;background-image:linear-gradient(135deg,#8b5cf6,#4f46e5);text-align:center;vertical-align:middle;font-family:'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;">M</td>
        <td style="padding-left:12px;font-family:'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:700;color:#ffffff;">Mind<span style="color:#a78bfa;">AI</span>
          <div style="font-size:12px;font-weight:500;color:#a1a1c2;letter-spacing:0.3px;">Your intelligent study companion</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:36px 32px 8px;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;">{html.escape(heading)}</h1>
      <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#475569;">{intro}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr>{digits}</tr></table>
      <p style="margin:24px 0 0;text-align:center;font-size:13px;color:#7c3aed;font-weight:600;">This code expires in {CODE_MINUTES} minutes.</p>
    </td></tr>
    <tr><td style="padding:28px 32px 32px;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="border-top:1px solid #eef0f4;padding-top:20px;font-size:13px;line-height:1.6;color:#64748b;">{note}</div>
    </td></tr>
  </table>
  <p style="margin:20px 0 0;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#94a3b8;">MindAI &middot; Study smarter with an AI that knows your notes.<br>This is an automated message, please don't reply.</p>
</td></tr></table>
</body></html>"""


def verification_email(name: str, code: str) -> tuple:
    first = html.escape(name.split()[0] if name.strip() else "there")
    subject = f"{code} is your MindAI verification code"
    body = _layout(
        preheader=f"Your MindAI verification code is {code}",
        heading="Confirm your email",
        intro=f"Hi {first}, welcome to MindAI! Enter this code in the app to confirm your email address and finish creating your account.",
        code=code,
        note="If you didn't create a MindAI account, you can safely ignore this email - no account will be activated without this code.",
    )
    text = (f"Hi {name},\n\nWelcome to MindAI! Your verification code is: {code}\n\n"
            f"Enter it in the app to confirm your email. It expires in {CODE_MINUTES} minutes.\n\n"
            "If you didn't create a MindAI account, ignore this email.\n\n- MindAI")
    return subject, body, text


def password_reset_email(name: str, code: str) -> tuple:
    first = html.escape(name.split()[0] if name.strip() else "there")
    subject = f"{code} is your MindAI password reset code"
    body = _layout(
        preheader=f"Your MindAI password reset code is {code}",
        heading="Reset your password",
        intro=f"Hi {first}, we received a request to reset your MindAI password. Enter this code in the app to choose a new one.",
        code=code,
        note="If you didn't ask to reset your password, ignore this email - your password stays the same. "
             "Never share this code with anyone; MindAI will never ask you for it.",
    )
    text = (f"Hi {name},\n\nYour MindAI password reset code is: {code}\n\n"
            f"Enter it in the app to choose a new password. It expires in {CODE_MINUTES} minutes.\n\n"
            "If you didn't ask for this, ignore this email - your password stays the same.\n\n- MindAI")
    return subject, body, text
