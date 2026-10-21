"""Chat history (conversations) and projects. The AI and the vector search are replaced by fakes."""
import json
import time
import uuid

import pytest

from tests.test_auth import new_email, signup_and_verify


@pytest.fixture
def fake_ai(monkeypatch):
    """Record the prompts sent to the AI; answer with fixed text; title chats "Cell energy"."""
    import routers.conversations as conversations
    import routers.chat as chat
    import services.streaming as streaming
    from services.groq_service import AIServiceError

    calls = {"prompts": [], "fail": False}

    async def stream_completion(messages, temperature=0.7, max_tokens=2048):
        calls["prompts"].append(messages)
        if calls["fail"]:
            raise AIServiceError("The AI service is busy.")
        for piece in ("Mitochondria ", "make ATP [1]."):
            yield piece

    async def generate_chat_title(first_message, answer):
        return '"Cell energy."'

    async def find_sources(query, document_ids):
        return [{"n": 1, "document_id": document_ids[0], "document_title": "cell_biology.md", "text": "Mitochondria make ATP.", "location": "p. 1"}]

    monkeypatch.setattr(streaming, "stream_completion", stream_completion)
    monkeypatch.setattr(conversations, "generate_chat_title", generate_chat_title)
    monkeypatch.setattr(conversations, "find_sources", find_sources)
    monkeypatch.setattr(chat, "find_sources", find_sources)
    return calls


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def me(client, token):
    return client.get("/api/auth/me", headers=auth(token)).json()


def add_document(user_id, title="cell_biology.md"):
    from database import SessionLocal
    from models import Document
    db = SessionLocal()
    try:
        doc = Document(id=uuid.uuid4().hex, user_id=user_id, title=title, content="Mitochondria make ATP.",
                       type="text", created_at=int(time.time() * 1000))
        db.add(doc)
        db.commit()
        return doc.id
    finally:
        db.close()


def send(client, token, **body):
    r = client.post("/api/conversations/stream", json=body, headers=auth(token))
    assert r.status_code == 200, r.text
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


@pytest.fixture
def account(client, outbox):
    token = signup_and_verify(client, outbox, new_email())
    user = me(client, token)
    return token, user["id"], add_document(user["id"])


def test_new_chat_streams_and_gets_a_title(client, account, fake_ai):
    token, _, doc_id = account
    events = send(client, token, scope="document", document_id=doc_id, message="What do mitochondria do?")
    kinds = [e["type"] for e in events]
    assert kinds[0] == "conversation" and "sources" in kinds and "delta" in kinds and "done" in kinds
    assert events[-1] == {"type": "title", "conversation_id": events[0]["conversation"]["id"], "title": "Cell energy"}

    chat = client.get(f"/api/conversations/{events[0]['conversation']['id']}", headers=auth(token)).json()
    assert chat["title"] == "Cell energy" and chat["document_title"] == "cell_biology.md"
    assert [m["role"] for m in chat["messages"]] == ["user", "model"]
    assert chat["messages"][1]["text"] == "Mitochondria make ATP [1]." and chat["messages"][1]["sources"]


def test_continuing_a_chat_sends_its_history(client, account, fake_ai):
    token, _, doc_id = account
    first = send(client, token, scope="document", document_id=doc_id, message="What do mitochondria do?")
    chat_id = first[0]["conversation"]["id"]
    second = send(client, token, conversation_id=chat_id, message="And chloroplasts?")
    assert second[0]["conversation"]["id"] == chat_id
    assert not any(e["type"] == "title" for e in second)  # Only the first answer names the chat

    prompt = fake_ai["prompts"][-1]
    assert [m["content"] for m in prompt[1:]] == ["What do mitochondria do?", "Mitochondria make ATP [1].", "And chloroplasts?"]
    chat = client.get(f"/api/conversations/{chat_id}", headers=auth(token)).json()
    assert len(chat["messages"]) == 4


def test_list_rename_pin_search_delete(client, account, fake_ai):
    token, _, doc_id = account
    a = send(client, token, scope="document", document_id=doc_id, message="What do mitochondria do?")[0]["conversation"]["id"]
    b = send(client, token, scope="all", message="Compare the two cell types")[0]["conversation"]["id"]

    listed = client.get("/api/conversations", headers=auth(token)).json()
    assert [c["id"] for c in listed][:2] == [b, a]  # Newest first

    r = client.patch(f"/api/conversations/{a}", json={"title": "My ATP notes", "pinned": True}, headers=auth(token))
    assert r.json()["title"] == "My ATP notes" and r.json()["pinned"] is True
    assert client.get("/api/conversations", headers=auth(token)).json()[0]["id"] == a  # Pinned on top
    # A renamed chat keeps its name when it is continued
    send(client, token, conversation_id=a, message="More detail please")
    assert client.get(f"/api/conversations/{a}", headers=auth(token)).json()["title"] == "My ATP notes"

    found = client.get("/api/conversations", params={"q": "cell types"}, headers=auth(token)).json()
    assert [c["id"] for c in found] == [b]
    by_text = client.get("/api/conversations", params={"q": "make ATP"}, headers=auth(token)).json()
    assert {c["id"] for c in by_text} == {a, b} and all(c["snippet"] for c in by_text if c["title"] != "make ATP")

    assert client.delete(f"/api/conversations/{a}", headers=auth(token)).status_code == 204
    assert client.get(f"/api/conversations/{a}", headers=auth(token)).status_code == 404


