"""
Projects like ChatGPT / Claude projects: a name, standing instructions for the AI, a set of documents,
and the chats started inside it.
"""
import time
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Conversation, Document, Project, ProjectDocument, User
from services.auth_service import get_current_user, get_user_document
from services.conversation_service import get_user_project, list_conversations

router = APIRouter(prefix="/api/projects", tags=["projects"])

COLORS = ("indigo", "violet", "sky", "emerald", "amber", "rose", "slate")


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)
    instructions: Optional[str] = Field(default=None, max_length=4000)
    color: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)
    instructions: Optional[str] = Field(default=None, max_length=4000)
    color: Optional[str] = None


def _now() -> int:
    return int(time.time() * 1000)


def _color(value: Optional[str]) -> str:
    return value if value in COLORS else "indigo"


def _project(db: Session, project: Project) -> dict:
    document_count = db.query(func.count(ProjectDocument.document_id)).filter(ProjectDocument.project_id == project.id).scalar()
    chat_count = db.query(func.count(Conversation.id)).filter(Conversation.project_id == project.id).scalar()
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description or "",
        "instructions": project.instructions or "",
        "color": _color(project.color),
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "document_count": document_count or 0,
        "chat_count": chat_count or 0,
    }


@router.get("")
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.user_id == user.id).order_by(Project.updated_at.desc()).all()
    return [_project(db, p) for p in projects]


@router.post("", status_code=201)
def create_project(body: ProjectIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stamp = _now()
    project = Project(id=uuid.uuid4().hex, user_id=user.id, name=body.name.strip(),
                      description=(body.description or "").strip() or None,
                      instructions=(body.instructions or "").strip() or None,
                      color=_color(body.color), created_at=stamp, updated_at=stamp)
    if not project.name:
        raise HTTPException(status_code=422, detail="Give the project a name.")
    db.add(project)
    db.commit()
    return _project(db, project)


@router.get("/{project_id}")
def open_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = get_user_project(db, user, project_id)
    documents = (db.query(Document).join(ProjectDocument, ProjectDocument.document_id == Document.id)
                 .filter(ProjectDocument.project_id == project.id)
                 .order_by(ProjectDocument.added_at.desc()).all())
    return {
        **_project(db, project),
        "documents": [{"id": d.id, "title": d.title, "type": d.type, "created_at": d.created_at} for d in documents],
        "chats": list_conversations(db, user, project_id=project.id, limit=200),
    }


@router.patch("/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = get_user_project(db, user, project_id)
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=422, detail="Give the project a name.")
        project.name = body.name.strip()
    if body.description is not None:
        project.description = body.description.strip() or None
    if body.instructions is not None:
        project.instructions = body.instructions.strip() or None
    if body.color is not None:
        project.color = _color(body.color)
    project.updated_at = _now()
    db.commit()
    return _project(db, project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Deletes the project and its chats. Its documents stay in the library."""
    db.delete(get_user_project(db, user, project_id))
    db.commit()
    return Response(status_code=204)


@router.put("/{project_id}/documents/{document_id}", status_code=204)
def add_document(project_id: str, document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = get_user_project(db, user, project_id)
    get_user_document(db, user, document_id)
    exists = db.query(ProjectDocument).filter(ProjectDocument.project_id == project.id,
                                              ProjectDocument.document_id == document_id).first()
    if not exists:
        db.add(ProjectDocument(project_id=project.id, document_id=document_id, added_at=_now()))
        project.updated_at = _now()
        db.commit()
    return Response(status_code=204)


@router.delete("/{project_id}/documents/{document_id}", status_code=204)
def remove_document(project_id: str, document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = get_user_project(db, user, project_id)
    db.query(ProjectDocument).filter(ProjectDocument.project_id == project.id,
                                     ProjectDocument.document_id == document_id).delete(synchronize_session=False)
    project.updated_at = _now()
    db.commit()
    return Response(status_code=204)
