from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
import asyncio
from sqlalchemy.orm import Session
from typing import List
import os
import time
import uuid
from database import get_db, SessionLocal
from models import Document, User
from schemas import DocumentResponse
from services.document_service import process_document, delete_file, get_file_base64, extract_segments, document_segments
from services.indexing import index_segments
from routers.audio import delete_overview_audio
from services.rag_service import rag_service
from services.groq_service import generate_summary
from services.auth_service import get_current_user, get_user_document

router = APIRouter(prefix="/api/documents", tags=["documents"])

PENDING_SUMMARY = "Generating summary..."
# Background summary tasks are kept referenced so they aren't garbage-collected mid-run
_summary_tasks: set = set()


async def _summarize_later(document_id: str, text: str) -> None:
    """Write the document's AI summary once it is ready (the upload has already returned)."""
    try:
        summary = await generate_summary(text)
    except Exception as e:
        print(f"Error generating summary: {e}")
        summary = "Summary generation failed."
    db = SessionLocal()
    try:
        document = db.query(Document).filter(Document.id == document_id).first()
        if document:
            document.summary = summary
            db.commit()
    finally:
        db.close()

# Supported file extensions mapped to document types
SUPPORTED_TYPES = {
    '.txt': 'text',
    '.md': 'markdown',
    '.pdf': 'pdf',
    '.docx': 'docx',
    '.pptx': 'pptx',
}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


def to_response(document: Document, include_file_data: bool = False) -> DocumentResponse:
    """Build a DocumentResponse from a Document row."""
    doc_data = {
        "id": document.id,
        "title": document.title,
        "content": document.content or "",
        "type": document.type,
        "created_at": document.created_at,
        "summary": document.summary
    }

    # Only include the (potentially large) base64 file payload when explicitly requested
    if include_file_data and document.file_path and document.mime_type:
        base64_data = get_file_base64(document.file_path)
        if base64_data:
            doc_data["inline_data"] = {
                "data": base64_data,
                "mime_type": document.mime_type
            }

    return DocumentResponse(**doc_data)


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload and process a document.

    Flow:
    1. Identify file type (PDF, DOCX, TXT, etc.) and reject unsupported files.
    2. Read file content from the upload stream.
    3. Process content using `process_document` (extract text, save local copy).
    4. Create a database record for the document.
    5. Add the document to the RAG vector database.
    6. Start the LLM summary in the background (the client polls until it appears).
    7. Return the document metadata and content to the client.
    """
    filename = file.filename or ""
    extension = os.path.splitext(filename.lower())[1]
    file_type = SUPPORTED_TYPES.get(extension)
    if not file_type:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a PDF, DOCX, PPTX, TXT or MD file."
        )

    file_path = None
    try:
        # Read file content
        file_content = await file.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        if len(file_content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File is too large (max 50 MB).")

        # Process document (CPU-bound, run off the event loop)
        text_content, file_path = await run_in_threadpool(process_document, file_content, file_type)

        # Create document record
        now_ms = int(time.time() * 1000)
        doc_id = uuid.uuid4().hex
        document = Document(
            id=doc_id,
            user_id=user.id,
            title=filename,
            content=text_content,
            file_path=file_path,
            mime_type=file.content_type if file_type not in ['text', 'markdown'] else None,
            type=file_type,
            created_at=now_ms,
            summary=PENDING_SUMMARY
        )

        db.add(document)
        db.commit()
        db.refresh(document)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        if file_path:
            delete_file(file_path)
        print(f"Error uploading document: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to upload document: {str(e)}")

    # Add to RAG vector database with page/slide/section labels for citations
    # (parsing and embedding are CPU-bound, so run them off the event loop)
    if text_content:
        try:
            segments = await run_in_threadpool(extract_segments, file_content, file_type, text_content)
            await run_in_threadpool(index_segments, document, segments)
        except Exception as e:
            print(f"Error adding to RAG: {e}")

    # The AI summary can take a while; generate it in the background so the upload returns quickly
    # (slow responses time out behind proxies such as the Cloudflare tunnel, and a retry would duplicate the document)
    if text_content:
        task = asyncio.create_task(_summarize_later(document.id, text_content))
        _summary_tasks.add(task)
        task.add_done_callback(_summary_tasks.discard)
    else:
        document.summary = "No text found to summarise."
        db.commit()
        db.refresh(document)

    return to_response(document)


@router.get("", response_model=List[DocumentResponse])
def get_documents(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the user's documents (without file payloads, to keep the response small)."""
    documents = db.query(Document).filter(Document.user_id == user.id).order_by(Document.created_at.desc()).all()
    return [to_response(doc) for doc in documents]


@router.get("/{doc_id}", response_model=DocumentResponse)
def get_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific document, including the original file data for binary files."""
    document = get_user_document(db, user, doc_id)
    return to_response(document, include_file_data=True)


@router.delete("/{doc_id}")
def delete_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a document."""
    document = get_user_document(db, user, doc_id)

    # Delete from RAG database
    try:
        rag_service.delete_document(doc_id)
    except Exception as e:
        print(f"Error deleting from RAG: {e}")

    # Delete rendered audio overviews and the original file
    for study_set in document.study_sets:
        delete_overview_audio(study_set)
    if document.file_path:
        delete_file(document.file_path)

    # Delete from database (chat messages are removed via cascade)
    db.delete(document)
    db.commit()

    return {"message": "Document deleted successfully"}


@router.get("/{doc_id}/segments")
async def get_document_segments(doc_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The document's text split into labelled parts (pages, slides, sections) for the reader."""
    document = get_user_document(db, user, doc_id)
    segments = await run_in_threadpool(document_segments, document)
    return [{"index": i, "label": label, "text": text} for i, (label, text) in enumerate(segments)]
