import json
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from models import ChatMessage, Document, StudyActivity, StudySet
from schemas import (
    DailyActivity,
    DocumentMastery,
    ProgressResponse,
    ProgressTotals,
    QuizTrendPoint,
    StudySetResponse,
    StudySetSummary,
    TopicStat,
)
from services.srs_service import due_counts

DAY_MS = 24 * 60 * 60 * 1000
ACTIVITY_DAYS = 14
QUIZ_TREND_POINTS = 12
RECENT_SETS = 6
# Mastery uses the most recent results so it reflects current knowledge
MASTERY_WINDOW = 3
# Topics answered correctly less often than this are "weak"
WEAK_TOPIC_THRESHOLD_PCT = 70
GENERAL_TOPIC = "General"


def now_ms() -> int:
    return int(time.time() * 1000)


def _to_jsonable(data: Any) -> Any:
    """Convert pydantic models (or lists of them) into plain JSON-able data."""
    if hasattr(data, "model_dump"):
        return data.model_dump()
    if isinstance(data, list):
        return [_to_jsonable(item) for item in data]
    return data


def _item_count(kind: str, data: Any) -> int:
    if kind in ("quiz", "flashcards", "study_plan"):
        return len(data) if isinstance(data, list) else 0
    if kind == "exam":
        return len(data.get("questions", [])) if isinstance(data, dict) else 0
    if kind == "mind_map":
        # Number of nodes (non-empty lines after the 'mindmap' keyword)
        return max(len([l for l in str(data).splitlines() if l.strip()]) - 1, 0)
    if kind == "teach_back":
        return 1
    if kind == "audio_overview":
        return len(data.get("lines", [])) if isinstance(data, dict) else 0
    if kind == "study_group":
        return len(data.get("transcript", [])) if isinstance(data, dict) else 0
    return 0


def _default_title(kind: str, data: Any, config: Dict) -> str:
    count = _item_count(kind, data)
    if kind == "quiz":
        return f"Quiz · {count} questions"
    if kind == "flashcards":
        return f"Flashcards · {count} cards"
    if kind == "study_plan":
        return f"{count}-day study plan"
    if kind == "exam":
        title = data.get("title") if isinstance(data, dict) else None
        return title or f"Exam · {count} questions"
    if kind == "mind_map":
        return "Mind map"
    if kind == "teach_back":
        concept = data.get("concept") if isinstance(data, dict) else None
        return f"Teach-back · {concept}" if concept else "Teach-back"
    return kind


def create_study_set(db: Session, document: Document, kind: str, data: Any, config: Optional[Dict] = None, title: Optional[str] = None) -> StudySet:
    """Persist generated study material and return the saved row."""
    payload = _to_jsonable(data)
    config = config or {}
    study_set = StudySet(
        id=uuid.uuid4().hex,
        document_id=document.id,
        user_id=document.user_id,
        kind=kind,
        title=(title or _default_title(kind, payload, config))[:200],
        data=json.dumps(payload),
        config=json.dumps(config),
        created_at=now_ms(),
    )
    db.add(study_set)
    db.commit()
    db.refresh(study_set)
    return study_set


def score_pct(correct: int, total: int) -> int:
    return round(100 * correct / total) if total else 0


def _set_stats(activities: Iterable[StudyActivity]) -> Dict[str, Optional[int]]:
    ordered = sorted(activities, key=lambda a: a.created_at)
    if not ordered:
        return {"attempts": 0, "best_score_pct": None, "last_score_pct": None, "last_activity_at": None}
    scores = [score_pct(a.correct, a.total) for a in ordered]
    return {
        "attempts": len(ordered),
        "best_score_pct": max(scores),
        "last_score_pct": scores[-1],
        "last_activity_at": ordered[-1].created_at,
    }


def to_summary(study_set: StudySet) -> StudySetSummary:
    data = json.loads(study_set.data)
    return StudySetSummary(
        id=study_set.id,
        document_id=study_set.document_id,
        document_title=study_set.document.title if study_set.document else "",
        kind=study_set.kind,
        title=study_set.title,
        config=json.loads(study_set.config or "{}"),
        item_count=_item_count(study_set.kind, data),
        created_at=study_set.created_at,
        **_set_stats(study_set.activities),
    )


def to_response(study_set: StudySet) -> StudySetResponse:
    summary = to_summary(study_set)
    return StudySetResponse(**summary.model_dump(), data=json.loads(study_set.data))


