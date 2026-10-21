"""
Chat history: conversations (one chat thread each), projects, and the prompt for each kind of chat.

A conversation answers from one document ("document"), from every document the user has ("all"),
or from a project's documents and instructions ("project").
"""
import json
import re
import time
import uuid
from typing import Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import ChatMessage, Conversation, Document, Project, ProjectDocument, User
from services.auth_service import get_user_document
from services.groq_service import (
    MAX_HISTORY_MESSAGES,
    build_document_messages,
    build_knowledge_base_messages,
    build_project_messages,
)

SCOPES = ("document", "all", "project")
TITLE_MAX = 80
NEW_CHAT_TITLE = "New chat"


def now_ms() -> int:
    return int(time.time() * 1000)


def title_from_text(text: str, limit: int = 60) -> str:
    """A readable provisional title from the first message: first line, no Markdown, cut at a word boundary."""
    line = next((ln.strip() for ln in (text or "").splitlines() if ln.strip()), "")
    line = re.sub(r"[#*_`>\[\]]+", "", line).strip()
    if len(line) <= limit:
        return line or NEW_CHAT_TITLE
    cut = line[:limit].rsplit(" ", 1)[0]
    return (cut or line[:limit]).rstrip(",.;:-") + "…"


def clean_title(raw: str) -> str:
    """Tidy an AI-written title (quotes, a "Title:" prefix, trailing dot)."""
    title = (raw or "").strip().splitlines()[0] if (raw or "").strip() else ""
    title = re.sub(r"^(title\s*:\s*)", "", title, flags=re.I).strip().strip("\"'“”‘’*").strip()
    return title.rstrip(".")[:TITLE_MAX]


# --- Ownership ------------------------------------------------------------------------------------

def get_user_conversation(db: Session, user: User, conversation_id: str) -> Conversation:
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id, Conversation.user_id == user.id).first()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return conversation


def get_user_project(db: Session, user: User, project_id: str) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user.id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def project_document_ids(db: Session, project_id: str) -> List[str]:
    return [doc_id for (doc_id,) in db.query(ProjectDocument.document_id).filter(ProjectDocument.project_id == project_id).all()]


def user_document_ids(db: Session, user_id: str) -> List[str]:
    return [doc_id for (doc_id,) in db.query(Document.id).filter(Document.user_id == user_id).all()]


# --- Older messages -> chats ------------------------------------------------------------------------

def backfill_conversations(db: Session, user_id: str) -> int:
    """
    Messages saved before chat history existed have no conversation: turn each old thread
    (one per document, one for "all documents") into a chat. Runs once per user; returns chats created.
    """
    loose = (db.query(ChatMessage)
             .filter(ChatMessage.user_id == user_id, ChatMessage.conversation_id.is_(None))
             .order_by(ChatMessage.timestamp).all())
    if not loose:
        return 0
    groups: Dict[Tuple[Optional[str], bool], List[ChatMessage]] = {}
    for message in loose:
        is_all = bool(message.is_knowledge_base) or not message.document_id
        groups.setdefault((None if is_all else message.document_id, is_all), []).append(message)

    for (document_id, is_all), messages in groups.items():
        first_user = next((m.text for m in messages if m.role == "user"), "")
        last_persona = next((m.persona for m in reversed(messages) if m.role == "model"), None)
        conversation = Conversation(
            id=uuid.uuid4().hex,
            user_id=user_id,
            scope="all" if is_all else "document",
            document_id=document_id,
            title=title_from_text(first_user),
            persona=last_persona,
            created_at=messages[0].timestamp,
            updated_at=messages[-1].timestamp,
        )
        db.add(conversation)
        for message in messages:
            message.conversation_id = conversation.id
    db.commit()
    return len(groups)


# --- Creating chats and saving messages -----------------------------------------------------------