def test_chats_are_private(client, outbox, account, fake_ai):
    token, _, doc_id = account
    chat_id = send(client, token, scope="document", document_id=doc_id, message="Hi")[0]["conversation"]["id"]
    other = signup_and_verify(client, outbox, new_email())
    assert client.get(f"/api/conversations/{chat_id}", headers=auth(other)).status_code == 404
    assert client.delete(f"/api/conversations/{chat_id}", headers=auth(other)).status_code == 404
    r = client.post("/api/conversations/stream", json={"conversation_id": chat_id, "message": "x"}, headers=auth(other))
    assert r.status_code == 404
    r = client.post("/api/conversations/stream", json={"scope": "document", "document_id": doc_id, "message": "x"}, headers=auth(other))
    assert r.status_code == 404
    assert all(c["id"] != chat_id for c in client.get("/api/conversations", headers=auth(other)).json())


def test_failed_first_answer_leaves_no_empty_chat(client, account, fake_ai):
    token, _, doc_id = account
    before = len(client.get("/api/conversations", headers=auth(token)).json())
    fake_ai["fail"] = True
    events = send(client, token, scope="document", document_id=doc_id, message="Hello?")
    assert events[-1]["type"] == "error"
    assert len(client.get("/api/conversations", headers=auth(token)).json()) == before


def test_projects_use_their_documents_and_instructions(client, account, fake_ai):
    token, user_id, doc_id = account
    project = client.post("/api/projects", json={"name": "BIO-101", "description": "First-year biology",
                                                 "instructions": "Answer in simple English and end with a quiz question."},
                          headers=auth(token)).json()
    pid = project["id"]
    assert client.put(f"/api/projects/{pid}/documents/{doc_id}", headers=auth(token)).status_code == 204
    client.put(f"/api/projects/{pid}/documents/{doc_id}", headers=auth(token))  # Adding twice is harmless

    events = send(client, token, scope="project", project_id=pid, message="What makes ATP?")
    chat_id = events[0]["conversation"]["id"]
    system = fake_ai["prompts"][-1][0]["content"]
    assert "BIO-101" in system and "end with a quiz question" in system and "Mitochondria make ATP." in system

    opened = client.get(f"/api/projects/{pid}", headers=auth(token)).json()
    assert opened["document_count"] == 1 and opened["chat_count"] == 1
    assert [d["id"] for d in opened["documents"]] == [doc_id] and [c["id"] for c in opened["chats"]] == [chat_id]
    listed = client.get("/api/conversations", params={"project_id": pid}, headers=auth(token)).json()
    assert [c["project_name"] for c in listed] == ["BIO-101"]

    # Deleting the project deletes its chats but keeps the document
    assert client.delete(f"/api/projects/{pid}", headers=auth(token)).status_code == 204
    assert client.get(f"/api/conversations/{chat_id}", headers=auth(token)).status_code == 404
    assert any(d["id"] == doc_id for d in client.get("/api/documents", headers=auth(token)).json())


def test_project_without_documents_still_answers(client, account, fake_ai):
    token, _, _ = account
    pid = client.post("/api/projects", json={"name": "Essay ideas"}, headers=auth(token)).json()["id"]
    events = send(client, token, scope="project", project_id=pid, message="Help me outline an essay")
    assert any(e["type"] == "done" for e in events)
    assert "no documents yet" in fake_ai["prompts"][-1][0]["content"]


def test_move_chat_into_and_out_of_a_project(client, account, fake_ai):
    token, _, doc_id = account
    chat_id = send(client, token, scope="document", document_id=doc_id, message="Hi")[0]["conversation"]["id"]
    pid = client.post("/api/projects", json={"name": "Exam prep"}, headers=auth(token)).json()["id"]
    moved = client.patch(f"/api/conversations/{chat_id}", json={"move": True, "project_id": pid}, headers=auth(token)).json()
    assert moved["project_id"] == pid and moved["scope"] == "project"
    out = client.patch(f"/api/conversations/{chat_id}", json={"move": True, "project_id": None}, headers=auth(token)).json()
    assert out["project_id"] is None and out["scope"] == "all"


