from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Document, User
from services.auth_service import get_current_user
from services.graph_service import ensure_concept_maps, merge_graph

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
async def get_concept_graph(rebuild: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Concept graph across all documents.

    Concept maps are extracted for new or changed documents on demand (cached per
    document); `rebuild=true` re-extracts every document.
    """
    documents = db.query(Document).filter(Document.user_id == user.id).order_by(Document.created_at).all()
    if not documents:
        return {"nodes": [], "edges": [], "documents": [], "shared_concepts": 0, "failed": []}

    failed = await ensure_concept_maps(db, documents, force=rebuild)
    for document in documents:
        db.refresh(document)
    graph = merge_graph(documents)
    if not graph["nodes"] and failed:
        raise HTTPException(status_code=502, detail="Could not build the concept graph. Please try again.")
    graph["failed"] = failed
    return graph
