"""
Lecture-to-Notes: turn recordings, YouTube videos and web articles into documents.

Pipeline (runs in the background, one job at a time to respect API rate limits):
  media   -> ffmpeg (mono 16 kHz, 10-minute chunks) -> Whisper (timestamped) -> notes
  youtube -> captions (or audio download -> Whisper) -> notes
  web     -> readable article text (Markdown)
Lecture documents are split into time-range sections ("05:00-10:00 · Heading") so chat
citations point at timestamps.
"""
import asyncio
import glob
import math
import os
import re
import shutil
import subprocess
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import httpx
import imageio_ffmpeg
from fastapi.concurrency import run_in_threadpool
from groq import AsyncGroq

from config import get_settings
from database import SessionLocal
from models import Document, ImportJob
from services.groq_service import AIServiceError, _complete, _extract_list, _parse_json, _str_list, generate_summary
from services.indexing import index_segments
from services.document_service import extract_segments

settings = get_settings()
whisper = AsyncGroq(api_key=settings.groq_api_key, max_retries=5)

STT_MODEL = "whisper-large-v3-turbo"
CHUNK_SECONDS = 600            # Whisper upload limit is 25 MB; 10 min of 32 kbps mono is ~2.4 MB
BLOCK_SECONDS = 300            # Notes are written per 5-minute block...
MAX_BLOCKS = 24                # ...but long lectures use longer blocks to limit AI calls
MEDIA_EXTENSIONS = {".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".flac", ".aac", ".webm", ".mp4", ".mov", ".mkv", ".m4v", ".avi", ".mpeg", ".mpga"}
MAX_MEDIA_BYTES = 500 * 1024 * 1024

_job_lock = asyncio.Semaphore(1)


class ImportError_(Exception):
    """A user-facing import failure."""


def now_ms() -> int:
    return int(time.time() * 1000)


def job_dir(job_id: str) -> str:
    path = os.path.join(settings.resolved_upload_dir, "imports", job_id)
    os.makedirs(path, exist_ok=True)
    return path


def update_job(job_id: str, **fields: Any) -> None:
    db = SessionLocal()
    try:
        job = db.query(ImportJob).filter(ImportJob.id == job_id).first()
        if job:
            for key, value in fields.items():
                setattr(job, key, value)
            job.updated_at = now_ms()
            db.commit()
    finally:
        db.close()


def job_out(job: ImportJob) -> Dict[str, Any]:
    return {
        "id": job.id, "kind": job.kind, "source": job.source, "title": job.title, "status": job.status,
        "stage": job.stage, "progress": job.progress, "document_id": job.document_id, "error": job.error,
        "created_at": job.created_at, "updated_at": job.updated_at,
    }


def fmt_time(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

def youtube_id(url: str) -> Optional[str]:
    """The video ID for youtube.com/watch?v=, youtu.be/, /shorts/ and /embed/ links."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if host == "youtu.be":
        vid = parsed.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "music.youtube.com"):
        if parsed.path == "/watch":
            vid = (parse_qs(parsed.query).get("v") or [""])[0]
        else:
            match = re.match(r"^/(shorts|embed|live|v)/([^/?#]+)", parsed.path)
            vid = match.group(2) if match else ""
    else:
        return None
    return vid if re.fullmatch(r"[A-Za-z0-9_-]{11}", vid or "") else None


def run_ffmpeg(args: List[str]) -> None:
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args],
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise ImportError_("Could not read the audio in this file. Is it a valid audio or video recording?")


def split_audio(source_path: str, out_dir: str) -> List[str]:
    """Convert to compact mono speech audio in 10-minute chunks (Whisper-friendly)."""
    pattern = os.path.join(out_dir, "chunk_%03d.mp3")
    run_ffmpeg(["-i", source_path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
                "-f", "segment", "-segment_time", str(CHUNK_SECONDS), "-reset_timestamps", "1", pattern])
    chunks = sorted(glob.glob(os.path.join(out_dir, "chunk_*.mp3")))
    if not chunks:
        raise ImportError_("No audio was found in this file.")
    return chunks


async def transcribe_chunks(job_id: str, chunks: List[str], progress_from: int, progress_to: int) -> List[Dict[str, Any]]:
    """Whisper each chunk; returns segments with absolute start/end seconds."""
    segments: List[Dict[str, Any]] = []
    for i, path in enumerate(chunks):
        update_job(job_id, stage=f"Transcribing part {i + 1} of {len(chunks)}",
                   progress=progress_from + int((progress_to - progress_from) * i / len(chunks)))
        with open(path, "rb") as f:
            audio = f.read()
        try:
            result = await whisper.audio.transcriptions.create(
                file=(os.path.basename(path), audio), model=STT_MODEL, response_format="verbose_json"
            )
        except Exception as e:
            if "rate_limit" in str(e) or getattr(e, "status_code", None) == 429:
                raise ImportError_("The transcription service's hourly audio limit was reached. Please try again later.") from e
            raise ImportError_(f"Transcription failed: {e}") from e
        offset = i * CHUNK_SECONDS
        raw = getattr(result, "segments", None) or (result.get("segments") if isinstance(result, dict) else None) or []
        for seg in raw:
            seg = seg if isinstance(seg, dict) else seg.__dict__
            text = (seg.get("text") or "").strip()
            if text:
                segments.append({"start": offset + float(seg.get("start", 0)), "end": offset + float(seg.get("end", 0)), "text": text})
        if not raw and getattr(result, "text", ""):
            segments.append({"start": offset, "end": offset + CHUNK_SECONDS, "text": result.text.strip()})
    if not segments:
        raise ImportError_("No speech was detected in this recording.")
    return segments


def youtube_title(url: str) -> Optional[str]:
    try:
        r = httpx.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"}, timeout=10)
        if r.status_code == 200:
            return r.json().get("title")
    except httpx.HTTPError:
        pass
    return None


def youtube_captions(video_id: str) -> Optional[List[Dict[str, Any]]]:
    """Captions as timed segments (manual or auto-generated, English preferred), or None."""
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    try:
        fetched = api.fetch(video_id, languages=("en", "en-US", "en-GB"))
    except Exception:
        try:
            # Any available language
            transcript = next(iter(api.list(video_id)))
            fetched = transcript.fetch()
        except Exception:
            return None
    segments = [{"start": s.start, "end": s.start + s.duration, "text": s.text.replace("\n", " ").strip()}
                for s in fetched if s.text.strip() and s.text.strip() not in ("[Music]", "[Applause]")]
    return segments or None


def youtube_audio(url: str, out_dir: str) -> str:
    """Download a video's audio track (used when it has no captions)."""
    import yt_dlp
    options = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(out_dir, "source.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "max_filesize": MAX_MEDIA_BYTES,
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.download([url])
    except Exception as e:
        raise ImportError_("Could not download this video's audio (it may be private, age-restricted or region-locked).") from e
    files = glob.glob(os.path.join(out_dir, "source.*"))
    if not files:
        raise ImportError_("Could not download this video's audio.")
    return files[0]


def web_article(url: str) -> Tuple[str, str]:
    """(title, markdown) of a web page's main content."""
    import trafilatura
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ImportError_("Could not open that web page. Check the link, or the site may block automated access.")
    text = trafilatura.extract(downloaded, output_format="markdown", include_tables=True, include_links=False,
                               include_comments=False, favor_recall=True)
    if not text or len(text.strip()) < 200:
        raise ImportError_("Couldn't find readable article text on that page.")
    meta = trafilatura.extract_metadata(downloaded)
    title = (meta.title if meta and meta.title else None) or urlparse(url).hostname or "Web article"
    return title.strip(), text.strip()


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

def group_blocks(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group transcript segments into consecutive time blocks."""
    total = segments[-1]["end"]
    block = max(BLOCK_SECONDS, math.ceil(total / MAX_BLOCKS / 60) * 60)
    blocks: Dict[int, Dict[str, Any]] = {}
    for seg in segments:
        index = int(seg["start"] // block)
        entry = blocks.setdefault(index, {"start": index * block, "end": seg["end"], "parts": []})
        entry["parts"].append(seg["text"])
        entry["end"] = max(entry["end"], seg["end"])
    return [{"start": b["start"], "end": b["end"], "text": " ".join(b["parts"])} for _, b in sorted(blocks.items())]


async def block_notes(title: str, block: Dict[str, Any]) -> Dict[str, Any]:
    prompt = f"""This is part of the transcript of "{title}" ({fmt_time(block['start'])}-{fmt_time(block['end'])}).
Write study notes for this part, in the same language as the transcript.
Return a JSON object: {{"heading": "short descriptive heading (max 8 words)",
"points": ["3-7 concise bullet points capturing key ideas, definitions, examples and any formulas"]}}

TRANSCRIPT:
{block['text'][:6000]}"""
    text = await _complete(
        messages=[{"role": "system", "content": "You write clear, accurate lecture notes. Always respond with valid JSON."},
                  {"role": "user", "content": prompt}],
        temperature=0.3, max_tokens=900, json_mode=True,
    )
    data = _parse_json(text)
    heading = str(data.get("heading") or "").strip()[:80] if isinstance(data, dict) else ""
    return {"heading": heading or "Lecture notes", "points": _str_list(_extract_list(data, ["points", "bullets"]), 8)}


async def lecture_overview(title: str, notes: List[Dict[str, Any]]) -> Dict[str, Any]:
    outline = "\n".join(f"- {n['heading']}: " + "; ".join(n["points"][:3]) for n in notes)
    text = await _complete(
        messages=[{"role": "system", "content": "You summarise lectures for students. Always respond with valid JSON."},
                  {"role": "user", "content": f"""Lecture: "{title}". Section notes:
{outline[:7000]}

Return a JSON object: {{"overview": "3-4 sentence overview of the whole lecture",
"takeaways": ["4-6 key takeaways"]}}"""}],
        temperature=0.3, max_tokens=800, json_mode=True,
    )
    data = _parse_json(text)
    if not isinstance(data, dict):
        return {"overview": "", "takeaways": []}
    return {"overview": str(data.get("overview") or "").strip(), "takeaways": _str_list(data.get("takeaways"), 6)}


async def build_lecture_markdown(job_id: str, title: str, segments: List[Dict[str, Any]], progress_from: int) -> str:
    blocks = group_blocks(segments)
    notes = []
    for i, block in enumerate(blocks):
        update_job(job_id, stage=f"Writing notes ({i + 1} of {len(blocks)})",
                   progress=progress_from + int((88 - progress_from) * i / len(blocks)))
        try:
            notes.append(await block_notes(title, block))
        except AIServiceError:
            notes.append({"heading": "Transcript", "points": []})  # Keep going; the transcript is still useful
    update_job(job_id, stage="Writing the overview", progress=89)
    try:
        overview = await lecture_overview(title, notes)
    except AIServiceError:
        overview = {"overview": "", "takeaways": []}

    parts = [f"# {title}"]
    if overview["overview"] or overview["takeaways"]:
        parts.append("## Overview\n" + overview["overview"] + ("\n\n**Key takeaways**\n" + "\n".join(f"- {t}" for t in overview["takeaways"]) if overview["takeaways"] else ""))
    for block, note in zip(blocks, notes):
        section = [f"## {fmt_time(block['start'])}–{fmt_time(block['end'])} · {note['heading']}"]
        section += [f"- {p}" for p in note["points"]]
        section.append(f"\n**Transcript:** {block['text']}")
        parts.append("\n".join(section))
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

def create_job(user_id: str, kind: str, source: str) -> ImportJob:
    db = SessionLocal()
    try:
        job = ImportJob(id=uuid.uuid4().hex, user_id=user_id, kind=kind, source=source, status="queued",
                        stage="Waiting to start", progress=0, created_at=now_ms(), updated_at=now_ms())
        db.add(job)
        db.commit()
        db.refresh(job)
        return job
    finally:
        db.close()


async def _save_document(job_id: str, user_id: str, title: str, doc_type: str, content: str) -> str:
    update_job(job_id, stage="Indexing for chat and citations", progress=92)
    db = SessionLocal()
    try:
        document = Document(id=uuid.uuid4().hex, user_id=user_id, title=title[:200], content=content, file_path=None,
                            mime_type=None, type=doc_type, created_at=now_ms(), summary="Generating summary...")
        db.add(document)
        db.commit()
        db.refresh(document)
        segments = await run_in_threadpool(extract_segments, content.encode("utf-8"), "markdown", content)
        await run_in_threadpool(index_segments, document, segments)
        update_job(job_id, stage="Writing a summary", progress=96)
        document.summary = await generate_summary(content)
        db.commit()
        return document.id
    finally:
        db.close()


async def run_job(job_id: str, user_id: str, kind: str, source: str, media_path: Optional[str] = None) -> None:
    """Process one import; failures are recorded on the job with a friendly message."""
    async with _job_lock:
        work = job_dir(job_id)
        try:
            update_job(job_id, status="running", stage="Starting", progress=2)
            if kind == "web":
                update_job(job_id, stage="Reading the article", progress=20)
                title, text = await run_in_threadpool(web_article, source)
                update_job(job_id, title=title)
                content = text if text.lstrip().startswith("#") else f"# {title}\n\n{text}"
                doc_type = "web"
            else:
                title = os.path.splitext(os.path.basename(source))[0] if kind == "media" else (youtube_title(source) or "YouTube video")
                update_job(job_id, title=title)
                segments = None
                if kind == "youtube":
                    update_job(job_id, stage="Fetching captions", progress=8)
                    segments = await run_in_threadpool(youtube_captions, youtube_id(source))
                    if segments is None:
                        update_job(job_id, stage="No captions - downloading the audio", progress=10)
                        media_path = await run_in_threadpool(youtube_audio, source, work)
                if segments is None:
                    update_job(job_id, stage="Preparing the audio", progress=12)
                    chunks = await run_in_threadpool(split_audio, media_path, work)
                    segments = await transcribe_chunks(job_id, chunks, 15, 55)
                content = await build_lecture_markdown(job_id, title, segments, 58)
                doc_type = "lecture"
            document_id = await _save_document(job_id, user_id, title, doc_type, content)
            update_job(job_id, status="done", stage="Ready", progress=100, document_id=document_id)
        except ImportError_ as e:
            update_job(job_id, status="failed", stage="Failed", error=str(e))
        except Exception as e:
            print(f"Import {job_id} failed: {e}")
            update_job(job_id, status="failed", stage="Failed", error="Something went wrong while importing. Please try again.")
        finally:
            shutil.rmtree(work, ignore_errors=True)


def mark_interrupted_jobs() -> None:
    """Jobs left running when the server stopped can't resume; mark them failed on startup."""
    db = SessionLocal()
    try:
        for job in db.query(ImportJob).filter(ImportJob.status.in_(["queued", "running"])).all():
            job.status = "failed"
            job.stage = "Failed"
            job.error = "The server restarted before this import finished. Please try again."
            job.updated_at = now_ms()
        db.commit()
    finally:
        db.close()
