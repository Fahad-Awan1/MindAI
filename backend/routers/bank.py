"""
Question bank, instant quizzes, exports, past-paper blueprints and room challenges.
"""
import json
import time
import uuid
from types import SimpleNamespace
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import ChallengeAttempt, QuestionBankItem, Room, RoomChallenge, RoomMember, StudySet, User
from services.assessment import bank
from services.assessment.export import FORMATS, export_set
from services.assessment.schema import new_id, upgrade_quiz
from services.auth_service import get_current_user, get_user_document
from services.groq_service import AIServiceError
from services.study_service import create_study_set, to_response, topic_stats, weak_topics

router = APIRouter(prefix="/api", tags=["question-bank"])


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Question bank
# ---------------------------------------------------------------------------

class BankQuizRequest(BaseModel):
    document_id: Optional[str] = None
    source: Literal["due", "missed", "weak", "random"] = "due"
    count: int = Field(default=10, ge=1, le=30)


@router.get("/bank/summary")
def bank_summary(document_id: Optional[str] = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """How many questions are in the bank, due for review and previously missed."""
    query = db.query(QuestionBankItem).filter(QuestionBankItem.user_id == user.id)
    if document_id:
        query = query.filter(QuestionBankItem.document_id == document_id)
    items = query.all()
    now = now_ms()
    quizzable = [i for i in items if i.type not in ("short", "long")]
    by_topic: Dict[str, Dict] = {}
    for i in items:
        t = by_topic.setdefault(i.topic.lower(), {"topic": i.topic, "questions": 0, "seen": 0, "score": 0.0})
        t["questions"] += 1
        t["seen"] += i.times_seen
        t["score"] += i.score_sum
    topics = sorted(({"topic": t["topic"], "questions": t["questions"], "answered": t["seen"],
                      "accuracy_pct": round(100 * t["score"] / t["seen"]) if t["seen"] else None} for t in by_topic.values()),
                    key=lambda t: (t["accuracy_pct"] is None, t["accuracy_pct"] or 0))
    return {
        "total": len(items),
        "quizzable": len(quizzable),
        "answered": sum(1 for i in items if i.times_seen),
        "due": sum(1 for i in quizzable if i.srs_due_at and i.srs_due_at <= now),
        "missed": sum(1 for i in quizzable if i.last_correct is False),
        "mastered": sum(1 for i in items if i.times_seen >= 2 and i.last_correct and i.srs_interval_days >= 3),
        "topics": topics[:30],
    }


@router.get("/bank/questions")
def bank_questions(document_id: Optional[str] = None, status: Literal["all", "due", "missed", "new"] = "all",
                   topic: Optional[str] = None, limit: int = Query(default=100, le=500),
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(QuestionBankItem).filter(QuestionBankItem.user_id == user.id)
    if document_id:
        query = query.filter(QuestionBankItem.document_id == document_id)
    if topic:
        query = query.filter(QuestionBankItem.topic == topic)
    now = now_ms()
    items = query.order_by(QuestionBankItem.created_at.desc()).all()
    if status == "due":
        items = [i for i in items if i.srs_due_at and i.srs_due_at <= now]
    elif status == "missed":
        items = [i for i in items if i.last_correct is False]
    elif status == "new":
        items = [i for i in items if not i.times_seen]
    return [{
        "id": i.id, "document_id": i.document_id, "type": i.type, "topic": i.topic, "difficulty": i.difficulty, "bloom": i.bloom,
        "question": json.loads(i.question).get("question", ""), "times_seen": i.times_seen, "times_correct": i.times_correct,
        "accuracy_pct": round(100 * i.score_sum / i.times_seen) if i.times_seen else None, "last_correct": i.last_correct,
        "due_at": i.srs_due_at, "source": i.source,
    } for i in items[:limit]]


@router.post("/bank/quiz")
def bank_quiz(request: BankQuizRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """An instant quiz from questions you've already generated - no waiting for the AI."""
    if request.document_id:
        get_user_document(db, user, request.document_id)
    weak = []
    if request.source == "weak" and request.document_id:
        weak = [t.topic for t in weak_topics(topic_stats(db, request.document_id))]
    picked = bank.pick_questions(db, user.id, request.document_id, request.source, request.count, weak)
    if not picked:
        detail = {"due": "Nothing is due for review right now - great job!", "missed": "You haven't missed any questions yet.",
                  "weak": "No weak topics yet.", "random": "Generate a quiz first - its questions go into your bank."}[request.source]
        raise HTTPException(status_code=404, detail=detail)
    questions = []
    for _, q in picked:
        q = dict(q)
        q["id"] = new_id()
        questions.append(q)
    doc_id = request.document_id or picked[0][0]
    label = {"due": "Review", "missed": "Missed questions", "weak": "Weak topics", "random": "Shuffle"}[request.source]
    study_set = create_study_set(db, SimpleNamespace(id=doc_id, user_id=user.id), "quiz", questions,
                                 {"schema": 2, "count": len(questions), "from_bank": request.source,
                                  "document_ids": list({d for d, _ in picked})}, f"{label} · {len(questions)} questions")
    return to_response(study_set)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@router.get("/assessment/sets/{set_id}/export")
def export(set_id: str, format: str = "docx", version: Literal["A", "B"] = "A", key: bool = True,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Download a quiz or exam as Word, CSV, Anki, Moodle GIFT/XML, Kahoot or a Google Forms script."""
    study_set = db.query(StudySet).filter(StudySet.id == set_id, StudySet.user_id == user.id).first()
    if not study_set or study_set.kind not in ("quiz", "exam"):
        raise HTTPException(status_code=404, detail="Quiz or exam not found")
    if format not in FORMATS:
        raise HTTPException(status_code=400, detail=f"Format must be one of: {', '.join(FORMATS)}")
    if study_set.kind == "exam" and key:
        from routers.exams import active_attempt
        if active_attempt(db, user.id, set_id):
            key = False  # Never hand out the mark scheme mid-exam
    content, media, filename = export_set(study_set, format, version, key)
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": content_disposition(filename)})


# ---------------------------------------------------------------------------
# Mock exams modelled on a past paper
# ---------------------------------------------------------------------------

class PastPaperRequest(BaseModel):
    document_id: str


@router.post("/assessment/past-paper/blueprint")
async def past_paper_blueprint(request: PastPaperRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Read an uploaded past paper and describe its structure, so a mock exam can copy it."""
    document = get_user_document(db, user, request.document_id)
    text = (document.content or "").strip()
    if len(text) < 200:
        raise HTTPException(status_code=422, detail="That document doesn't look like an exam paper (too little text).")
    from services.assessment.budget import budget, estimate_tokens
    from services.groq_service import _extract_list, _parse_json, complete_with_usage
    prompt = (
        "This is a past exam paper. Describe its STRUCTURE so a new paper can be written in the same format.\n"
        'Return JSON: {"title_style": "...", "duration_minutes": n, "sections": [{"kind": "objective|short|long", "count": n, '
        '"marks_each": n, "attempt_any": n or null, "subparts": true|false, "title": "..."}], '
        '"style_notes": "2-4 sentences on command words, question style, how marks are shown, typical length of answers"}\n'
        "Use 1-4 sections. objective = multiple choice; short = a few lines; long = extended/essay or structured questions.\n\n"
        f"PAPER:\n{text[:9000]}"
    )
    messages = [{"role": "system", "content": "You analyse exam papers. Always respond with valid JSON."}, {"role": "user", "content": prompt}]
    estimate = estimate_tokens(len(prompt), 1200)
    handle = budget.reserve(estimate)
    try:
        raw, used = await complete_with_usage(messages, temperature=0.2, max_tokens=1200, json_mode=True)
        budget.settle(handle, used)
        data = _parse_json(raw)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Couldn't read the paper's structure. Please try again.")
    sections = []
    for s in (data.get("sections") or [])[:4]:
        if not isinstance(s, dict):
            continue
        kind = s.get("kind") if s.get("kind") in ("objective", "short", "long") else "short"
        try:
            count = max(1, min(30, int(s.get("count") or 1)))
            marks = max(1, min(50, int(s.get("marks_each") or 1)))
            any_n = int(s["attempt_any"]) if s.get("attempt_any") else None
        except (TypeError, ValueError):
            continue
        sections.append({"kind": kind, "count": count, "marks_each": marks,
                         "attempt_any": any_n if any_n and any_n < count else None,
                         "subparts": bool(s.get("subparts")) and kind == "long", "title": str(s.get("title") or "")[:80]})
    if not sections:
        raise HTTPException(status_code=502, detail="Couldn't find the paper's sections. Please try again.")
    try:
        duration = max(10, min(360, int(data.get("duration_minutes") or 0))) or None
    except (TypeError, ValueError):
        duration = None
    return {"sections": sections, "duration_minutes": duration, "style_notes": str(data.get("style_notes") or "")[:1200],
            "paper_title": document.title}


# ---------------------------------------------------------------------------
# Room challenges: share a quiz with a study room, everyone plays it in their own time
# ---------------------------------------------------------------------------

class ChallengeCreate(BaseModel):
    set_id: str
    time_limit_s: Optional[int] = Field(default=None, ge=30, le=7200)


class ChallengeAnswers(BaseModel):
    responses: List[Dict] = Field(min_length=1, max_length=60)
    duration_ms: int = Field(default=0, ge=0)


def _member_room(db: Session, user: User, room_id: str) -> Room:
    member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user.id).first()
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room or not member:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _leaderboard(db: Session, challenge_id: str) -> List[Dict]:
    attempts = db.query(ChallengeAttempt).filter(ChallengeAttempt.challenge_id == challenge_id).all()
    best: Dict[str, ChallengeAttempt] = {}
    for a in attempts:
        cur = best.get(a.user_id)
        if not cur or (a.score, -a.duration_ms) > (cur.score, -cur.duration_ms):
            best[a.user_id] = a
    users = {u.id: u for u in db.query(User).filter(User.id.in_(list(best))).all()} if best else {}
    rows = [{"user": {"id": uid, "name": users[uid].name, "avatar_color": users[uid].avatar_color} if uid in users else {"id": uid, "name": "?", "avatar_color": "#64748b"},
             "score": round(a.score, 2), "total": a.total, "pct": round(100 * a.score / a.total) if a.total else 0,
             "duration_ms": a.duration_ms, "attempts": sum(1 for x in attempts if x.user_id == uid)}
            for uid, a in best.items()]
    return sorted(rows, key=lambda r: (-r["score"], r["duration_ms"]))


def _challenge_json(db: Session, c: RoomChallenge, user_id: str, with_questions: bool = False) -> Dict:
    questions = json.loads(c.questions)
    mine = db.query(ChallengeAttempt).filter(ChallengeAttempt.challenge_id == c.id, ChallengeAttempt.user_id == user_id).count()
    creator = db.query(User).filter(User.id == c.created_by).first()
    out = {"id": c.id, "room_id": c.room_id, "title": c.title, "count": len(questions), "time_limit_s": c.time_limit_s,
           "created_at": c.created_at, "created_by": {"id": c.created_by, "name": creator.name if creator else "?"},
           "my_attempts": mine, "leaderboard": _leaderboard(db, c.id)}
    if with_questions:
        out["questions"] = questions
    return out


@router.post("/rooms/{room_id}/challenges")
async def create_challenge(room_id: str, request: ChallengeCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Share one of your quizzes with the room as a challenge (a frozen copy, so later edits don't change it)."""
    _member_room(db, user, room_id)
    study_set = db.query(StudySet).filter(StudySet.id == request.set_id, StudySet.user_id == user.id, StudySet.kind == "quiz").first()
    if not study_set:
        raise HTTPException(status_code=404, detail="Quiz not found")
    questions = upgrade_quiz(json.loads(study_set.data))[:60]
    challenge = RoomChallenge(id=uuid.uuid4().hex, room_id=room_id, created_by=user.id, title=study_set.title[:200],
                              questions=json.dumps(questions), time_limit_s=request.time_limit_s, created_at=now_ms())
    db.add(challenge)
    db.commit()
    from services.room_service import add_message, manager, message_out
    message = add_message(db, room_id, f"{user.name} posted a quiz challenge: {study_set.title}", kind="quiz",
                          data={"challenge_id": challenge.id, "questions": len(questions), "title": study_set.title})
    await manager.broadcast(room_id, {"type": "message", "message": message_out(message)})
    return _challenge_json(db, challenge, user.id)


@router.get("/rooms/{room_id}/challenges")
def list_challenges(room_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member_room(db, user, room_id)
    rows = db.query(RoomChallenge).filter(RoomChallenge.room_id == room_id).order_by(RoomChallenge.created_at.desc()).all()
    return [_challenge_json(db, c, user.id) for c in rows]


@router.get("/challenges/{challenge_id}")
def get_challenge(challenge_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The challenge's questions (without answers) and its leaderboard."""
    c = db.query(RoomChallenge).filter(RoomChallenge.id == challenge_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Challenge not found")
    _member_room(db, user, c.room_id)
    data = _challenge_json(db, c, user.id, with_questions=True)
    answer_fields = ("correct_answer_index", "correct_indices", "correct_bool", "blanks", "pairs", "answer", "tolerance",
                     "model_answer", "key_points", "explanation", "answer_key", "marking_scheme")
    data["questions"] = [{k: v for k, v in q.items() if k not in answer_fields} for q in data["questions"]]
    return data


@router.post("/challenges/{challenge_id}/attempts")
async def submit_challenge(challenge_id: str, request: ChallengeAnswers, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mark a challenge attempt and return your results and the updated leaderboard."""
    from routers.assessment import _grade_all
    c = db.query(RoomChallenge).filter(RoomChallenge.id == challenge_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Challenge not found")
    _member_room(db, user, c.room_id)
    questions = json.loads(c.questions)
    by_id = {q["id"]: q for q in questions}
    responses = [r for r in request.responses if isinstance(r, dict) and r.get("qid") in by_id]
    if not responses:
        raise HTTPException(status_code=400, detail="No answers for this challenge.")
    results = await _grade_all(by_id, responses)
    score = sum(r["score"] for r in results)
    db.add(ChallengeAttempt(id=uuid.uuid4().hex, challenge_id=c.id, user_id=user.id, score=score, total=len(questions),
                            duration_ms=request.duration_ms, results=json.dumps(results), created_at=now_ms()))
    db.commit()
    board = _leaderboard(db, c.id)
    from services.room_service import manager
    await manager.broadcast(c.room_id, {"type": "challenge_update", "challenge_id": c.id, "leaderboard": board})
    return {"results": results, "score": round(score, 2), "total": len(questions),
            "score_pct": round(100 * score / len(questions)) if questions else 0, "leaderboard": board,
            "questions": questions}
