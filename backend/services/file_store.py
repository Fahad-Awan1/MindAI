"""
Uploaded files and rendered audio are kept in the database as well as on disk.

On hosts whose disk is wiped at every restart (Hugging Face Spaces, Render's free plan) the database copy
brings a file back the first time it is needed again. Paths are the same strings the rest of the app stores
(document.file_path, an audio overview's "file").
"""
import time
from typing import Optional

from database import SessionLocal
from models import StoredFile


def save(path: str, data: bytes) -> None:
    db = SessionLocal()
    try:
        db.merge(StoredFile(path=path, data=data, created_at=int(time.time() * 1000)))
        db.commit()
    finally:
        db.close()


def load(path: str) -> Optional[bytes]:
    db = SessionLocal()
    try:
        row = db.query(StoredFile).filter(StoredFile.path == path).first()
        return bytes(row.data) if row else None
    finally:
        db.close()


def delete(path: str) -> None:
    db = SessionLocal()
    try:
        db.query(StoredFile).filter(StoredFile.path == path).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
