import json
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import StudySet, User
from schemas import StudySetResponse
from services.auth_service import get_current_user, get_user_document
from services.groq_service import AIServiceError, normalize_citations
from services.rag_service import format_sources
from services.streaming import ndjson, streaming_response
from services.study_group_service import (
    ASK_STUDENT_AFTER,
    PERSONAS,
    ai_lines_since_student,
    build_persona_messages,
    now_ms,
    opening_line,
    persona_sources,
    pick_speakers,
    stream_persona_line,
    summarize_session,
)
from services.study_service import create_study_set, record_activity, to_response

router = APIRouter(prefix="/api/study-group", tags=["study-group"])


class CreateSessionRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=200)
    document_ids: List[str] = Field(min_length=1, max_length=3)
    personas: List[str] = Field(min_length=2, max_length=4)

    @field_validator("personas")
    @classmethod
    def _known(cls, value: List[str]) -> List[str]:
        unknown = [p for p in value if p not in PERSONAS]
        if unknown:
            raise ValueError(f"Unknown classmates: {', '.join(unknown)}")
        return list(dict.fromkeys(value))


class TurnRequest(BaseModel):
    # What the student says; omit to let the classmates continue
    message: Optional[str] = Field(default=None, max_length=3000)


def get_session(db: Session, user: User, set_id: str) -> StudySet:
    study_set = db.query(StudySet).filter(
        StudySet.id == set_id, StudySet.user_id == user.id, StudySet.kind == "study_group"
    ).first()
    if not study_set:
        raise HTTPException(status_code=404, detail="Study group session not found")
    return study_set


def save_data(set_id: str, data: Dict) -> None:
    """Persist the session with a fresh DB session (safe inside a streaming response)."""
    db = SessionLocal()
    try:
        row = db.query(StudySet).filter(StudySet.id == set_id).first()
        if row:
            row.data = json.dumps(data)
            db.commit()
    finally:
        db.close()


@router.get("/personas")
def list_personas(user: User = Depends(get_current_user)):
    """The AI classmates available for study groups and rooms."""
    return [{k: v for k, v in p.items() if k != "style"} for p in PERSONAS.values()]


@router.post("/sessions", response_model=StudySetResponse)
def create_session(request: CreateSessionRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    documents = [get_user_document(db, user, doc_id) for doc_id in dict.fromkeys(request.document_ids)]
    topic = request.topic.strip()
    data = {
        "topic": topic,
        "document_ids": [d.id for d in documents],
        "document_titles": [d.title for d in documents],
        "personas": request.personas,
        "transcript": [opening_line(topic, request.personas, user.name.split(" ")[0])],
        "status": "active",
        "summary": None,
    }
    study_set = create_study_set(db, documents[0], "study_group", data, {"personas": request.personas}, title=f"Study group · {topic}")
    return to_response(study_set)


@router.post("/{set_id}/turn")
async def take_turn(set_id: str, request: TurnRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    The student speaks (optional), then two classmates respond - streamed as NDJSON:
    {"type":"student","line"} {"type":"turn_start","speaker","sources"} {"type":"delta","text"}
    {"type":"turn_end","line"} ... {"type":"done"} or {"type":"error","detail"}.
    """
    study_set = get_session(db, user, set_id)
    data = json.loads(study_set.data)
    if data.get("status") != "active":
        raise HTTPException(status_code=400, detail="This discussion has ended. Start a new study group to keep going.")
    student_name = user.name.split(" ")[0]
    message = (request.message or "").strip()

    async def events():
        transcript = data["transcript"]
        if message:
            line = {"speaker": "student", "text": message, "at": now_ms()}
            transcript.append(line)
            save_data(set_id, data)
            yield ndjson({"type": "student", "line": line})

        for i, speaker in enumerate(pick_speakers(transcript, data["personas"], bool(message))):
            is_last = i == 1
            ask_student = is_last and ai_lines_since_student(transcript) + 1 >= ASK_STUDENT_AFTER
            sources = await persona_sources(data["document_ids"], data["topic"], transcript)
            messages = build_persona_messages(speaker, data["topic"], transcript, student_name,
                                              format_sources(sources, include_titles=True), ask_student)
            yield ndjson({"type": "turn_start", "speaker": speaker, "sources": sources})
            parts: List[str] = []
            saved_line: Optional[Dict] = None
            try:
                async for piece in stream_persona_line(speaker, messages):
                    parts.append(piece)
                    yield ndjson({"type": "delta", "text": piece})
            except AIServiceError as e:
                yield ndjson({"type": "error", "detail": str(e)})
                return
            finally:
                # Saved even if the student stops mid-sentence
                text = normalize_citations("".join(parts)).strip()
                if text:
                    saved_line = {"speaker": speaker, "text": text, "sources": sources, "at": now_ms()}
                    transcript.append(saved_line)
                    save_data(set_id, data)
            yield ndjson({"type": "turn_end", "speaker": speaker, "line": saved_line})
        yield ndjson({"type": "done"})

    return streaming_response(events())


@router.post("/{set_id}/end", response_model=StudySetResponse)
async def end_session(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Wrap up: moderator summary + feedback on the student's contributions (scored as a tutoring activity)."""
    study_set = get_session(db, user, set_id)
    data = json.loads(study_set.data)
    if data.get("status") == "ended" and data.get("summary"):
        return to_response(study_set)
    if len(data["transcript"]) < 3:
        raise HTTPException(status_code=400, detail="Have a bit more discussion before wrapping up.")
    try:
        summary = await summarize_session(data["topic"], data["transcript"], user.name.split(" ")[0])
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    data["summary"] = summary
    data["status"] = "ended"
    study_set.data = json.dumps(data)
    db.commit()
    if summary["student_score"] is not None:
        record_activity(db, study_set, "study_group", summary["student_score"], 100, details={"topic": data["topic"]})
    db.refresh(study_set)
    return to_response(study_set)
