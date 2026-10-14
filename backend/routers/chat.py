from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from typing import Dict, List, Optional
import json
import time
import uuid
from database import get_db, SessionLocal
from models import Document, ChatMessage, User
from schemas import ChatRequest, ChatResponse, ChatMessage as ChatMessageSchema
from services.rag_service import rag_service, format_sources
from services.groq_service import (
    chat_with_document,
    chat_with_knowledge_base,
    build_document_messages,
    build_knowledge_base_messages,
    normalize_citations,
    AIServiceError
)
from services.streaming import stream_answer, streaming_response
from services.auth_service import get_current_user, get_user_document

router = APIRouter(prefix="/api/chat", tags=["chat"])


def save_exchange(
    db: Session,
    user_id: str,
    document_id: Optional[str],
    user_text: str,
    model_text: str,
    is_knowledge_base: bool,
    sources: Optional[List[Dict]] = None,
    persona: Optional[str] = None,
) -> str:
    """Persist a user message and the model's reply (with its cited sources); return the model message ID."""
    now_ms = int(time.time() * 1000)
    model_msg_id = f"{uuid.uuid4().hex}_model"

    db.add(ChatMessage(
        id=f"{uuid.uuid4().hex}_user",
        document_id=document_id,
        user_id=user_id,
        role="user",
        text=user_text,
        timestamp=now_ms,
        is_knowledge_base=is_knowledge_base
    ))
    db.add(ChatMessage(
        id=model_msg_id,
        document_id=document_id,
        user_id=user_id,
        role="model",
        text=normalize_citations(model_text),
        timestamp=now_ms + 1,
        is_knowledge_base=is_knowledge_base,
        sources=json.dumps(sources) if sources else None,
        persona=persona,
    ))
    db.commit()
    return model_msg_id


# How each AI personality answers in a one-to-one chat
CHAT_PERSONAS = {
    "explainer": ("Maya", "You are Maya, the Explainer: you explain clearly and patiently, step by step, "
                  "with a concrete example or analogy, then check understanding with one short question."),
    "skeptic": ("Leo", "You are Leo, the Skeptic: you answer accurately, then question assumptions - ask 'how do we know?', "
                "point out weak evidence or common misconceptions, and challenge the student's claims politely."),
    "novice": ("Zoe", "You are Zoe, the Curious Beginner learning alongside the student: explain in very simple words, "
               "admit what is tricky, and ask the student to explain one part back to you in their own words."),
    "devil": ("Omar", "You are Omar, the Devil's Advocate: give the answer, then argue an opposite or alternative view "
              "to stress-test it, and ask the student to defend their position with evidence from the document."),
}


def with_persona(messages: List[Dict], persona: Optional[str]) -> List[Dict]:
    """Give the system prompt one of the AI personalities (sources and citations rules stay the same)."""
    if persona not in CHAT_PERSONAS or not messages:
        return messages
    name, style = CHAT_PERSONAS[persona]
    first = dict(messages[0])
    first["content"] = (f"{first['content']}\n\nPERSONALITY: {style} Stay accurate and grounded in the provided sources, "
                        f"keep citing them as [n], speak in first person as {name}, and keep the reply focused.")
    return [first] + messages[1:]


def get_chat_document(db: Session, user: User, document_id: Optional[str]) -> Document:
    if not document_id:
        raise HTTPException(status_code=400, detail="document_id is required")
    return get_user_document(db, user, document_id)


def all_document_ids(db: Session, user: User) -> List[str]:
    ids = [doc_id for (doc_id,) in db.query(Document.id).filter(Document.user_id == user.id).all()]
    if not ids:
        raise HTTPException(status_code=400, detail="No documents in knowledge base")
    return ids


async def find_sources(query: str, document_ids: List[str]) -> List[Dict]:
    # Embedding is CPU-bound, run it off the event loop
    return await run_in_threadpool(rag_service.get_sources, query, document_ids)