def record_activity(db: Session, study_set: StudySet, kind: str, correct: int, total: int, details: Optional[Dict] = None) -> StudyActivity:
    activity = StudyActivity(
        id=uuid.uuid4().hex,
        document_id=study_set.document_id,
        study_set_id=study_set.id,
        user_id=study_set.user_id,
        kind=kind,
        correct=correct,
        total=total,
        details=json.dumps(details or {}),
        created_at=now_ms(),
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


# ---------------------------------------------------------------------------
# Topics
# ---------------------------------------------------------------------------

def topic_stats(db: Session, document_id: str) -> List[TopicStat]:
    """
    Accuracy per topic for a document, weakest first - from every quiz, exam and room battle
    the document's owner has answered (via the question bank).
    """
    from services.assessment.bank import topic_accuracy
    owner = db.query(Document.user_id).filter(Document.id == document_id).scalar()
    stats = topic_accuracy(db, document_id, owner)
    if stats:
        result = [
            TopicStat(topic=e["topic"], correct=e["correct"], total=e["total"],
                      accuracy_pct=round(100 * e["score"] / e["total"]) if e["total"] else 0, last_seen_at=e["last"])
            for e in stats.values()
        ]
        return sorted(result, key=lambda t: (t.accuracy_pct, -t.total))
    return _topic_stats_from_attempts(db, document_id)


def _topic_stats_from_attempts(db: Session, document_id: str) -> List[TopicStat]:
    """Accuracy per quiz topic replayed from quiz attempts (used before the question bank exists)."""
    attempts = (
        db.query(StudyActivity)
        .filter(StudyActivity.document_id == document_id, StudyActivity.kind == "quiz")
        .all()
    )
    stats: Dict[str, Dict[str, Any]] = {}
    questions_by_set: Dict[str, List[Dict]] = {}
    for attempt in attempts:
        if not attempt.study_set:
            continue
        if attempt.study_set_id not in questions_by_set:
            questions_by_set[attempt.study_set_id] = json.loads(attempt.study_set.data)
        questions = questions_by_set[attempt.study_set_id]
        details = json.loads(attempt.details or "{}")
        if details.get("v") == 2:
            # Newer attempts store a graded result per question id (any question type)
            by_id = {q.get("id", f"q{i}"): q for i, q in enumerate(questions) if isinstance(q, dict)}
            outcomes = [(by_id.get(r.get("qid")), r.get("score", 0) >= 0.999) for r in details.get("results", [])]
        else:
            answers = details.get("answers", [])
            outcomes = [(q, a == q.get("correct_answer_index")) for q, a in zip(questions, answers)]
        for question, is_correct in outcomes:
            if not question:
                continue
            topic = (question.get("topic") or "").strip() or GENERAL_TOPIC
            entry = stats.setdefault(topic.lower(), {"topic": topic, "correct": 0, "total": 0, "last": 0})
            entry["total"] += 1
            entry["correct"] += 1 if is_correct else 0
            entry["last"] = max(entry["last"], attempt.created_at)

    result = [
        TopicStat(
            topic=e["topic"],
            correct=e["correct"],
            total=e["total"],
            accuracy_pct=score_pct(e["correct"], e["total"]),
            last_seen_at=e["last"],
        )
        for e in stats.values()
    ]
    return sorted(result, key=lambda t: (t.accuracy_pct, -t.total))


def weak_topics(stats: List[TopicStat]) -> List[TopicStat]:
    return [t for t in stats if t.accuracy_pct < WEAK_TOPIC_THRESHOLD_PCT]


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------

def _local_day(ts_ms: int, tz_offset_minutes: int) -> int:
    """Day number in the client's local time (tz offset as returned by JS getTimezoneOffset)."""
    return (ts_ms - tz_offset_minutes * 60 * 1000) // DAY_MS


def _day_to_iso(day: int) -> str:
    return (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=day)).strftime("%Y-%m-%d")


def _streaks(active_days: set, today: int) -> Dict[str, int]:
    # The current streak survives until the end of today even if today has no activity yet
    current = 0
    day = today if today in active_days else today - 1
    while day in active_days:
        current += 1
        day -= 1

    longest = run = 0
    previous = None
    for d in sorted(active_days):
        run = run + 1 if previous is not None and d == previous + 1 else 1
        longest = max(longest, run)
        previous = d
    return {"current": current, "longest": longest}