def draft_conversation(db: Session, user: User, scope: str, document_id: Optional[str] = None,
                       project_id: Optional[str] = None, persona: Optional[str] = None,
                       title: str = NEW_CHAT_TITLE) -> Tuple[Dict, Dict]:
    """
    A new chat that is not stored yet: (its column values, its summary for the client).

    It is stored with its first answer (save_messages(..., draft=...)), so a chat whose first answer
    never arrives (stopped, failed, abandoned) doesn't linger empty in the history.
    """
    if scope not in SCOPES:
        raise HTTPException(status_code=400, detail="Unknown chat type")
    document = get_user_document(db, user, document_id or "") if scope == "document" else None
    project = get_user_project(db, user, project_id) if project_id else None
    if scope == "project" and not project:
        raise HTTPException(status_code=400, detail="project_id is required")
    stamp = now_ms()
    columns = dict(
        id=uuid.uuid4().hex, user_id=user.id, scope=scope,
        document_id=document.id if document else None,
        project_id=project.id if project else None, title=title[:TITLE_MAX] or NEW_CHAT_TITLE,
        title_is_auto=True, pinned=False, persona=persona, created_at=stamp, updated_at=stamp,
    )
    info = summary(Conversation(**columns), document_title=document.title if document else None,
                   project_name=project.name if project else None)
    return columns, info


def create_conversation(db: Session, user: User, scope: str, document_id: Optional[str] = None,
                        project_id: Optional[str] = None, persona: Optional[str] = None,
                        title: str = NEW_CHAT_TITLE) -> Conversation:
    columns, _ = draft_conversation(db, user, scope, document_id, project_id, persona, title)
    conversation = Conversation(**columns)
    db.add(conversation)
    db.commit()
    return conversation


def latest_legacy_conversation(db: Session, user: User, document_id: Optional[str], is_all: bool) -> Optional[Conversation]:
    """The most recent non-project chat of the old one-thread-per-document kind (for the old chat endpoints)."""
    query = db.query(Conversation).filter(Conversation.user_id == user.id, Conversation.project_id.is_(None))
    query = query.filter(Conversation.scope == "all") if is_all else query.filter(
        Conversation.scope == "document", Conversation.document_id == document_id)
    return query.order_by(Conversation.updated_at.desc()).first()


def save_messages(db: Session, conversation_id: str, user_id: str, user_text: str, model_text: str,
                  sources: Optional[List[Dict]] = None, persona: Optional[str] = None,
                  draft: Optional[Dict] = None) -> str:
    """
    Store one question and its answer in a chat, move the chat to the top; return the answer's message ID.

    `draft` (from draft_conversation) stores a new chat together with its first answer.
    """
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conversation is None:
        if draft is None:  # Deleted while the answer was streaming
            return ""
        conversation = Conversation(**draft)
        db.add(conversation)
    stamp = now_ms()
    model_id = f"{uuid.uuid4().hex}_model"
    common = dict(conversation_id=conversation.id, user_id=user_id, document_id=conversation.document_id,
                  is_knowledge_base=conversation.scope != "document")
    db.add(ChatMessage(id=f"{uuid.uuid4().hex}_user", role="user", text=user_text, timestamp=stamp, **common))
    db.add(ChatMessage(id=model_id, role="model", text=model_text, timestamp=stamp + 1,
                       sources=json.dumps(sources) if sources else None, persona=persona, **common))
    conversation.updated_at = stamp + 1
    conversation.persona = persona
    if conversation.project_id:
        db.query(Project).filter(Project.id == conversation.project_id).update({Project.updated_at: stamp + 1})
    db.commit()
    return model_id


def side_chat(db: Session, user: User, document_id: str, conversation_id: Optional[str], title: str,
              user_text: str, session_factory) -> Tuple[Dict, Callable[[str], Optional[str]]]:
    """
    Keep a side conversation (the Reader's Explain / Simplify, "Explain my mistake") in the chat history.

    Returns the chat's summary (sent to the client first, so follow-ups and "Open in AI Chat" can use its id)
    and an on_finish callback that stores `user_text` with the answer. The first answer creates the chat.
    """
    if conversation_id:
        conversation = get_user_conversation(db, user, conversation_id)
        draft, info, chat_id = None, summary(conversation), conversation.id
    else:
        draft, info = draft_conversation(db, user, "document", document_id, title=title)
        chat_id = draft["id"]
        draft["title_is_auto"] = False  # Its descriptive title is kept

    def persist(text: str) -> Optional[str]:
        session = session_factory()
        try:
            return save_messages(session, chat_id, user.id, user_text, text, draft=draft)
        finally:
            session.close()

    return info, persist