def test_old_messages_become_chats(client, account):
    """Messages saved before chat history existed are grouped into one chat per document (and one for all documents)."""
    from database import SessionLocal
    from models import ChatMessage
    token, user_id, doc_id = account
    db = SessionLocal()
    try:
        rows = [(doc_id, False, "user", "Summarise the cell chapter"), (doc_id, False, "model", "Cells are..."),
                (None, True, "user", "What links all my notes?"), (None, True, "model", "They all...")]
        for i, (document_id, is_kb, role, text) in enumerate(rows):
            db.add(ChatMessage(id=uuid.uuid4().hex, user_id=user_id, document_id=document_id, is_knowledge_base=is_kb,
                               role=role, text=text, timestamp=1_700_000_000_000 + i))
        db.commit()
    finally:
        db.close()

    chats = client.get("/api/conversations", headers=auth(token)).json()
    titles = {c["title"]: c for c in chats}
    assert titles["Summarise the cell chapter"]["scope"] == "document"
    assert titles["What links all my notes?"]["scope"] == "all"
    opened = client.get(f"/api/conversations/{titles['Summarise the cell chapter']['id']}", headers=auth(token)).json()
    assert [m["text"] for m in opened["messages"]] == ["Summarise the cell chapter", "Cells are..."]


def test_old_chat_endpoints_still_work(client, account, fake_ai):
    """App versions without chat history keep one thread per document."""
    token, _, doc_id = account
    for question in ("First question", "Second question"):
        r = client.post("/api/chat/document/stream", json={"document_id": doc_id, "message": question}, headers=auth(token))
        assert r.status_code == 200 and '"done"' in r.text
    history = client.get(f"/api/chat/history/{doc_id}", headers=auth(token)).json()
    assert [m["text"] for m in history if m["role"] == "user"] == ["First question", "Second question"]
    chats = [c for c in client.get("/api/conversations", headers=auth(token)).json() if c["document_id"] == doc_id]
    assert len(chats) == 1


def test_deleting_a_document_deletes_its_chats(client, account, fake_ai):
    token, _, doc_id = account
    chat_id = send(client, token, scope="document", document_id=doc_id, message="Hi")[0]["conversation"]["id"]
    assert client.delete(f"/api/documents/{doc_id}", headers=auth(token)).status_code in (200, 204)
    assert client.get(f"/api/conversations/{chat_id}", headers=auth(token)).status_code == 404


def test_reader_explanations_are_kept_as_chats(client, account, fake_ai, monkeypatch):
    """Explain / Simplify in the Reader (and its follow-ups) land in one chat that AI Chat can continue."""
    import routers.tutor as tutor

    async def document_context(document, query):
        return "Mitochondria make ATP."
    monkeypatch.setattr(tutor, "document_context", document_context)
    token, _, doc_id = account
    first = client.post("/api/tutor/selection/stream", headers=auth(token), json={
        "document_id": doc_id, "selection": "The mitochondrion is the powerhouse of the cell.", "action": "explain"})
    events = [json.loads(line) for line in first.text.splitlines() if line.strip()]
    chat = events[0]["conversation"]
    assert events[0]["type"] == "conversation" and chat["title"].startswith("Explain: The mitochondrion")
    follow = client.post("/api/tutor/selection/stream", headers=auth(token), json={
        "document_id": doc_id, "selection": "The mitochondrion is the powerhouse of the cell.", "action": "explain",
        "conversation_id": chat["id"], "history": [], "message": "Why ATP?"})
    assert json.loads(follow.text.splitlines()[0])["conversation"]["id"] == chat["id"]

    saved = client.get(f"/api/conversations/{chat['id']}", headers=auth(token)).json()
    assert [m["text"] for m in saved["messages"] if m["role"] == "user"] == [
        "Explain this passage:\n\n> The mitochondrion is the powerhouse of the cell.", "Why ATP?"]
    # ...and it continues in AI Chat with that history
    send(client, token, conversation_id=chat["id"], message="Summarise our talk")
    assert len(fake_ai["prompts"][-1]) == 1 + 4 + 1


def test_a_new_chat_is_stored_only_with_its_first_answer(client, account, fake_ai):
    token, _, doc_id = account
    before = {c["id"] for c in client.get("/api/conversations", headers=auth(token)).json()}
    fake_ai["fail"] = True
    events = send(client, token, scope="document", document_id=doc_id, message="Hello?")
    announced = events[0]["conversation"]["id"]
    assert events[-1]["type"] == "error"
    assert client.get(f"/api/conversations/{announced}", headers=auth(token)).status_code == 404
    assert {c["id"] for c in client.get("/api/conversations", headers=auth(token)).json()} == before