def _mastery(quiz_scores: List[int], card_scores: List[int]) -> Optional[int]:
    """Blend recent quiz accuracy (weighted 70%) with recent flashcard recall (30%)."""
    quiz = sum(quiz_scores[-MASTERY_WINDOW:]) / len(quiz_scores[-MASTERY_WINDOW:]) if quiz_scores else None
    cards = sum(card_scores[-MASTERY_WINDOW:]) / len(card_scores[-MASTERY_WINDOW:]) if card_scores else None
    if quiz is not None and cards is not None:
        return round(0.7 * quiz + 0.3 * cards)
    if quiz is not None:
        return round(quiz)
    if cards is not None:
        return round(cards)
    return None


XP_PER = {"quiz": 10, "exam": 6, "flashcards": 2, "teach_back": 30, "study_group": 25}


def _level_for(xp: int) -> Dict[str, int]:
    """Level n needs 100 * n^1.5 XP in total (levels get gradually longer)."""
    level = 1
    while xp >= int(100 * (level ** 1.5)):
        level += 1
    start = int(100 * ((level - 1) ** 1.5)) if level > 1 else 0
    end = int(100 * (level ** 1.5))
    return {"level": level, "level_progress_pct": round(100 * (xp - start) / max(1, end - start)), "next_level_xp": end}


def _motivation(db: Session, user_id: str, activities: List[StudyActivity], streaks: Dict[str, int]) -> Dict[str, Any]:
    """XP, level and badges, all derived from what the student has done (nothing extra is stored)."""
    from services.assessment.bank import due_count
    xp = 0
    perfect = exam_a = 0
    for a in activities:
        if a.kind == "quiz":
            xp += a.correct * XP_PER["quiz"]
            perfect += 1 if a.total >= 5 and a.correct == a.total else 0
        elif a.kind == "exam":
            xp += 50 + a.correct * XP_PER["exam"]
            exam_a += 1 if a.total and a.correct / a.total >= 0.8 else 0
        elif a.kind == "flashcards":
            xp += a.total * XP_PER["flashcards"]
        else:
            xp += XP_PER.get(a.kind, 10)
    quizzes = sum(1 for a in activities if a.kind == "quiz")
    cards = sum(a.total for a in activities if a.kind == "flashcards")
    exams = sum(1 for a in activities if a.kind == "exam")
    bank = due_count(db, user_id)
    badge_defs = [
        ("first_quiz", "First steps", "Finish your first quiz", quizzes >= 1),
        ("quiz_10", "Quiz regular", "Finish 10 quizzes", quizzes >= 10),
        ("perfect", "Flawless", "Score 100% on a quiz of 5+ questions", perfect >= 1),
        ("first_exam", "Exam ready", "Sit your first practice exam", exams >= 1),
        ("exam_a", "Top marks", "Score 80%+ on a practice exam", exam_a >= 1),
        ("streak_3", "On a roll", "Study 3 days in a row", streaks["longest"] >= 3),
        ("streak_7", "Week warrior", "Study 7 days in a row", streaks["longest"] >= 7),
        ("cards_100", "Card shark", "Review 100 flashcards", cards >= 100),
        ("bank_50", "Collector", "Build a bank of 50 questions", bank["total"] >= 50),
    ]
    return {
        "xp": xp, **_level_for(xp),
        "badges": [{"id": i, "title": t, "description": d, "earned": bool(e)} for i, t, d, e in badge_defs],
        "bank_due": bank["due"], "bank_total": bank["total"],
    }


