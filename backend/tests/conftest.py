"""
Test setup: every test session runs against its own temporary database, upload folder and email outbox,
with SMTP switched off (emails are written to the outbox instead of being sent) and no real Google calls.

Run from backend/:  venv\\Scripts\\python.exe -m pytest
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

_TMP = Path(tempfile.mkdtemp(prefix="mindai-tests-"))
os.environ.update({
    "DATABASE_URL": f"sqlite:///{(_TMP / 'test.db').as_posix()}",
    "UPLOAD_DIR": str(_TMP / "uploads"),
    "CHROMA_PERSIST_DIR": str(_TMP / "chroma"),
    "EMAIL_OUTBOX_DIR": str(_TMP / "outbox"),
    "SMTP_USER": "",
    "SMTP_PASSWORD": "",
    "GOOGLE_CLIENT_IDS": "test-client.apps.googleusercontent.com",
    "SECRET_KEY": "test-secret-key-for-the-test-suite-only",
    "GROQ_API_KEY": os.environ.get("GROQ_API_KEY", "test-key"),
})


@pytest.fixture(scope="session")
def outbox() -> Path:
    return _TMP / "outbox"


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from database import init_db
    from main import app

    init_db()
    with TestClient(app) as c:
        yield c


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP, ignore_errors=True)
