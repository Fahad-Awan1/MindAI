import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from models import Document, StudySet, User
from schemas import (
    ActivityResponse,
    ExamAttemptRequest,
    ExamGradeResponse,
    CardSchedule,
    DueQueue,
    ReviewRequest,
    ReviewResponse,
    TopicStat,
    FlashcardSessionRequest,
    ProgressResponse,
    QuizAttemptRequest,
    StudySetKind,
    StudySetResponse,
    StudySetSummary,
    StudySetUpdate,
)
from services.auth_service import get_current_user, get_user_document
from services.study_service import compute_progress, now_ms, record_activity, score_pct, to_response, to_summary, topic_stats
from services.srs_service import apply_reviews, deck_schedule, due_queue
from routers.audio import delete_overview_audio
from services.groq_service import AIServiceError, grade_exam_answers

router = APIRouter(prefix="/api", tags=["study-sets"])


def get_study_set(db: Session, user: User, set_id: str) -> StudySet:
    """A study set owned by the user (404 otherwise)."""
    study_set = db.query(StudySet).filter(StudySet.id == set_id, StudySet.user_id == user.id).first()
    if not study_set:
        raise HTTPException(status_code=404, detail="Study set not found")
    return study_set


def to_activity_response(activity) -> ActivityResponse:
    return ActivityResponse(
        id=activity.id,
        study_set_id=activity.study_set_id,
        kind=activity.kind,
        correct=activity.correct,
        total=activity.total,
        score_pct=score_pct(activity.correct, activity.total),
        created_at=activity.created_at,
    )


