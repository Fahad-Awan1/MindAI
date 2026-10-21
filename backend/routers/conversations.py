"""
Chat history like ChatGPT / Claude: a list of chats you can reopen and continue, rename, pin, move into a
project, search and delete. Sending a message streams the answer and stores both in the chat.
"""
import json
import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import Conversation, User
from routers.chat import find_sources, with_persona
from services.auth_service import get_current_user
from services.conversation_service import (
    TITLE_MAX,
    clean_title,
    draft_conversation,
    get_user_conversation,
    get_user_project,
    history_for_ai,
    list_conversations,
    prompt_for,
    save_messages,
    summary,
    title_from_text,
)
from services.groq_service import AIServiceError, generate_chat_title, normalize_citations
from services.rag_service import format_sources
from services.streaming import ndjson, stream_answer, streaming_response

router = APIRouter(prefix="/api/conversations", tags=["conversations"])
log = logging.getLogger(__name__)

Persona = Literal["explainer", "skeptic", "novice", "devil"]


class SendRequest(BaseModel):
    # Continue this chat, or (when empty) start a new one of the given kind
    conversation_id: Optional[str] = None
    scope: Literal["document", "all", "project"] = "document"
    document_id: Optional[str] = None
    project_id: Optional[str] = None
    message: str = Field(min_length=1, max_length=8000)
    persona: Optional[Persona] = None


class ConversationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=TITLE_MAX)
    pinned: Optional[bool] = None
    # Move into a project ("" or null with move=true takes it out)
    project_id: Optional[str] = None
    move: bool = False


def _messages(conversation: Conversation) -> List[dict]:
    return [{
        "id": m.id,
        "role": m.role,
        "text": m.text,
        "timestamp": m.timestamp,
        "sources": json.loads(m.sources) if m.sources else None,
        "persona": m.persona,
    } for m in conversation.messages]


@router.get("")
def list_chats(
    project_id: Optional[str] = None,
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Chats, newest first (pinned on top), optionally only one project's or only those matching a search."""
    if project_id:
        get_user_project(db, user, project_id)
    return list_conversations(db, user, project_id=project_id, query=q, limit=limit, offset=offset)


@router.get("/{conversation_id}")
def open_chat(conversation_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conversation = get_user_conversation(db, user, conversation_id)
    return {**summary(conversation), "messages": _messages(conversation)}


@router.patch("/{conversation_id}")
def update_chat(conversation_id: str, update: ConversationUpdate, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    conversation = get_user_conversation(db, user, conversation_id)
    if update.title is not None:
        title = update.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="The title can't be empty.")
        conversation.title = title
        conversation.title_is_auto = False
    if update.pinned is not None:
        conversation.pinned = update.pinned
    if update.move:
        if update.project_id:
            get_user_project(db, user, update.project_id)
            conversation.project_id = update.project_id
            # In a project the chat answers from the project's documents and instructions
            conversation.scope = "project"
            conversation.document_id = None
        else:
            if conversation.scope == "project":
                conversation.scope = "all"
            conversation.project_id = None
    db.commit()
    return summary(conversation)


@router.delete("/{conversation_id}", status_code=204)
def delete_chat(conversation_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(get_user_conversation(db, user, conversation_id))
    db.commit()
    return Response(status_code=204)


@router.post("/stream")
async def send(request: SendRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Ask in a chat (new or existing), streaming NDJSON:
      {"type": "conversation", "conversation": {...}}   the chat (just created, or the one continued)
      {"type": "sources", "sources": [...]}, then deltas, then {"type": "done", "chat_id": ...}
      {"type": "title", "conversation_id": ..., "title": ...}   a better title, after a new chat's first answer
    """
    if request.conversation_id:
        conversation = get_user_conversation(db, user, request.conversation_id)
        draft = None
        history = history_for_ai(db, conversation)
        info = summary(conversation)  # Built now: the request's DB session may be closed while streaming
    else:
        # A new chat gets its ID now but is stored only with its first answer
        draft, info = draft_conversation(db, user, request.scope, request.document_id, request.project_id,
                                         request.persona, title=title_from_text(request.message))
        conversation = Conversation(**draft)  # Not added to the session
        history = []

    messages, sources = await prompt_for(db, user, conversation, history, request.message, find_sources, format_sources)
    messages = with_persona(messages, request.persona)

    conversation_id = conversation.id
    first_answer = draft is not None or (conversation.title_is_auto and not history)
    answer = {"text": ""}

    def persist(text: str) -> Optional[str]:
        answer["text"] = text
        session = SessionLocal()
        try:
            return save_messages(session, conversation_id, user.id, request.message, normalize_citations(text),
                                 sources, request.persona, draft=draft)
        finally:
            session.close()

    async def events():
        yield ndjson({"type": "conversation", "conversation": info})
        async for line in stream_answer(messages, on_finish=persist, prelude=[{"type": "sources", "sources": sources}]):
            yield line
        if not answer["text"].strip():
            return  # Nothing was answered (so a new chat was never stored)
        session = SessionLocal()
        try:
            saved = session.query(Conversation).filter(Conversation.id == conversation_id).first()
            if saved is None:
                return
            if first_answer and saved.title_is_auto:
                try:
                    title = clean_title(await generate_chat_title(request.message, answer["text"]))
                except AIServiceError as e:
                    log.info("Chat title not generated: %s", e)
                    title = ""
                if title:
                    saved.title = title
                    session.commit()
                    yield ndjson({"type": "title", "conversation_id": conversation_id, "title": title})
        finally:
            session.close()

    return streaming_response(events())
