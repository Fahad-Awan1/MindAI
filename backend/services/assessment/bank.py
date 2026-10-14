"""
The question bank: every generated question, per student, with performance and a review schedule.

- add_questions(): called whenever a quiz or exam is saved/edited
- record_results(): called after every quiz attempt, exam marking and room battle
- topic accuracy for mastery is read from here, so all three count
- missed questions get a simple spaced-repetition schedule (due again soon, then less often)
"""
import hashlib
import json
import random
import time
import uuid
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from models import QuestionBankItem, StudyActivity, StudySet
from services.assessment.normalize import normalize_text
from services.assessment.schema import upgrade_exam, upgrade_quiz

DAY_MS = 24 * 3600 * 1000
RETRY_SOON_MS = 10 * 60 * 1000


def now_ms() -> int:
    return int(time.time() * 1000)


def stem_hash(question: Dict) -> str:
    text = normalize_text(f"{question.get('parent_stem', '')} {question.get('question', '')}")
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _find(db: Session, user_id: str, h: str) -> Optional[QuestionBankItem]:
    return db.query(QuestionBankItem).filter(QuestionBankItem.user_id == user_id, QuestionBankItem.stem_hash == h).first()


def add_questions(db: Session, user_id: str, document_id: str, study_set_id: Optional[str],
                  questions: Iterable[Dict], source: str = "quiz", commit: bool = True) -> int:
    """Store new questions (same question text = same bank item). Returns how many were new."""
    added = 0
    for q in questions:
        if not isinstance(q, dict) or not q.get("question"):
            continue
        h = stem_hash(q)
        item = _find(db, user_id, h)
        if item:
            item.question = json.dumps(q)  # Keep the latest edit
            continue
        db.add(QuestionBankItem(
            id=uuid.uuid4().hex, user_id=user_id, document_id=(q.get("source") or {}).get("document_id") or document_id,
            study_set_id=study_set_id, qid=q.get("id"), type=q.get("type", "mcq"),
            topic=(str(q.get("topic") or "").strip() or "General")[:60], bloom=q.get("bloom"), difficulty=q.get("difficulty"),
            stem_hash=h, question=json.dumps(q), source=source, created_at=now_ms(),
        ))
        db.flush()
        added += 1
    if commit:
        db.commit()
    return added


def _schedule(item: QuestionBankItem, score: float, at: int) -> None:
    """SM-2-lite: right answers push the next review further out; wrong ones bring it back soon."""
    if score >= 0.999:
        item.srs_ease = min(3.0, item.srs_ease + 0.1)
        item.srs_interval_days = 1.0 if item.srs_interval_days < 1 else round(item.srs_interval_days * item.srs_ease, 2)
        item.srs_due_at = at + int(item.srs_interval_days * DAY_MS)
    else:
        item.srs_ease = max(1.3, item.srs_ease - 0.2)
        item.srs_interval_days = 0.0
        item.srs_due_at = at + RETRY_SOON_MS


def record_results(db: Session, user_id: str, document_id: str, study_set_id: Optional[str],
                   graded: List[Tuple[Dict, float]], source: str = "quiz", at: Optional[int] = None, commit: bool = True) -> None:
    """Update each question's stats and schedule with a score in 0..1."""
    at = at or now_ms()
    for q, score in graded:
        if not q or not q.get("question"):
            continue
        h = stem_hash(q)
        item = _find(db, user_id, h)
        if not item:
            add_questions(db, user_id, document_id, study_set_id, [q], source, commit=False)
            item = _find(db, user_id, h)
        score = max(0.0, min(1.0, float(score)))
        item.times_seen += 1
        item.score_sum += score
        item.times_correct += 1 if score >= 0.999 else 0
        item.last_seen_at = at
        item.last_correct = score >= 0.999
        _schedule(item, score, at)
    if commit:
        db.commit()


def topic_accuracy(db: Session, document_id: str, user_id: Optional[str] = None) -> Dict[str, Dict]:
    """{topic_lower: {topic, correct, total, score, last}} from every answered bank question."""
    query = db.query(QuestionBankItem).filter(QuestionBankItem.document_id == document_id, QuestionBankItem.times_seen > 0)
    if user_id:
        query = query.filter(QuestionBankItem.user_id == user_id)
    stats: Dict[str, Dict] = {}
    for item in query.all():
        key = item.topic.lower()
        e = stats.setdefault(key, {"topic": item.topic, "correct": 0, "total": 0, "score": 0.0, "last": 0})
        e["total"] += item.times_seen
        e["correct"] += item.times_correct
        e["score"] += item.score_sum
        e["last"] = max(e["last"], item.last_seen_at or 0)
    return stats


