import json
import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import get_settings, BASE_DIR
from database import get_db
from models import StudySet, User
from schemas import StudySetResponse
from services.document_service import resolve_stored_path, delete_file
from services.groq_service import AIServiceError, generate_podcast_script
from services.auth_service import get_current_user, get_user_document
from services.study_service import create_study_set, to_response
from services.voice_service import VoiceServiceError, render_podcast, tts_status

router = APIRouter(prefix="/api", tags=["audio"])
settings = get_settings()


class AudioOverviewRequest(BaseModel):
    document_id: str
    length: Literal["short", "medium"] = "short"


def audio_path_for(set_id: str) -> str:
    """Stored path of an overview's rendered audio (relative to the backend dir when possible)."""
    absolute = os.path.join(settings.resolved_upload_dir, "audio", f"{set_id}.wav")
    try:
        relative = os.path.relpath(absolute, BASE_DIR)
        if not relative.startswith(".."):
            return "./" + relative.replace(os.sep, "/")
    except ValueError:
        pass  # Different drive on Windows
    return absolute


def delete_overview_audio(study_set: StudySet) -> None:
    """Remove an audio overview's WAV file (call before deleting the set)."""
    if study_set.kind != "audio_overview":
        return
    audio = json.loads(study_set.data).get("audio") or {}
    if audio.get("file"):
        delete_file(audio["file"])


async def render_overview_audio(db: Session, study_set: StudySet) -> bool:
    """Voice the script with Groq TTS if it is enabled; returns True when audio was saved."""
    status = await tts_status()
    if not status["available"]:
        return False
    data = json.loads(study_set.data)
    try:
        audio, durations = await render_podcast(data["lines"])
    except VoiceServiceError as e:
        print(f"Audio overview rendering failed: {e}")
        return False
    stored = audio_path_for(study_set.id)
    absolute = resolve_stored_path(stored)
    os.makedirs(os.path.dirname(absolute), exist_ok=True)
    with open(absolute, "wb") as f:
        f.write(audio)
    data["audio"] = {"file": stored, "durations": [round(d, 3) for d in durations]}
    study_set.data = json.dumps(data)
    db.commit()
    db.refresh(study_set)
    return True


@router.post("/ai/audio-overview", response_model=StudySetResponse)
async def create_audio_overview(request: AudioOverviewRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Generate a two-host podcast-style overview of a document.

    The script is always returned (and saved). Studio audio is rendered with Groq TTS when it
    is enabled; otherwise the app reads the script with the browser's voices.
    """
    document = get_user_document(db, user, request.document_id)
    if not (document.content or "").strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from this document.")

    try:
        script = await generate_podcast_script(document.content, document.title, request.length)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    study_set = create_study_set(
        db, document, "audio_overview",
        {"title": script["title"], "lines": script["lines"], "audio": None},
        {"length": request.length}, title=script["title"],
    )
    await render_overview_audio(db, study_set)
    return to_response(study_set)


@router.post("/study-sets/{set_id}/render-audio", response_model=StudySetResponse)
async def render_audio(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """(Re)render studio audio for an existing overview, e.g. after enabling Groq TTS."""
    study_set = db.query(StudySet).filter(StudySet.id == set_id, StudySet.user_id == user.id).first()
    if not study_set or study_set.kind != "audio_overview":
        raise HTTPException(status_code=404, detail="Audio overview not found")
    if not await render_overview_audio(db, study_set):
        status = await tts_status(force=True)
        raise HTTPException(status_code=503, detail=status.get("reason") or "Text-to-speech is unavailable.")
    return to_response(study_set)


@router.get("/audio/{set_id}")
def get_overview_audio(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The rendered WAV for an audio overview."""
    study_set = db.query(StudySet).filter(StudySet.id == set_id, StudySet.user_id == user.id).first()
    if not study_set or study_set.kind != "audio_overview":
        raise HTTPException(status_code=404, detail="Audio overview not found")
    audio = json.loads(study_set.data).get("audio") or {}
    path = resolve_stored_path(audio["file"]) if audio.get("file") else None
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="No audio has been rendered for this overview")
    return FileResponse(path, media_type="audio/wav", filename=f"{set_id}.wav")
