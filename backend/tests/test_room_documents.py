"""Study rooms: a message can be about one shared document, and the AI then answers from that document only."""

import pytest

from tests.test_auth import new_email, signup_and_verify
from tests.test_conversations import add_document, auth, me


@pytest.fixture
def fake_room_ai(monkeypatch):
    """Record which documents the room AI searched; answer with fixed text."""
    import services.room_service as room_service

    calls = {"searched": [], "prompts": []}

    def get_sources(query, document_ids):
        calls["searched"].append(list(document_ids))
        return [{"n": 1, "document_id": document_ids[0], "document_title": "doc", "text": "Passage.", "location": ""}]

    async def stream_completion(messages, temperature=0.7, max_tokens=2048):
        calls["prompts"].append(messages)
        yield "Answer [1]."

    monkeypatch.setattr(room_service.rag_service, "get_sources", get_sources)
    monkeypatch.setattr(room_service, "stream_completion", stream_completion)
    return calls


def receive_until(ws, kind, limit=30):
    for _ in range(limit):
        event = ws.receive_json()
        if event["type"] == kind:
            return event
    raise AssertionError(f"no {kind} event")


def test_message_about_a_document_focuses_the_ai(client, outbox, fake_room_ai):
    token = signup_and_verify(client, outbox, new_email())
    user_id = me(client, token)["id"]
    cells = add_document(user_id, "cell_biology.md")
    plants = add_document(user_id, "photosynthesis.md")
    secret = add_document(user_id, "not_shared.md")
    room = client.post("/api/rooms", json={"name": "BIO-101"}, headers=auth(token)).json()
    for doc in (cells, plants):
        assert client.post(f"/api/rooms/{room['id']}/documents", json={"document_id": doc}, headers=auth(token)).status_code == 200

    with client.websocket_connect(f"/api/rooms/{room['id']}/ws?token={token}") as ws:
        # About one document: the message is labelled, and the AI searches that document alone
        ws.send_json({"type": "message", "text": "What makes ATP?", "ask_ai": True, "document_id": plants})
        message = receive_until(ws, "message")["message"]
        assert message["data"] == {"document_id": plants, "document_title": "photosynthesis.md"}
        start = receive_until(ws, "ai_start")
        assert start["document"] == {"id": plants, "title": "photosynthesis.md"}
        done = receive_until(ws, "ai_done")["message"]
        assert done["data"]["document_title"] == "photosynthesis.md"
        assert fake_room_ai["searched"][-1] == [plants]
        assert 'ABOUT ONE DOCUMENT: "photosynthesis.md"' in fake_room_ai["prompts"][-1][0]["content"]

        # No document picked: every shared document, as before
        ws.send_json({"type": "message", "text": "Compare them", "ask_ai": True})
        assert receive_until(ws, "message")["message"]["data"] is None
        receive_until(ws, "ai_done")
        assert sorted(fake_room_ai["searched"][-1]) == sorted([cells, plants])

        # A document that isn't shared in the room is ignored (no label, no access to it)
        ws.send_json({"type": "message", "text": "Peek", "ask_ai": True, "document_id": secret})
        assert receive_until(ws, "message")["message"]["data"] is None
        receive_until(ws, "ai_done")
        assert secret not in fake_room_ai["searched"][-1]

        # Members can talk about a document without asking the AI: the label is still there
        ws.send_json({"type": "message", "text": "Page 3 is confusing", "document_id": cells})
        assert receive_until(ws, "message")["message"]["data"]["document_title"] == "cell_biology.md"
