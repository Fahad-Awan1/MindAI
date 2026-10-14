"""
Exam room: timed attempts with autosave, streamed marking, reports, history and re-mark requests.
"""
import json
import time
import uuid
from typing import Any, AsyncIterator, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import ExamAttempt, StudyActivity, StudySet, User
from services.assessment.exam_grader import build_report, compute_totals, mark_exam, next_steps, remark_question
from services.assessment.schema import upgrade_exam
from services.auth_service import get_current_user
from services.groq_service import AIServiceError
from services.streaming import ndjson, streaming_response
from services.study_service import record_activity, topic_stats

router = APIRouter(prefix="/api/exams", tags=["exams"])

# Clients auto-submit at zero; allow for network delay before treating a submission as late
GRACE_MS = 60_000
KEY_FIELDS = ("answer_key", "marking_scheme", "correct_answer_index", "explanation", "model_answer")


class DraftRequest(BaseModel):
    answers: Dict[str, Any] = Field(default_factory=dict)


class SubmitRequest(BaseModel):
    answers: Optional[Dict[str, Any]] = None


class RemarkRequest(BaseModel):
    qid: str
    reason: str = Field(min_length=5, max_length=1500)


def now_ms() -> int:
    return int(time.time() * 1000)


def _exam_set(db: Session, user: User, set_id: str) -> StudySet:
    s = db.query(StudySet).filter(StudySet.id == set_id, StudySet.user_id == user.id, StudySet.kind == "exam").first()
    if not s:
        raise HTTPException(status_code=404, detail="Exam not found")
    return s