def compute_progress(db: Session, user_id: str, tz_offset_minutes: int = 0) -> ProgressResponse:
    documents = db.query(Document).filter(Document.user_id == user_id).order_by(Document.created_at.desc()).all()
    doc_titles = {d.id: d.title for d in documents}
    activities = db.query(StudyActivity).filter(StudyActivity.user_id == user_id).order_by(StudyActivity.created_at).all()
    study_sets = db.query(StudySet).filter(StudySet.user_id == user_id).order_by(StudySet.created_at.desc()).all()
    set_titles = {s.id: s.title for s in study_sets}
    chat_timestamps = [
        ts for (ts,) in db.query(ChatMessage.timestamp).filter(ChatMessage.role == "user", ChatMessage.user_id == user_id).all()
    ]

    quizzes = [a for a in activities if a.kind == "quiz"]
    card_sessions = [a for a in activities if a.kind == "flashcards"]
    tutor_sessions = [a for a in activities if a.kind in ("exam", "teach_back", "study_group")]

    # Streaks & daily activity (local days)
    today = _local_day(now_ms(), tz_offset_minutes)
    empty_day = {"quizzes": 0, "flashcard_sessions": 0, "chat_messages": 0, "tutor_sessions": 0}
    per_day: Dict[int, Dict[str, int]] = defaultdict(lambda: dict(empty_day))
    for a in quizzes:
        per_day[_local_day(a.created_at, tz_offset_minutes)]["quizzes"] += 1
    for a in card_sessions:
        per_day[_local_day(a.created_at, tz_offset_minutes)]["flashcard_sessions"] += 1
    for ts in chat_timestamps:
        per_day[_local_day(ts, tz_offset_minutes)]["chat_messages"] += 1
    for a in tutor_sessions:
        per_day[_local_day(a.created_at, tz_offset_minutes)]["tutor_sessions"] += 1

    active_days = {day for day, counts in per_day.items() if sum(counts.values()) > 0}
    streaks = _streaks(active_days, today)

    daily_activity = []
    for day in range(today - ACTIVITY_DAYS + 1, today + 1):
        counts = per_day.get(day, empty_day)
        daily_activity.append(DailyActivity(date=_day_to_iso(day), total=sum(counts.values()), **counts))

    # Quiz accuracy trend
    quiz_trend = [
        QuizTrendPoint(
            created_at=a.created_at,
            score_pct=score_pct(a.correct, a.total),
            document_title=doc_titles.get(a.document_id, ""),
            study_set_title=set_titles.get(a.study_set_id),
        )
        for a in quizzes[-QUIZ_TREND_POINTS:]
    ]

    # Per-document mastery
    by_doc: Dict[str, Dict[str, List]] = defaultdict(lambda: {"quiz": [], "flashcards": [], "times": []})
    for a in activities:
        entry = by_doc[a.document_id]
        # Quizzes, graded exams and teach-backs are all assessments; flashcards measure recall
        entry["flashcards" if a.kind == "flashcards" else "quiz"].append(score_pct(a.correct, a.total))
        entry["times"].append(a.created_at)
    sets_per_doc: Dict[str, int] = defaultdict(int)
    for s in study_sets:
        sets_per_doc[s.document_id] += 1

    mastery = []
    for doc in documents:
        entry = by_doc.get(doc.id, {"quiz": [], "flashcards": [], "times": []})
        mastery.append(DocumentMastery(
            document_id=doc.id,
            document_title=doc.title,
            mastery_pct=_mastery(entry["quiz"], entry["flashcards"]),
            quiz_attempts=len(entry["quiz"]),
            flashcard_sessions=len(entry["flashcards"]),
            study_sets=sets_per_doc.get(doc.id, 0),
            last_studied_at=max(entry["times"]) if entry["times"] else None,
            weak_topics=weak_topics(topic_stats(db, doc.id))[:3] if entry["quiz"] else [],
        ))

    quiz_scores = [score_pct(a.correct, a.total) for a in quizzes]
    totals = ProgressTotals(
        documents=len(documents),
        study_sets=len(study_sets),
        quizzes_taken=len(quizzes),
        avg_quiz_accuracy_pct=round(sum(quiz_scores) / len(quiz_scores)) if quiz_scores else None,
        cards_reviewed=sum(a.total for a in card_sessions),
        cards_known=sum(a.correct for a in card_sessions),
        chat_questions=len(chat_timestamps),
    )

    current_ms = now_ms()
    end_of_today = (today + 1) * DAY_MS + tz_offset_minutes * 60 * 1000 - 1
    cards = due_counts(db, user_id, current_ms, end_of_today)

    motivation = _motivation(db, user_id, activities, streaks)
    return ProgressResponse(
        **motivation,
        totals=totals,
        current_streak_days=streaks["current"],
        longest_streak_days=streaks["longest"],
        studied_today=today in active_days,
        cards_due_now=cards["due_now"],
        cards_due_today=cards["due_today"],
        cards_new=cards["new"],
        daily_activity=daily_activity,
        quiz_trend=quiz_trend,
        mastery=mastery,
        recent_sets=[to_summary(s) for s in study_sets[:RECENT_SETS]],
    )


def recent_quiz_questions(db: Session, document_id: str, limit: int = 20) -> List[str]:
    """Question texts from the document's most recent quizzes (newest first)."""
    sets = (
        db.query(StudySet)
        .filter(StudySet.document_id == document_id, StudySet.kind == "quiz")
        .order_by(StudySet.created_at.desc())
        .limit(5)
        .all()
    )
    questions: List[str] = []
    for study_set in sets:
        questions.extend(q.get("question", "") for q in json.loads(study_set.data))
    return [q for q in questions if q][:limit]
