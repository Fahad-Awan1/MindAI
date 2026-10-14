import hashlib
import json
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import Document, StudySet, User
from schemas import ExplainMistakeRequest, StudySetResponse, TeachBackRequest
from services.groq_service import (
    AIServiceError,
    build_explain_mistake_messages,
    build_selection_messages,
    flashcards_from_selection,
    generate_quiz,
    grade_teach_back,
    suggest_concepts,
)
from services.rag_service import rag_service
from services.streaming import stream_answer, streaming_response
from services.auth_service import get_current_user, get_user_document
from services.study_service import create_study_set, record_activity, to_response

router = APIRouter(prefix="/api/tutor", tags=["tutor"])

# Concept suggestions per document, keyed by a hash of its content (cheap to recompute if it changes)
_concept_cache: Dict[str, Tuple[str, List[str]]] = {}


def get_document(db: Session, user: User, document_id: str) -> Document:
    """The user's document, with text the AI can work with."""
    document = get_user_document(db, user, document_id)
    if not (document.content or "").strip():
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted from this document (it may be a scanned or image-only file)."
        )
    return document


async def document_context(document: Document, query: str) -> str:
    """Relevant passages for `query`, falling back to the start of the document."""
    context = await run_in_threadpool(rag_service.get_context, query, [document.id])
    return context or (document.content or "")[:8000]


@router.post("/explain/stream")
async def explain_mistake(request: ExplainMistakeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Stream a tutor explanation of a wrong quiz answer (and answer follow-up questions)."""
    document = get_document(db, user, request.document_id)
    if len(request.options) < 2 and not request.correct_answer_text:
        raise HTTPException(status_code=422, detail="Send the options (multiple choice) or the correct answer as text.")
    correct_option = request.options[request.correct_answer_index] if 0 <= request.correct_answer_index < len(request.options) else ""
    context = await document_context(document, f"{request.question} {correct_option or request.correct_answer_text or ''}")

    messages = build_explain_mistake_messages(
        question=request.question,
        options=request.options,
        correct_index=request.correct_answer_index,
        chosen_index=request.chosen_index,
        explanation=request.explanation,
        context=context,
        history=request.history,
        follow_up=request.message,
        question_type=request.question_type,
        correct_text=request.correct_answer_text,
        student_text=request.student_answer_text,
    )
    return streaming_response(stream_answer(messages))


@router.get("/concepts", response_model=List[str])
async def get_concepts(document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Key concepts from a document to practise explaining (Teach-it-back)."""
    document = get_document(db, user, document_id)
    content_hash = hashlib.sha1((document.content or "").encode("utf-8")).hexdigest()
    cached = _concept_cache.get(document.id)
    if cached and cached[0] == content_hash:
        return cached[1]

    try:
        concepts = await suggest_concepts(document.content)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    _concept_cache[document.id] = (content_hash, concepts)
    return concepts


@router.post("/teach-back", response_model=StudySetResponse)
async def teach_back(request: TeachBackRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Grade the student's own-words explanation of a concept (Feynman technique).

    The attempt is saved as a 'teach_back' study set and counts toward progress.
    """
    document = get_document(db, user, request.document_id)
    concept = request.concept.strip()
    context = await document_context(document, concept)

    try:
        feedback = await grade_teach_back(concept, request.explanation.strip(), context)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    study_set = create_study_set(
        db, document, "teach_back",
        {"concept": concept, "explanation": request.explanation.strip(), "feedback": feedback},
    )
    record_activity(db, study_set, "teach_back", feedback["score"], 100, details={"concept": concept})
    db.refresh(study_set)
    return to_response(study_set)


# ---------------------------------------------------------------------------
# Reader: actions on highlighted text
# ---------------------------------------------------------------------------

class SelectionRequest(BaseModel):
    document_id: str
    selection: str = Field(min_length=3, max_length=4000)


class SelectionStreamRequest(SelectionRequest):
    action: Literal["explain", "simplify"]
    history: List[dict] = []
    message: Optional[str] = Field(default=None, max_length=4000)


class SelectionQuizRequest(SelectionRequest):
    count: int = Field(default=3, ge=1, le=10)


HIGHLIGHTS_SOURCE = "reader"


@router.post("/selection/stream")
async def explain_selection(request: SelectionStreamRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Stream an explanation or simplification of a highlighted passage (with follow-ups)."""
    document = get_document(db, user, request.document_id)
    context = await document_context(document, request.selection)
    messages = build_selection_messages(request.action, request.selection, context, request.history, request.message)
    return streaming_response(stream_answer(messages))


@router.post("/selection/flashcards", response_model=StudySetResponse)
async def flashcards_from_highlight(request: SelectionRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Turn a highlighted passage into flashcards, added to the document's "Highlights" deck.

    The deck is a normal flashcard study set, so its cards join spaced-repetition reviews.
    """
    document = get_document(db, user, request.document_id)
    context = await document_context(document, request.selection)
    try:
        cards = await flashcards_from_selection(request.selection, context)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not cards:
        raise HTTPException(status_code=502, detail="The AI could not make a flashcard from that passage. Try highlighting more text.")

    deck = next(
        (s for s in db.query(StudySet).filter(StudySet.document_id == document.id, StudySet.kind == "flashcards").all()
         if json.loads(s.config or "{}").get("source") == HIGHLIGHTS_SOURCE),
        None,
    )
    new_cards = [card.model_dump() for card in cards]
    if deck is None:
        deck = create_study_set(
            db, document, "flashcards", new_cards,
            {"source": HIGHLIGHTS_SOURCE}, title=f"Highlights · {document.title}"
        )
    else:
        # Append only, so existing cards keep their index (and spaced-repetition schedule)
        deck.data = json.dumps(json.loads(deck.data) + new_cards)
        db.commit()
        db.refresh(deck)
    response = to_response(deck)
    return response.model_copy(update={"config": {**response.config, "added": len(new_cards)}})


@router.post("/selection/quiz", response_model=StudySetResponse)
async def quiz_from_highlight(request: SelectionQuizRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Generate a short quiz about a highlighted passage (saved as a quiz study set)."""
    document = get_document(db, user, request.document_id)
    context = await document_context(document, request.selection)
    content = f"FOCUS PASSAGE (base every question on this):\n{request.selection}\n\nSURROUNDING CONTEXT:\n{context[:4000]}"
    try:
        quiz = await generate_quiz(content=content, count=request.count)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not quiz:
        raise HTTPException(status_code=502, detail="The AI could not make a quiz from that passage. Try highlighting more text.")
    snippet = " ".join(request.selection.split())[:40]
    title = f"Highlight quiz · {snippet}{'…' if len(request.selection) > 40 else ''}"
    study_set = create_study_set(db, document, "quiz", quiz, {"count": request.count, "source": HIGHLIGHTS_SOURCE}, title=title)
    from services.assessment import bank
    from services.assessment.schema import upgrade_quiz
    bank.add_questions(db, user.id, document.id, study_set.id, upgrade_quiz(json.loads(study_set.data)), "quiz")
    return to_response(study_set)