def pick_questions(db: Session, user_id: str, document_id: Optional[str], source: str, count: int,
                   weak_topics: Optional[List[str]] = None) -> List[Tuple[str, Dict]]:
    """Questions for an instant quiz: due for review, previously missed, weak topics, or random."""
    query = db.query(QuestionBankItem).filter(QuestionBankItem.user_id == user_id)
    if document_id:
        query = query.filter(QuestionBankItem.document_id == document_id)
    # Exam written questions don't suit a quick quiz
    items = [i for i in query.all() if i.type not in ("short", "long")]
    now = now_ms()
    if source == "due":
        pool = sorted([i for i in items if i.srs_due_at and i.srs_due_at <= now], key=lambda i: i.srs_due_at)
    elif source == "missed":
        pool = sorted([i for i in items if i.last_correct is False], key=lambda i: -(i.last_seen_at or 0))
    elif source == "weak":
        wanted = {t.lower() for t in (weak_topics or [])}
        pool = [i for i in items if i.topic.lower() in wanted]
        random.shuffle(pool)
    else:
        pool = list(items)
        random.shuffle(pool)
    out = []
    for item in pool[:count]:
        q = json.loads(item.question)
        for key in ("section_id", "label", "parent_id", "parent_stem"):
            q.pop(key, None)
        if q.get("type") == "mcq":
            q.pop("marks", None)
        out.append((item.document_id, q))
    return out


def due_count(db: Session, user_id: str) -> Dict[str, int]:
    items = db.query(QuestionBankItem).filter(QuestionBankItem.user_id == user_id).all()
    now = now_ms()
    return {
        "total": len(items),
        "due": sum(1 for i in items if i.srs_due_at and i.srs_due_at <= now and i.type not in ("short", "long")),
        "missed": sum(1 for i in items if i.last_correct is False),
        "answered": sum(1 for i in items if i.times_seen),
    }


def backfill(db: Session) -> int:
    """
    One-time import of existing quizzes, attempts and exams into the bank (idempotent: sets already
    imported are skipped). Returns how many sets were imported.
    """
    seen_sets = {sid for (sid,) in db.query(QuestionBankItem.study_set_id).distinct().all() if sid}
    imported = 0
    for study_set in db.query(StudySet).filter(StudySet.kind.in_(["quiz", "exam"])).all():
        if study_set.id in seen_sets or not study_set.user_id:
            continue
        # Sets made by the new engine (incl. instant bank quizzes and variants) are recorded live
        try:
            if json.loads(study_set.config or "{}").get("schema") == 2:
                continue
        except ValueError:
            pass
        try:
            data = json.loads(study_set.data)
        except ValueError:
            continue
        questions = upgrade_quiz(data) if study_set.kind == "quiz" else upgrade_exam(data)["questions"]
        if not questions:
            continue
        add_questions(db, study_set.user_id, study_set.document_id, study_set.id, questions, study_set.kind, commit=False)
        if study_set.kind == "quiz":
            by_id = {q["id"]: q for q in questions}
            attempts = (db.query(StudyActivity).filter(StudyActivity.study_set_id == study_set.id, StudyActivity.kind == "quiz")
                        .order_by(StudyActivity.created_at).all())
            for a in attempts:
                details = json.loads(a.details or "{}")
                if details.get("v") == 2:
                    graded = [(by_id.get(r.get("qid")), r.get("score", 0)) for r in details.get("results", [])]
                else:
                    graded = [(q, 1.0 if ans == q.get("correct_answer_index") else 0.0)
                              for q, ans in zip(questions, details.get("answers", []))]
                record_results(db, study_set.user_id, study_set.document_id, study_set.id,
                               [(q, s) for q, s in graded if q], "quiz", at=a.created_at, commit=False)
        else:
            from models import ExamAttempt
            by_id = {q["id"]: q for q in questions}
            for a in db.query(ExamAttempt).filter(ExamAttempt.study_set_id == study_set.id, ExamAttempt.status == "graded").all():
                grading = json.loads(a.grading or "{}")
                graded = [(by_id.get(qid), g.get("awarded_marks", 0) / max(1.0, g.get("max_marks", 1))) for qid, g in grading.items()]
                record_results(db, study_set.user_id, study_set.document_id, study_set.id,
                               [(q, s) for q, s in graded if q], "exam", at=a.submitted_at, commit=False)
        imported += 1
    db.commit()
    return imported
