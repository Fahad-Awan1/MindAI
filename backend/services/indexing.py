"""Keeps the vector index in step with the documents table."""
import threading

from database import SessionLocal
from models import Document
from services.document_service import document_segments, segments_to_text
from services.rag_service import rag_service


def index_segments(document: Document, segments: list) -> None:
    """(Re)index a document from its labelled segments."""
    if not segments:
        return
    rag_service.delete_document(document.id)
    rag_service.add_segments(document.id, segments, {"title": document.title, "type": document.type})


def reindex_outdated_documents() -> None:
    """
    Re-index documents whose chunks predate location labels (pages/slides/sections),
    so their answers can cite sources. Also refreshes binary documents' stored text
    with the improved extraction (tables, grouped shapes).
    """
    db = SessionLocal()
    try:
        for document in db.query(Document).all():
            try:
                if not rag_service.needs_reindex(document.id):
                    continue
                segments = document_segments(document)
                if not segments:
                    continue
                index_segments(document, segments)
                if document.type in ("pdf", "docx", "pptx"):
                    text = segments_to_text(segments)
                    if text and text != (document.content or ""):
                        document.content = text
                        db.commit()
                print(f"Re-indexed document {document.id} ({document.title}) with source locations")
            except Exception as e:
                print(f"Error re-indexing document {document.id}: {e}")
    finally:
        db.close()


def warm_up_search() -> None:
    """
    Load the embedding model and run one search now, so the first question after a restart is as fast
    as the rest (loading the model and the first encode take many seconds on a cold start).
    """
    try:
        rag_service.search("warm up", top_k=1)
    except Exception as e:
        print(f"Search warm-up failed: {e}")


def start_background_reindex() -> None:
    """Warm up the search, then re-index outdated documents, without delaying server startup."""
    def run():
        warm_up_search()
        reindex_outdated_documents()
    threading.Thread(target=run, name="reindex", daemon=True).start()
