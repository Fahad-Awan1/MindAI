import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Document, User
from schemas import (
    FlashcardRequest,
    QuizRequest,
    StudyPlanRequest,
    MindMapRequest,
    ExamPaperRequest,
    StudySetResponse
)
from services.groq_service import (
    generate_flashcards,
    generate_quiz,
    generate_study_plan,
    generate_mind_map,
    generate_exam_paper,
    AIServiceError
)
from services.auth_service import get_current_user, get_user_document
from services.study_service import create_study_set, to_response, topic_stats, weak_topics, recent_quiz_questions
from services.assessment import bank
from services.assessment.schema import upgrade_exam, upgrade_quiz

router = APIRouter(prefix="/api/ai", tags=["ai-features"])


def get_document_with_text(db: Session, user: User, document_id: str) -> Document:
    """Fetch the user's document and make sure it has text the AI can work with."""
    document = get_user_document(db, user, document_id)

    if not (document.content or "").strip():
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted from this document (it may be a scanned or image-only file)."
        )

    return document


async def run_generation(coro, empty_message: str):
    """Await an AI generation coroutine and map failures to HTTP errors."""
    try:
        result = await coro
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not result:
        raise HTTPException(status_code=502, detail=empty_message)

    return result


@router.post("/flashcards", response_model=StudySetResponse)
async def create_flashcards(
    request: FlashcardRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate flashcards from a specific document.

    Flow:
    1. Retrieve the document content from the database.
    2. Call the LLM service (`generate_flashcards`) with the content.
    3. The LLM extracts key concepts and defines terms.
    4. Save the deck as a study set and return it.
    """
    document = get_document_with_text(db, user, request.document_id)

    flashcards = await run_generation(
        generate_flashcards(content=document.content, count=request.count),
        "The AI did not return any flashcards. Please try again."
    )
    return to_response(create_study_set(db, document, "flashcards", flashcards, {"count": request.count}))


@router.post("/quiz", response_model=StudySetResponse)
async def create_quiz(
    request: QuizRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate quiz questions from a document and save them as a study set.

    With `focus_weak_topics`, most questions target the topics the student has been
    getting wrong, and earlier questions are avoided so the quiz feels fresh.
    """
    document = get_document_with_text(db, user, request.document_id)

    stats = topic_stats(db, document.id)
    focus = [t.topic for t in weak_topics(stats)[:4]] if request.focus_weak_topics else []
    if request.focus_weak_topics and not focus:
        raise HTTPException(
            status_code=400,
            detail="No weak topics yet. Take a regular quiz on this document first so MindAI can learn what to focus on."
        )

    quiz = await run_generation(
        generate_quiz(
            content=document.content,
            count=request.count,
            focus_topics=focus,
            known_topics=[t.topic for t in stats if t.topic != "General"][:20],
            avoid_questions=recent_quiz_questions(db, document.id)
        ),
        "The AI did not return any valid quiz questions. Please try again."
    )
    config = {"count": request.count, "focus_topics": focus}
    title = f"Focus quiz · {len(quiz)} questions" if focus else None
    study_set = create_study_set(db, document, "quiz", quiz, config, title=title)
    bank.add_questions(db, user.id, document.id, study_set.id, upgrade_quiz(json.loads(study_set.data)), "quiz")
    return to_response(study_set)


@router.post("/study-plan", response_model=StudySetResponse)
async def create_study_plan(
    request: StudyPlanRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate a study plan from a document and save it as a study set."""
    document = get_document_with_text(db, user, request.document_id)

    plan = await run_generation(
        generate_study_plan(content=document.content, days=request.days),
        "The AI did not return a study plan. Please try again."
    )
    return to_response(create_study_set(db, document, "study_plan", plan, {"days": request.days}))


@router.post("/mind-map", response_model=StudySetResponse)
async def create_mind_map(
    request: MindMapRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate a mind map from a document and save it as a study set."""
    document = get_document_with_text(db, user, request.document_id)

    mind_map = await run_generation(
        generate_mind_map(content=document.content),
        "The AI did not return a mind map. Please try again."
    )
    return to_response(create_study_set(db, document, "mind_map", mind_map))


@router.post("/exam-paper", response_model=StudySetResponse)
async def create_exam_paper(
    request: ExamPaperRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate an exam paper from a document and save it as a study set."""
    document = get_document_with_text(db, user, request.document_id)

    exam = await run_generation(
        generate_exam_paper(
            content=document.content,
            num_questions=request.num_questions,
            difficulty=request.difficulty,
            question_type=request.type
        ),
        "Failed to generate exam paper. Please try again."
    )
    study_set = create_study_set(
        db, document, "exam", exam,
        {"num_questions": request.num_questions, "difficulty": request.difficulty, "type": request.type}
    )
    bank.add_questions(db, user.id, document.id, study_set.id, upgrade_exam(json.loads(study_set.data))["questions"], "exam")
    return to_response(study_set)
