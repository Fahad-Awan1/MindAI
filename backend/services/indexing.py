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


def start_background_reindex() -> None:
    """Run the re-index without delaying server startup (also warms up the embedding model)."""
    threading.Thread(target=reindex_outdated_documents, name="reindex", daemon=True).start()
