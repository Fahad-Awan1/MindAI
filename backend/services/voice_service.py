"""
Speech services via Groq: Whisper speech-to-text and Orpheus text-to-speech.

Text-to-speech needs the Orpheus model terms to be accepted once in the Groq console;
until then `tts_status()` reports it as unavailable and the frontend falls back to the
browser's built-in speech synthesis.
"""
import asyncio
import io
import re
import time
import wave
from typing import Dict, List, Optional, Tuple

from groq import AsyncGroq

from config import get_settings

settings = get_settings()
client = AsyncGroq(api_key=settings.groq_api_key, max_retries=5)

STT_MODEL = "whisper-large-v3-turbo"
TTS_MODEL = "canopylabs/orpheus-v1-english"
TTS_VOICES = ["troy", "hannah", "austin", "diana", "autumn", "daniel"]
TTS_MAX_CHARS = 1000  # Long text is split into chunks of at most this many characters
STATUS_TTL_SECONDS = 600

_tts_status: Dict[str, object] = {"checked_at": 0.0, "available": False, "reason": "Not checked yet"}


class VoiceServiceError(Exception):
    """Raised when speech-to-text or text-to-speech fails."""


async def transcribe(audio: bytes, filename: str) -> str:
    try:
        result = await client.audio.transcriptions.create(file=(filename, audio), model=STT_MODEL)
    except Exception as e:
        raise VoiceServiceError(f"Transcription failed: {e}") from e
    return (result.text or "").strip()


def plain_text_for_speech(text: str) -> str:
    """Strip Markdown so it reads naturally when spoken."""
    text = re.sub(r"```.*?```", " ", text, flags=re.S)          # code blocks
    text = re.sub(r"`([^`]*)`", r"\1", text)                     # inline code
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)            # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)         # links
    text = re.sub(r"\[(\d+)\]", "", text)                        # citation markers like [1]
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)    # headings
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.M)         # bullets
    text = re.sub(r"^\s*\|?[-:\s|]+\|?\s*$", " ", text, flags=re.M)  # table separators
    text = re.sub(r"^\s*\|\s*|\s*\|\s*$", "", text, flags=re.M)    # outer table pipes
    text = re.sub(r"\s*\|\s*", ", ", text)                           # cell separators
    text = re.sub(r"\n+", ". ", text)                                # line breaks read as pauses
    text = re.sub(r"[*_~>#]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def split_for_speech(text: str, limit: int = TTS_MAX_CHARS) -> List[str]:
    """Split text at sentence boundaries into chunks no longer than `limit`."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: List[str] = []
    current = ""
    for sentence in sentences:
        while len(sentence) > limit:  # very long sentence: hard split
            chunks.append(sentence[:limit])
            sentence = sentence[limit:]
        if len(current) + len(sentence) + 1 > limit and current:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks


async def _speak_chunk(text: str, voice: str) -> bytes:
    response = await client.audio.speech.create(model=TTS_MODEL, voice=voice, input=text, response_format="wav")
    return await response.read() if asyncio.iscoroutinefunction(getattr(response, "read", None)) else response.read()


def concat_wavs(parts: List[bytes]) -> Tuple[bytes, List[float]]:
    """Join WAV files with identical formats; returns the WAV and each part's duration (seconds)."""
    if not parts:
        raise VoiceServiceError("No audio to combine")
    frames: List[bytes] = []
    durations: List[float] = []
    params = None
    for part in parts:
        with wave.open(io.BytesIO(part)) as w:
            if params is None:
                params = w.getparams()
            data = w.readframes(w.getnframes())
            frames.append(data)
            durations.append(w.getnframes() / w.getframerate())
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(params.nchannels)
        w.setsampwidth(params.sampwidth)
        w.setframerate(params.framerate)
        for data in frames:
            w.writeframes(data)
    return out.getvalue(), durations


async def synthesize(text: str, voice: str = TTS_VOICES[0]) -> bytes:
    """Text-to-speech for any length of text (chunked, then joined into one WAV)."""
    chunks = split_for_speech(plain_text_for_speech(text))
    if not chunks:
        raise VoiceServiceError("Nothing to read aloud")
    try:
        parts = await asyncio.gather(*[_speak_chunk(chunk, voice) for chunk in chunks])
    except Exception as e:
        _mark_unavailable(e)
        raise VoiceServiceError(f"Text-to-speech failed: {e}") from e
    audio, _ = concat_wavs(list(parts))
    return audio


def _mark_unavailable(error: Exception):
    message = str(error)
    if "terms" in message.lower():
        reason = ("Groq's Orpheus text-to-speech model needs its terms accepted once in the Groq console "
                  "(https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english).")
    else:
        reason = f"Text-to-speech is unavailable: {message[:200]}"
    _tts_status.update(checked_at=time.time(), available=False, reason=reason)


async def tts_status(force: bool = False) -> Dict[str, object]:
    """Whether server-side text-to-speech works (cached for 10 minutes)."""
    if not force and time.time() - float(_tts_status["checked_at"]) < STATUS_TTL_SECONDS:
        return dict(_tts_status)
    try:
        await _speak_chunk("Ready.", TTS_VOICES[0])
        _tts_status.update(checked_at=time.time(), available=True, reason=None)
    except Exception as e:
        _mark_unavailable(e)
    return dict(_tts_status)


PODCAST_VOICES = {"A": "troy", "B": "hannah"}
_render_limit = asyncio.Semaphore(4)


async def render_podcast(lines: List[Dict[str, str]]) -> Tuple[bytes, List[float]]:
    """Voice each podcast line with its host's voice and join them; returns WAV + per-line durations."""
    async def speak_line(line: Dict[str, str]) -> bytes:
        async with _render_limit:
            parts = [await _speak_chunk(chunk, PODCAST_VOICES.get(line["speaker"], TTS_VOICES[0]))
                     for chunk in split_for_speech(line["text"])]
        audio, _ = concat_wavs(parts)
        return audio

    try:
        rendered = await asyncio.gather(*[speak_line(line) for line in lines])
    except Exception as e:
        _mark_unavailable(e)
        raise VoiceServiceError(f"Text-to-speech failed: {e}") from e
    return concat_wavs(list(rendered))
