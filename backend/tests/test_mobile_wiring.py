"""Fixes from the mobile audit: export names over CORS, non-Latin titles, stuck imports, socket input, log redaction."""
import json
import logging
import time
import uuid
from urllib.parse import unquote

from tests.test_auth import new_email, signup_and_verify

APP_ORIGIN = "https://localhost"  # The Android app (Capacitor)


def make_quiz(user_id: str, title: str) -> str:
    from database import SessionLocal
    from models import Document, StudySet

    db = SessionLocal()
    try:
        doc = Document(id=uuid.uuid4().hex, user_id=user_id, title="notes.md", content="Cells are the unit of life.",
                       type="markdown", created_at=int(time.time() * 1000), summary="")
        db.add(doc)
        questions = [{"id": "q1", "type": "mcq", "question": "What is the unit of life?",
                      "options": ["Cell", "Atom", "Organ", "Tissue"], "correct_answer_index": 0, "explanation": ""}]
        quiz = StudySet(id=uuid.uuid4().hex, document_id=doc.id, user_id=user_id, kind="quiz", title=title,
                        data=json.dumps(questions), config=json.dumps({"schema": 2}), created_at=int(time.time() * 1000))
        db.add(quiz)
        db.commit()
        return quiz.id
    finally:
        db.close()


def signed_in(client, outbox):
    token = signup_and_verify(client, outbox, new_email())
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers).json()
    return headers, me


def test_cors_allows_the_app_and_exposes_the_export_name(client, outbox):
    headers, me = signed_in(client, outbox)
    quiz = make_quiz(me["id"], "Cell biology")
    r = client.get(f"/api/assessment/sets/{quiz}/export", params={"format": "gift"}, headers={**headers, "Origin": APP_ORIGIN})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == APP_ORIGIN
    assert "content-disposition" in r.headers["access-control-expose-headers"].lower()
    assert 'filename="Cell_biology.gift.txt"' in r.headers["content-disposition"]


def test_export_with_a_non_latin_title(client, outbox):
    headers, me = signed_in(client, outbox)
    title = "خلیاتی حیاتیات"
    quiz = make_quiz(me["id"], title)
    for fmt in ("docx", "csv", "kahoot"):
        r = client.get(f"/api/assessment/sets/{quiz}/export", params={"format": fmt}, headers=headers)
        assert r.status_code == 200, (fmt, r.text)
        disposition = r.headers["content-disposition"]
        assert "filename*=UTF-8''" in disposition
        assert unquote(disposition.split("filename*=UTF-8''")[1]).startswith(title.replace(" ", "_"))


def test_failed_recording_upload_does_not_leave_a_queued_job(client, outbox):
    headers, _ = signed_in(client, outbox)
    r = client.post("/api/imports/media", headers=headers, files={"file": ("lecture.mp3", b"", "audio/mpeg")})
    assert r.status_code == 400
    jobs = client.get("/api/imports", headers=headers).json()
    assert jobs and jobs[0]["status"] == "failed"
    # ...and it can be dismissed
    assert client.delete(f"/api/imports/{jobs[0]['id']}", headers=headers).status_code == 200


def test_room_socket_survives_bad_numbers_and_answers_ping(client, outbox):
    headers, _ = signed_in(client, outbox)
    room = client.post("/api/rooms", json={"name": "Test room"}, headers=headers).json()
    token = headers["Authorization"].split()[1]
    with client.websocket_connect(f"/api/rooms/{room['id']}/ws?token={token}") as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "quiz_answer", "index": "not-a-number", "option": None})
        ws.send_json({"type": "ping"})
        for _ in range(5):
            event = ws.receive_json()
            if event["type"] == "pong":
                break
        assert event["type"] == "pong"


def test_tokens_are_hidden_in_the_access_log():
    import main

    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s"',
                               ("1.2.3.4", "GET", "/api/rooms/abc/ws?token=eyJhbGci.secret&x=1"), None)
    main._RedactTokens().filter(record)
    assert "secret" not in record.getMessage() and "token=[hidden]" in record.getMessage()