@router.get("/study-sets", response_model=List[StudySetSummary])
def list_study_sets(
    document_id: Optional[str] = None,
    kind: Optional[StudySetKind] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List saved study sets (newest first), optionally filtered by document and/or kind."""
    query = db.query(StudySet).filter(StudySet.user_id == user.id)
    if document_id:
        query = query.filter(StudySet.document_id == document_id)
    if kind:
        query = query.filter(StudySet.kind == kind)
    return [to_summary(s) for s in query.order_by(StudySet.created_at.desc()).all()]


@router.get("/study-sets/{set_id}", response_model=StudySetResponse)
def get_study_set_by_id(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get a saved study set including its content (an exam's answer key is hidden while it is being sat)."""
    study_set = get_study_set(db, user, set_id)
    response = to_response(study_set)
    if study_set.kind == "exam":
        from routers.exams import active_attempt, hide_key
        from services.assessment.schema import upgrade_exam
        if active_attempt(db, user.id, study_set.id):
            response.data = hide_key(upgrade_exam(response.data))
    return response


@router.patch("/study-sets/{set_id}", response_model=StudySetSummary)
def rename_study_set(set_id: str, update: StudySetUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Rename a saved study set."""
    study_set = get_study_set(db, user, set_id)
    study_set.title = update.title.strip()
    db.commit()
    db.refresh(study_set)
    return to_summary(study_set)


@router.delete("/study-sets/{set_id}")
def delete_study_set(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete a saved study set and its attempt history."""
    study_set = get_study_set(db, user, set_id)
    delete_overview_audio(study_set)
    db.delete(study_set)
    db.commit()
    return {"message": "Study set deleted successfully"}


@router.post("/study-sets/{set_id}/quiz-attempts", response_model=ActivityResponse)
def submit_quiz_attempt(set_id: str, attempt: QuizAttemptRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Score a quiz attempt on the server and record it."""
    study_set = get_study_set(db, user, set_id)
    if study_set.kind != "quiz":
        raise HTTPException(status_code=400, detail="This study set is not a quiz")

    questions = json.loads(study_set.data)
    if len(attempt.answers) != len(questions):
        raise HTTPException(
            status_code=400,
            detail=f"Expected {len(questions)} answers, got {len(attempt.answers)}"
        )

    correct = sum(
        1 for answer, question in zip(attempt.answers, questions)
        if answer == question.get("correct_answer_index")
    )
    from services.assessment import bank
    from services.assessment.schema import upgrade_quiz
    bank.record_results(db, user.id, study_set.document_id, study_set.id,
                        [(q, 1.0 if a == q.get("correct_answer_index") else 0.0)
                         for q, a in zip(upgrade_quiz(questions), attempt.answers)], "quiz", commit=False)
    activity = record_activity(
        db, study_set, "quiz", correct, len(questions),
        details={"answers": attempt.answers}
    )
    return to_activity_response(activity)


@router.post("/study-sets/{set_id}/flashcard-sessions", response_model=ActivityResponse)
def submit_flashcard_session(set_id: str, session: FlashcardSessionRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Record a flashcard review session (which cards were known)."""
    study_set = get_study_set(db, user, set_id)
    if study_set.kind != "flashcards":
        raise HTTPException(status_code=400, detail="This study set is not a flashcard deck")

    activity = record_activity(
        db, study_set, "flashcards", sum(session.results), len(session.results),
        details={"results": session.results}
    )
    return to_activity_response(activity)


@router.get("/study-sets/{set_id}/activities", response_model=List[ActivityResponse])
def list_activities(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Attempt / review history for a study set (oldest first)."""
    study_set = get_study_set(db, user, set_id)
    return [to_activity_response(a) for a in sorted(study_set.activities, key=lambda a: a.created_at)]


@router.post("/study-sets/{set_id}/exam-attempts", response_model=ExamGradeResponse)
async def submit_exam_attempt(set_id: str, attempt: ExamAttemptRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mark written exam answers against the answer key with the AI and record the result."""
    study_set = get_study_set(db, user, set_id)
    if study_set.kind != "exam":
        raise HTTPException(status_code=400, detail="This study set is not an exam")

    exam = json.loads(study_set.data)
    questions = exam.get("questions", [])
    if len(attempt.answers) != len(questions):
        raise HTTPException(status_code=400, detail=f"Expected {len(questions)} answers, got {len(attempt.answers)}")
    if not any(a.strip() for a in attempt.answers):
        raise HTTPException(status_code=400, detail="Write an answer to at least one question before submitting.")

    try:
        grading = await grade_exam_answers(exam, attempt.answers)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    total_marks = sum(q["max_marks"] for q in grading["questions"])
    total_awarded = round(sum(q["awarded_marks"] for q in grading["questions"]), 1)
    activity = record_activity(
        db, study_set, "exam", round(total_awarded), total_marks,
        details={"answers": attempt.answers, "grading": grading}
    )
    return ExamGradeResponse(
        activity=to_activity_response(activity),
        total_awarded=total_awarded,
        total_marks=total_marks,
        score_pct=score_pct(total_awarded, total_marks),
        questions=grading["questions"],
        overall_feedback=grading["overall_feedback"],
    )


@router.get("/study-sets/{set_id}/schedule", response_model=List[CardSchedule])
def get_deck_schedule(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Spaced-repetition schedule for every card in a flashcard deck."""
    study_set = get_study_set(db, user, set_id)
    if study_set.kind != "flashcards":
        raise HTTPException(status_code=400, detail="This study set is not a flashcard deck")
    return deck_schedule(study_set)


@router.post("/study-sets/{set_id}/reviews", response_model=ReviewResponse)
def submit_reviews(set_id: str, request: ReviewRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Record Again/Hard/Good/Easy ratings for cards in a deck.

    Updates each card's spaced-repetition schedule and logs the session for progress
    ("Again" counts as not known; Hard/Good/Easy count as known).
    """
    study_set = get_study_set(db, user, set_id)
    if study_set.kind != "flashcards":
        raise HTTPException(status_code=400, detail="This study set is not a flashcard deck")

    ratings = [r.model_dump() for r in request.ratings]
    try:
        apply_reviews(db, study_set, ratings, now_ms())
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    known = sum(1 for r in ratings if r["rating"] != "again")
    activity = record_activity(db, study_set, "flashcards", known, len(ratings), details={"ratings": ratings})
    db.refresh(study_set)
    return ReviewResponse(activity=to_activity_response(activity), schedule=deck_schedule(study_set))


@router.get("/review/due", response_model=DueQueue)
def get_due_cards(
    new_limit: int = Query(default=10, ge=0, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Today's review queue across all decks: due cards first, then up to `new_limit` new cards."""
    return due_queue(db, user.id, now_ms(), new_limit=new_limit)


@router.get("/topics", response_model=List[TopicStat])
def get_topics(document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Quiz accuracy per topic for a document, weakest first."""
    get_user_document(db, user, document_id)
    return topic_stats(db, document_id)


@router.get("/progress", response_model=ProgressResponse)
def get_progress(
    tz_offset_minutes: int = Query(default=0, ge=-14 * 60, le=14 * 60),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Learning progress for the dashboard.

    `tz_offset_minutes` is the browser's `new Date().getTimezoneOffset()` so that
    streaks and daily activity use the student's local days.
    """
    return compute_progress(db, user.id, tz_offset_minutes)