def history_for_ai(db: Session, conversation: Conversation) -> List[Dict]:
    """The latest messages of a chat, oldest first, in the {role, text} form the prompt builders take."""
    rows = (db.query(ChatMessage.role, ChatMessage.text)
            .filter(ChatMessage.conversation_id == conversation.id)
            .order_by(ChatMessage.timestamp.desc())
            .limit(MAX_HISTORY_MESSAGES).all())
    return [{"role": role, "text": text} for role, text in reversed(rows)]


async def prompt_for(db: Session, user: User, conversation: Conversation, history: List[Dict], message: str,
                     find_sources, format_sources) -> Tuple[List[Dict], List[Dict]]:
    """
    The AI messages for the next answer in a chat, and the source passages it may cite.

    `find_sources(query, document_ids)` searches the vector store; `format_sources(sources, include_titles)` numbers them.
    """
    if conversation.scope == "document":
        document = get_user_document(db, user, conversation.document_id or "")
        sources = await find_sources(message, [document.id])
        return build_document_messages(history, document.content, message, format_sources(sources)), sources

    if conversation.scope == "project" and conversation.project_id:
        project = get_user_project(db, user, conversation.project_id)
        doc_ids = project_document_ids(db, project.id)
        sources = await find_sources(message, doc_ids) if doc_ids else []
        messages = build_project_messages(
            history, message, format_sources(sources, include_titles=True) if sources else "",
            project.name, project.description or "", project.instructions or "", has_documents=bool(doc_ids))
        return messages, sources

    doc_ids = user_document_ids(db, user.id)
    if not doc_ids:
        raise HTTPException(status_code=400, detail="Upload a document first, or start the chat in a project.")
    sources = await find_sources(message, doc_ids)
    return build_knowledge_base_messages(history, message, format_sources(sources, include_titles=True)), sources


# --- Listing --------------------------------------------------------------------------------------

def summary(conversation: Conversation, snippet: Optional[str] = None,
            document_title: Optional[str] = None, project_name: Optional[str] = None) -> Dict:
    """The chat as the client lists it (a not-yet-stored draft passes its document / project names)."""
    return {
        "id": conversation.id,
        "title": conversation.title,
        "scope": conversation.scope,
        "document_id": conversation.document_id,
        "document_title": document_title or (conversation.document.title if conversation.document else None),
        "project_id": conversation.project_id,
        "project_name": project_name or (conversation.project.name if conversation.project else None),
        "pinned": bool(conversation.pinned),
        "persona": conversation.persona,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "snippet": snippet,
    }


def _snippet(text: str, query: str, width: int = 90) -> str:
    at = text.lower().find(query.lower())
    if at < 0:
        return text[:width]
    start = max(0, at - width // 3)
    piece = text[start:start + width].replace("\n", " ")
    return ("…" if start else "") + piece + ("…" if start + width < len(text) else "")


def list_conversations(db: Session, user: User, project_id: Optional[str] = None, query: str = "",
                       limit: int = 50, offset: int = 0) -> List[Dict]:
    backfill_conversations(db, user.id)
    base = db.query(Conversation).filter(Conversation.user_id == user.id)
    if project_id:
        base = base.filter(Conversation.project_id == project_id)
    query = (query or "").strip()
    if not query:
        rows = base.order_by(Conversation.pinned.desc(), Conversation.updated_at.desc()).offset(offset).limit(limit).all()
        return [summary(c) for c in rows]

    like = f"%{query}%"
    in_messages = (db.query(ChatMessage.conversation_id)
                   .filter(ChatMessage.user_id == user.id, ChatMessage.text.ilike(like))
                   .distinct())
    rows = (base.filter(or_(Conversation.title.ilike(like), Conversation.id.in_(in_messages)))
            .order_by(Conversation.updated_at.desc()).offset(offset).limit(limit).all())
    results = []
    for conversation in rows:
        snippet = None
        if query.lower() not in conversation.title.lower():
            hit = (db.query(ChatMessage.text)
                   .filter(ChatMessage.conversation_id == conversation.id, ChatMessage.text.ilike(like))
                   .order_by(ChatMessage.timestamp).first())
            snippet = _snippet(hit[0], query) if hit else None
        results.append(summary(conversation, snippet))
    return results
