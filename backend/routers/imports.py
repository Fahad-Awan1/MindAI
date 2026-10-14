import asyncio
import os
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import ImportJob, User
from services.auth_service import get_current_user
from services.import_service import (
    MAX_MEDIA_BYTES,
    MEDIA_EXTENSIONS,
    create_job,
    job_dir,
    job_out,
    run_job,
    youtube_id,
)

router = APIRouter(prefix="/api/imports", tags=["imports"])

# Background tasks are kept referenced so they aren't garbage-collected mid-run
_tasks: set = set()


def _start(job: ImportJob, user: User, media_path: str = None) -> None:
    task = asyncio.create_task(run_job(job.id, user.id, job.kind, job.source, media_path))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


class UrlImportRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


def _save_upload(upload: UploadFile, path: str) -> int:
    """Stream the upload to disk (recordings can be large); returns the size in bytes."""
    size = 0
    with open(path, "wb") as out:
        while chunk := upload.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_MEDIA_BYTES:
                raise HTTPException(status_code=413, detail="Recording is too large (max 500 MB).")
            out.write(chunk)
    return size


@router.post("/media")
async def import_media(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """Upload a lecture recording (audio or video) to transcribe into notes."""
    filename = os.path.basename(file.filename or "recording")
    extension = os.path.splitext(filename.lower())[1]
    if extension not in MEDIA_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file. Upload an audio or video recording (MP3, M4A, WAV, MP4, WEBM, MOV...).")
    job = create_job(user.id, "media", filename)
    path = os.path.join(job_dir(job.id), f"source{extension}")
    try:
        size = await run_in_threadpool(_save_upload, file, path)
    except HTTPException:
        shutil.rmtree(job_dir(job.id), ignore_errors=True)
        raise
    if size == 0:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    _start(job, user, path)
    return job_out(job)


@router.post("/url")
async def import_url(request: UrlImportRequest, user: User = Depends(get_current_user)):
    """Import a YouTube video (transcript -> notes) or a web article."""
    url = request.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Enter a full link starting with http:// or https://")
    is_youtube = youtube_id(url) is not None
    if not is_youtube and any(host in url.lower() for host in ("youtube.com", "youtu.be")):
        raise HTTPException(status_code=400, detail="That doesn't look like a YouTube video link.")
    job = create_job(user.id, "youtube" if is_youtube else "web", url)
    _start(job, user)
    return job_out(job)


@router.get("")
def list_imports(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The user's recent imports (newest first)."""
    jobs = db.query(ImportJob).filter(ImportJob.user_id == user.id).order_by(ImportJob.created_at.desc()).limit(20).all()
    return [job_out(j) for j in jobs]


@router.get("/{job_id}")
def get_import(job_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.query(ImportJob).filter(ImportJob.id == job_id, ImportJob.user_id == user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import not found")
    return job_out(job)


@router.delete("/{job_id}")
def dismiss_import(job_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Remove a finished or failed import from the list (the created document is kept)."""
    job = db.query(ImportJob).filter(ImportJob.id == job_id, ImportJob.user_id == user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import not found")
    if job.status in ("queued", "running"):
        raise HTTPException(status_code=400, detail="This import is still in progress.")
    db.delete(job)
    db.commit()
    return {"message": "Dismissed"}