def _attempt(db: Session, user: User, attempt_id: str) -> ExamAttempt:
    a = db.query(ExamAttempt).filter(ExamAttempt.id == attempt_id, ExamAttempt.user_id == user.id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return a


def _clean_answers(answers: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in list(answers.items())[:200]:
        if isinstance(v, str):
            out[str(k)] = v[:8000]
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[str(k)] = v
    return out


def active_attempt(db: Session, user_id: str, set_id: str) -> Optional[ExamAttempt]:
    """An unfinished attempt still inside its time window (the answer key stays hidden meanwhile)."""
    attempt = (db.query(ExamAttempt)
               .filter(ExamAttempt.study_set_id == set_id, ExamAttempt.user_id == user_id, ExamAttempt.status == "in_progress")
               .order_by(ExamAttempt.started_at.desc()).first())
    if attempt and attempt.deadline_at and now_ms() > attempt.deadline_at + GRACE_MS:
        return None
    return attempt


def hide_key(exam: Dict) -> Dict:
    exam = dict(exam)
    exam["questions"] = [{k: v for k, v in q.items() if k not in KEY_FIELDS} for q in exam.get("questions", [])]
    exam["key_hidden"] = True
    return exam


def attempt_json(a: ExamAttempt, include_answers: bool = True) -> Dict:
    return {
        "id": a.id, "study_set_id": a.study_set_id, "status": a.status, "started_at": a.started_at,
        "deadline_at": a.deadline_at, "submitted_at": a.submitted_at, "time_spent_ms": a.time_spent_ms, "late": a.late,
        "total_awarded": a.total_awarded, "total_marks": a.total_marks,
        "answers": json.loads(a.answers or "{}") if include_answers else None,
        "grading": json.loads(a.grading) if a.grading else None,
        "report": json.loads(a.report) if a.report else None,
        "remarks": json.loads(a.remarks) if a.remarks else [],
        "server_now": now_ms(),
    }


@router.post("/{set_id}/attempts")
def start_attempt(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Start (or resume) a timed sitting of the exam."""
    study_set = _exam_set(db, user, set_id)
    current = active_attempt(db, user.id, set_id)
    if current:
        return attempt_json(current)
    exam = upgrade_exam(json.loads(study_set.data))
    started = now_ms()
    duration = int(exam.get("duration_minutes") or 60)
    attempt = ExamAttempt(id=uuid.uuid4().hex, study_set_id=set_id, user_id=user.id, status="in_progress", answers="{}",
                          started_at=started, deadline_at=started + duration * 60_000)
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt_json(attempt)


@router.put("/attempts/{attempt_id}/draft")
def save_draft(attempt_id: str, request: DraftRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Autosave answers while the exam is running."""
    attempt = _attempt(db, user, attempt_id)
    if attempt.status != "in_progress":
        raise HTTPException(status_code=409, detail="This attempt has already been submitted.")
    if attempt.deadline_at and now_ms() > attempt.deadline_at + GRACE_MS:
        raise HTTPException(status_code=403, detail="Time is up - your last saved answers will be marked.")
    attempt.answers = json.dumps(_clean_answers(request.answers))
    db.commit()
    return {"saved_at": now_ms()}


@router.post("/attempts/{attempt_id}/submit/stream")
async def submit_attempt(attempt_id: str, request: SubmitRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Submit and mark the attempt, streaming each question's mark, then the report."""
    attempt = _attempt(db, user, attempt_id)
    if attempt.status == "graded":
        raise HTTPException(status_code=409, detail="This attempt has already been marked.")
    # A second submit while the first is still being marked (e.g. the connection dropped and the app retried)
    # would mark it twice; an interrupted marking resets the status, so this only blocks a live run
    if attempt.status == "grading" and attempt.submitted_at and now_ms() - attempt.submitted_at < 3 * 60 * 1000:
        raise HTTPException(status_code=409, detail="Your exam is already being marked. Open it again in a minute to see the result.")
    study_set = attempt.study_set
    exam = upgrade_exam(json.loads(study_set.data))
    config = json.loads(study_set.config or "{}")
    doc_ids = config.get("document_ids") or [study_set.document_id]
    submitted = now_ms()
    late = bool(attempt.deadline_at and submitted > attempt.deadline_at + GRACE_MS)
    # After the deadline only the last autosaved answers count
    answers = json.loads(attempt.answers or "{}") if late or request.answers is None else _clean_answers(request.answers)
    attempt.answers = json.dumps(answers)
    attempt.status = "grading"
    attempt.submitted_at = submitted
    attempt.late = late
    attempt.time_spent_ms = min(submitted, attempt.deadline_at or submitted) - attempt.started_at
    db.commit()
    attempt_id_, user_id, set_id = attempt.id, user.id, study_set.id
    time_spent = attempt.time_spent_ms
    doc_id = study_set.document_id
    topics = {str(q.get("topic") or "").lower() for q in exam["questions"]}
    stats = [t for t in topic_stats(db, doc_id) if t.topic.lower() in topics]
    mastery = sum(t.accuracy_pct for t in stats) / len(stats) if stats else None

    async def events() -> AsyncIterator[str]:
        finished = False
        try:
            async for line in _mark_and_save():
                if '"type": "done"' in line:
                    finished = True
                yield line
        finally:
            if not finished:
                # Marking was interrupted (e.g. the page closed): let the student submit again
                db3 = SessionLocal()
                try:
                    a = db3.query(ExamAttempt).filter(ExamAttempt.id == attempt_id_).first()
                    if a and a.status == "grading":
                        a.status = "in_progress"
                        db3.commit()
                finally:
                    db3.close()

    async def _mark_and_save() -> AsyncIterator[str]:
        grading: Dict[str, Dict] = {}
        yield ndjson({"type": "start", "total": len(exam["questions"]), "late": late})
        try:
            async for event in mark_exam(exam, answers, doc_ids):
                if event["type"] == "graded":
                    grading[event["qid"]] = event["result"]
                yield ndjson(event)
        except AIServiceError as e:
            yield ndjson({"type": "warning", "message": str(e)})
        for q in exam["questions"]:
            grading.setdefault(q["id"], {"awarded_marks": 0.0, "max_marks": float(q.get("marks") or 1),
                                         "feedback": "Could not be marked - try a re-mark.", "missing_points": [], "points": [], "error": True})
        report = build_report(exam, grading, time_spent, mastery)
        report["next_steps"] = await next_steps(exam, grading, report)
        db2 = SessionLocal()
        try:
            a = db2.query(ExamAttempt).filter(ExamAttempt.id == attempt_id_).first()
            s = db2.query(StudySet).filter(StudySet.id == set_id).first()
            from services.assessment import bank
            by_id = {q["id"]: q for q in exam["questions"]}
            bank.record_results(db2, user_id, s.document_id, s.id,
                                [(by_id[qid], g["awarded_marks"] / max(1.0, g["max_marks"])) for qid, g in grading.items()
                                 if qid in by_id and not g.get("error")], "exam", commit=False)
            activity = record_activity(db2, s, "exam", round(report["total_awarded"]), max(1, round(report["total_marks"])),
                                       details={"v": 2, "attempt_id": attempt_id_, "pct": report["pct"]})
            a.grading = json.dumps(grading)
            a.report = json.dumps(report)
            a.total_awarded = report["total_awarded"]
            a.total_marks = report["total_marks"]
            a.status = "graded"
            a.activity_id = activity.id
            db2.commit()
            db2.refresh(a)
            yield ndjson({"type": "summary", "report": report})
            yield ndjson({"type": "done", "attempt": attempt_json(a)})
        finally:
            db2.close()

    return streaming_response(events())


@router.get("/{set_id}/attempts")
def list_attempts(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Every sitting of this exam (newest first)."""
    _exam_set(db, user, set_id)
    attempts = (db.query(ExamAttempt).filter(ExamAttempt.study_set_id == set_id, ExamAttempt.user_id == user.id)
                .order_by(ExamAttempt.started_at.desc()).all())
    return [attempt_json(a, include_answers=False) for a in attempts]


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """One attempt with answers, marking and report (resumes an unfinished one)."""
    return attempt_json(_attempt(db, user, attempt_id))


@router.post("/attempts/{attempt_id}/remark")
async def remark(attempt_id: str, request: RemarkRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Ask for one answer to be marked again, explaining why you think you deserve more."""
    attempt = _attempt(db, user, attempt_id)
    if attempt.status != "graded":
        raise HTTPException(status_code=409, detail="Only marked attempts can be re-marked.")
    remarks = json.loads(attempt.remarks or "[]")
    if sum(1 for r in remarks if r.get("qid") == request.qid) >= 2:
        raise HTTPException(status_code=429, detail="This answer has already been re-marked twice.")
    exam = upgrade_exam(json.loads(attempt.study_set.data))
    q = next((x for x in exam["questions"] if x["id"] == request.qid), None)
    if not q or q.get("type") == "mcq":
        raise HTTPException(status_code=400, detail="Only written answers can be re-marked.")
    answers = json.loads(attempt.answers or "{}")
    grading = json.loads(attempt.grading or "{}")
    before = grading.get(request.qid, {}).get("awarded_marks", 0)
    config = json.loads(attempt.study_set.config or "{}")
    try:
        result = await remark_question(q, str(answers.get(request.qid) or ""), request.reason,
                                       config.get("document_ids") or [attempt.study_set.document_id])
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    grading[request.qid] = result
    remarks.append({"qid": request.qid, "reason": request.reason, "before": before, "after": result["awarded_marks"], "at": now_ms()})
    report = json.loads(attempt.report or "{}")
    totals = compute_totals(exam, grading)
    report.update(totals)
    report["pct"] = round(100 * totals["total_awarded"] / totals["total_marks"]) if totals["total_marks"] else 0
    from services.assessment.exam_grader import grade_letter
    report["grade"] = grade_letter(report["pct"])
    attempt.grading = json.dumps(grading)
    attempt.report = json.dumps(report)
    attempt.remarks = json.dumps(remarks)
    attempt.total_awarded = totals["total_awarded"]
    if attempt.activity_id:
        activity = db.query(StudyActivity).filter(StudyActivity.id == attempt.activity_id).first()
        if activity:
            activity.correct = round(totals["total_awarded"])
    db.commit()
    return {"result": result, "before": before, "attempt": attempt_json(attempt)}