@router.post("/document", response_model=ChatResponse)
async def chat_document(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Chat with a specific document using RAG (Retrieval Augmented Generation).

    Flow:
    1. Retrieve the document metadata from the database.
    2. Retrieve numbered source passages from the vector store (`rag_service`).
    3. Send the user query, history and sources to the LLM, which cites them as [n].
    4. Save the exchange to the database and return the model's response.
    """
    document = get_chat_document(db, user, request.document_id)
    sources = await find_sources(request.message, [document.id])

    try:
        response_text = await chat_with_document(
            history=request.history,
            content=document.content,
            message=request.message,
            rag_context=format_sources(sources)
        )
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")

    response_text = normalize_citations(response_text)
    model_msg_id = save_exchange(db, user.id, document.id, request.message, response_text, False, sources)
    return ChatResponse(message=response_text, chat_id=model_msg_id)


@router.post("/knowledge-base", response_model=ChatResponse)
async def chat_knowledge_base(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Chat with all documents (knowledge base) using RAG."""
    sources = await find_sources(request.message, all_document_ids(db, user))

    try:
        response_text = await chat_with_knowledge_base(
            history=request.history,
            message=request.message,
            rag_context=format_sources(sources, include_titles=True)
        )
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")

    response_text = normalize_citations(response_text)
    model_msg_id = save_exchange(db, user.id, None, request.message, response_text, True, sources)
    return ChatResponse(message=response_text, chat_id=model_msg_id)


def _persist_callback(user_id: str, document_id: Optional[str], user_text: str, is_knowledge_base: bool, sources: List[Dict],
                      persona: Optional[str] = None):
    """Save the streamed exchange with a fresh session (the request-scoped one may be closed by then)."""
    def persist(text: str) -> Optional[str]:
        db = SessionLocal()
        try:
            return save_exchange(db, user_id, document_id, user_text, text, is_knowledge_base, sources, persona)
        finally:
            db.close()
    return persist


@router.post("/document/stream")
async def chat_document_stream(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Chat with a specific document, streaming NDJSON events:
    {"type": "sources", "sources": [...]} first, then deltas, then done/error.
    """
    document = get_chat_document(db, user, request.document_id)
    sources = await find_sources(request.message, [document.id])
    messages = with_persona(build_document_messages(request.history, document.content, request.message, format_sources(sources)), request.persona)

    return streaming_response(stream_answer(
        messages,
        on_finish=_persist_callback(user.id, document.id, request.message, False, sources, request.persona),
        prelude=[{"type": "sources", "sources": sources}],
    ))


@router.post("/knowledge-base/stream")
async def chat_knowledge_base_stream(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Chat with all documents (knowledge base), streaming NDJSON events with sources first."""
    sources = await find_sources(request.message, all_document_ids(db, user))
    messages = with_persona(build_knowledge_base_messages(request.history, request.message, format_sources(sources, include_titles=True)), request.persona)

    return streaming_response(stream_answer(
        messages,
        on_finish=_persist_callback(user.id, None, request.message, True, sources, request.persona),
        prelude=[{"type": "sources", "sources": sources}],
    ))


def _to_schema(messages: List[ChatMessage]) -> List[ChatMessageSchema]:
    return [
        ChatMessageSchema(
            id=msg.id,
            role=msg.role,
            text=msg.text,
            timestamp=msg.timestamp,
            sources=json.loads(msg.sources) if msg.sources else None,
            persona=getattr(msg, "persona", None),
        )
        for msg in messages
    ]


@router.get("/history", response_model=List[ChatMessageSchema])
def get_knowledge_base_history(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get knowledge base chat history."""
    messages = db.query(ChatMessage).filter(
        ChatMessage.is_knowledge_base == True,
        ChatMessage.user_id == user.id
    ).order_by(ChatMessage.timestamp).all()

    return _to_schema(messages)


@router.get("/history/{doc_id}", response_model=List[ChatMessageSchema])
def get_chat_history(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chat history for a document."""
    get_user_document(db, user, doc_id)
    messages = db.query(ChatMessage).filter(
        ChatMessage.document_id == doc_id,
        ChatMessage.user_id == user.id
    ).order_by(ChatMessage.timestamp).all()

    return _to_schema(messages)
