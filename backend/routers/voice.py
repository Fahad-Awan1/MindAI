from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from services.auth_service import get_current_user
from services.voice_service import TTS_VOICES, VoiceServiceError, synthesize, transcribe, tts_status

# Voice endpoints use paid model quota, so they also require a signed-in user
router = APIRouter(prefix="/api/voice", tags=["voice"], dependencies=[Depends(get_current_user)])

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # Groq Whisper upload limit


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    voice: str = TTS_VOICES[0]


@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Speech-to-text for a recorded clip (webm/ogg/wav/mp3/m4a)."""
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Recording is too long (max 25 MB).")
    try:
        text = await transcribe(audio, file.filename or "recording.webm")
    except VoiceServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"text": text}


@router.get("/status")
async def voice_status(refresh: bool = False):
    """Which voice features the server supports. Speech-to-text always uses Whisper."""
    status = await tts_status(force=refresh)
    return {"stt_available": True, "tts_available": status["available"], "tts_reason": status["reason"], "voices": TTS_VOICES}


@router.post("/speak")
async def speak(request: SpeakRequest):
    """Text-to-speech (WAV). Returns 503 when Groq TTS is not enabled - the browser then speaks instead."""
    if request.voice not in TTS_VOICES:
        raise HTTPException(status_code=400, detail=f"Unknown voice. Choose one of: {', '.join(TTS_VOICES)}")
    try:
        audio = await synthesize(request.text, request.voice)
    except VoiceServiceError as e:
        status = await tts_status()
        raise HTTPException(status_code=503, detail=status.get("reason") or str(e))
    return Response(content=audio, media_type="audio/wav")
