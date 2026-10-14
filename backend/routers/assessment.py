"""
Quiz & exam generation 2.0: streamed generation across whole (or several) documents with many
question types, plus editing single questions in a saved set.
"""
import json
import random
from types import SimpleNamespace
from typing import AsyncIterator, Dict, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from database import SessionLocal, get_db
from models import StudySet, User
from services.assessment.coverage import document_outline
from services.assessment.editor import regenerate_question
from services.assessment.generator import (
    assemble_exam, blueprint_duration, default_blueprint, generate_exam, generate_slots, normalize_blueprint,
    plan_slots, section_marks,
)
from services.assessment.schema import upgrade_exam, upgrade_quiz
from services.assessment.validator import _rescale_scheme, clean_question
from services.auth_service import get_current_user, get_user_document
from services.groq_service import AIServiceError
from services.streaming import ndjson, streaming_response
from services.assessment.grader import ai_check, answer_text, grade_item
from services.assessment import bank
from services.study_service import (
    create_study_set, recent_quiz_questions, record_activity, score_pct, to_response, to_summary, topic_stats, weak_topics,
)
from routers.study_sets import to_activity_response

router = APIRouter(prefix="/api/assessment", tags=["assessment"])

QuizType = Literal["mcq", "multi_select", "true_false", "fill_blank", "matching", "ordering", "numeric", "short_answer"]
Difficulty = Literal["easy", "medium", "hard", "mixed"]
BloomSetting = Union[Literal["recall", "balanced", "higher"], Dict[str, float]]


class QuizStreamRequest(BaseModel):
    document_ids: List[str] = Field(min_length=1, max_length=5)
    count: int = Field(default=10, ge=1, le=30)
    types: List[QuizType] = Field(default_factory=lambda: ["mcq"], min_length=1)
    difficulty: Difficulty = "mixed"
    bloom: BloomSetting = "balanced"
    topics: List[str] = Field(default_factory=list, max_length=10)
    sections: List[str] = Field(default_factory=list, max_length=40)
    focus_weak_topics: bool = False
    title: Optional[str] = Field(default=None, max_length=200)


class ExamSection(BaseModel):
    kind: Literal["objective", "short", "long"]
    count: int = Field(ge=1, le=30)
    marks_each: int = Field(ge=1, le=50)
    attempt_any: Optional[int] = Field(default=None, ge=1, le=30)
    subparts: bool = False
    title: Optional[str] = Field(default=None, max_length=80)


class ExamStreamRequest(BaseModel):
    document_ids: List[str] = Field(min_length=1, max_length=5)
    sections: List[ExamSection] = Field(default_factory=list, max_length=4)
    # Simple mode (used when no sections are given)
    num_questions: int = Field(default=8, ge=1, le=30)
    layout: Literal["mixed", "objective", "short", "long"] = "mixed"
    difficulty: Difficulty = "mixed"
    bloom: BloomSetting = "balanced"
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=360)
    topics: List[str] = Field(default_factory=list, max_length=10)
    chapters: List[str] = Field(default_factory=list, max_length=40)
    title: Optional[str] = Field(default=None, max_length=200)
    style_notes: Optional[str] = Field(default=None, max_length=1500)


class RegenerateRequest(BaseModel):
    mode: Literal["same", "harder", "easier", "variant"] = "same"


class AddMoreRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=15)
    types: Optional[List[QuizType]] = None
    difficulty: Optional[Difficulty] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _snapshot(document) -> SimpleNamespace:
    """A detached copy of a document, safe to use while streaming after the request's DB session ends."""
    return SimpleNamespace(id=document.id, title=document.title, content=document.content or "",
                           file_path=document.file_path, type=document.type, user_id=document.user_id)


def _documents(db: Session, user: User, ids: List[str]) -> List[SimpleNamespace]:
    docs, seen = [], set()
    for doc_id in ids:
        if doc_id in seen:
            continue
        seen.add(doc_id)
        doc = get_user_document(db, user, doc_id)
        if not (doc.content or "").strip():
            raise HTTPException(status_code=422, detail=f'No text could be extracted from "{doc.title}".')
        docs.append(_snapshot(doc))
    return docs


def _owned_set(db: Session, user: User, set_id: str, kinds=("quiz", "exam")) -> StudySet:
    study_set = db.query(StudySet).filter(StudySet.id == set_id, StudySet.user_id == user.id).first()
    if not study_set or study_set.kind not in kinds:
        raise HTTPException(status_code=404, detail="Quiz or exam not found")
    return study_set


def _questions_of(study_set: StudySet):
    data = json.loads(study_set.data)
    if study_set.kind == "quiz":
        return data, upgrade_quiz(data)
    exam = upgrade_exam(data)
    return exam, exam["questions"]


def _save_questions(db: Session, study_set: StudySet, questions: List[Dict], exam: Optional[Dict] = None) -> None:
    if study_set.kind == "quiz":
        study_set.data = json.dumps(questions)
    else:
        exam = dict(exam or {})
        exam["questions"] = questions
        ids = {q["id"] for q in questions}
        for section in exam.get("sections", []):
            section["question_ids"] = [qid for qid in section.get("question_ids", []) if qid in ids]
        exam["total_marks"] = _exam_total(exam)
        study_set.data = json.dumps(exam)
    db.commit()


def _exam_total(exam: Dict) -> float:
    by_id = {q["id"]: q for q in exam.get("questions", [])}
    total = 0
    for section in exam.get("sections", []):
        leaves = [by_id[i] for i in section.get("question_ids", []) if i in by_id]
        marks = sum(q.get("marks", 0) for q in leaves)
        groups = len({q.get("parent_id") or q["id"] for q in leaves})
        if section.get("attempt_any") and groups:
            marks = round(marks / groups * min(section["attempt_any"], groups))
        section["marks"] = marks
        total += marks
    return total


def _doc_ids_of(study_set: StudySet) -> List[str]:
    config = json.loads(study_set.config or "{}")
    return config.get("document_ids") or [study_set.document_id]


def _focus_topics(db: Session, doc_ids: List[str]) -> List[str]:
    weak: List[str] = []
    for doc_id in doc_ids:
        weak.extend(t.topic for t in weak_topics(topic_stats(db, doc_id)))
    return list(dict.fromkeys(weak))[:4]


def _known_topics(db: Session, doc_ids: List[str]) -> List[str]:
    topics: List[str] = []
    for doc_id in doc_ids:
        topics.extend(t.topic for t in topic_stats(db, doc_id) if t.topic != "General")
    return list(dict.fromkeys(topics))[:20]


async def _guard(events: AsyncIterator[str]) -> AsyncIterator[str]:
    """Turn AI failures into an NDJSON error event instead of a broken stream."""
    try:
        async for line in events:
            yield line
    except AIServiceError as e:
        yield ndjson({"type": "error", "detail": str(e)})
    except HTTPException as e:
        yield ndjson({"type": "error", "detail": str(e.detail)})


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

@router.get("/documents/{document_id}/outline")
async def outline(document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Section / page labels of a document, for choosing what a quiz or exam covers."""
    document = get_user_document(db, user, document_id)
    return {"document_id": document.id, "sections": await run_in_threadpool(document_outline, _snapshot(document))}


@router.post("/quiz/stream")
async def quiz_stream(request: QuizStreamRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Generate a quiz question by question (NDJSON), then save it."""
    documents = _documents(db, user, request.document_ids)
    doc_ids = [d.id for d in documents]
    focus = _focus_topics(db, doc_ids) if request.focus_weak_topics else []
    if request.focus_weak_topics and not focus:
        raise HTTPException(status_code=400, detail="No weak topics yet - take a quiz first so MindAI can learn what you find hard.")
    known = _known_topics(db, doc_ids)
    avoid: List[str] = []
    for doc_id in doc_ids:
        avoid.extend(recent_quiz_questions(db, doc_id))
    types = list(dict.fromkeys(request.types)) or ["mcq"]
    slots = plan_slots(request.count, types, request.difficulty, request.bloom, random.Random())
    user_id = user.id

    async def events() -> AsyncIterator[str]:
        yield ndjson({"type": "plan", "total": request.count, "batches": -(-request.count // 5), "focus_topics": focus})
        questions: List[Dict] = []
        async for event in generate_slots(documents, slots, avoid=avoid, focus_topics=focus or None, known_topics=known,
                                          sections=request.sections or None, topics=(request.topics or focus) or None):
            if event["type"] == "question":
                questions.append(event["question"])
            yield ndjson(event)
        config = {
            "schema": 2, "count": len(questions), "types": types, "difficulty": request.difficulty,
            "bloom": request.bloom, "document_ids": doc_ids, "focus_topics": focus,
            "topics": request.topics, "sections": request.sections,
        }
        label = "Focus quiz" if focus else ("Quiz" if len(types) == 1 and types[0] == "mcq" else "Mixed quiz")
        title = request.title or f"{label} · {len(questions)} questions"
        db2 = SessionLocal()
        try:
            study_set = create_study_set(db2, SimpleNamespace(id=doc_ids[0], user_id=user_id), "quiz", questions, config, title)
            bank.add_questions(db2, user_id, doc_ids[0], study_set.id, questions, "quiz")
            yield ndjson({"type": "done", "set": to_response(study_set).model_dump()})
        finally:
            db2.close()

    return streaming_response(_guard(events()))


@router.post("/exam/stream")
async def exam_stream(request: ExamStreamRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Generate an exam paper section by section (NDJSON), then save it."""
    documents = _documents(db, user, request.document_ids)
    doc_ids = [d.id for d in documents]
    raw_sections = [s.model_dump() for s in request.sections] or default_blueprint(request.num_questions, request.layout)
    sections = normalize_blueprint(raw_sections)
    planned_marks = sum(section_marks(s) for s in sections)
    duration = request.duration_minutes or blueprint_duration(sections)
    avoid: List[str] = []
    for doc_id in doc_ids:
        avoid.extend(recent_quiz_questions(db, doc_id))
    title = request.title or (f"{documents[0].title} · Examination" if len(documents) == 1 else "Combined Examination")
    user_id = user.id

    async def events() -> AsyncIterator[str]:
        total = sum(s["count"] for s in sections)
        yield ndjson({"type": "plan", "total": total, "sections": sections, "total_marks": planned_marks, "duration_minutes": duration})
        collected: List[Dict] = []
        async for event in generate_exam(documents, sections, request.difficulty, request.bloom, avoid=avoid,
                                         topics=request.topics or None, chapter_sections=request.chapters or None,
                                         style_notes=request.style_notes, collected=collected):
            yield ndjson(event)
        exam = assemble_exam(title, sections, collected, request.difficulty, duration)
        config = {
            "schema": 2, "num_questions": len(collected), "difficulty": request.difficulty, "bloom": request.bloom,
            "document_ids": doc_ids, "sections": sections, "topics": request.topics, "chapters": request.chapters,
        }
        db2 = SessionLocal()
        try:
            study_set = create_study_set(db2, SimpleNamespace(id=doc_ids[0], user_id=user_id), "exam", exam, config, title)
            bank.add_questions(db2, user_id, doc_ids[0], study_set.id, exam["questions"], "exam")
            yield ndjson({"type": "done", "set": to_response(study_set).model_dump()})
        finally:
            db2.close()

    return streaming_response(_guard(events()))


# ---------------------------------------------------------------------------
# Editing a saved quiz / exam
# ---------------------------------------------------------------------------

@router.post("/sets/{set_id}/questions/{qid}/regenerate")
async def regenerate(set_id: str, qid: str, request: RegenerateRequest,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Replace one question with a new one (same idea), or a harder / easier / variant version."""
    study_set = _owned_set(db, user, set_id)
    container, questions = _questions_of(study_set)
    index = next((i for i, q in enumerate(questions) if q.get("id") == qid), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Question not found")
    documents = _documents(db, user, _doc_ids_of(study_set))
    others = [q.get("question", "") for i, q in enumerate(questions) if i != index]
    try:
        replacement = await regenerate_question(documents, questions[index], request.mode, others)
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    questions[index] = replacement
    if study_set.kind == "exam":
        for section in container.get("sections", []):
            section["question_ids"] = [replacement["id"] if x == qid else x for x in section.get("question_ids", [])]
    _save_questions(db, study_set, questions, container if study_set.kind == "exam" else None)
    bank.add_questions(db, user.id, study_set.document_id, study_set.id, [replacement], study_set.kind)
    return {"question": replacement, "set": to_response(study_set)}


@router.patch("/sets/{set_id}/questions/{qid}")
async def edit_question(set_id: str, qid: str, body: Dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Save a manually edited question (validated like generated ones)."""
    study_set = _owned_set(db, user, set_id)
    container, questions = _questions_of(study_set)
    index = next((i for i, q in enumerate(questions) if q.get("id") == qid), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Question not found")
    original = questions[index]
    raw = {**original, **body, "type": original.get("type", "mcq")}
    # Edited lists come back in display order: keep the author's answer positions
    defaults = {k: original.get(k) for k in ("type", "difficulty", "bloom", "marks", "section_id")}
    # Matching edits arrive with each right item next to its left item, so they are re-shuffled for display
    rng = random.Random() if raw["type"] == "matching" else _NoShuffle()
    cleaned, reason = clean_question(raw, [original.get("type", "mcq")], {}, defaults, rng)
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"That question isn't valid: {reason}.")
    cleaned["id"] = qid
    for key in ("source", "section_id", "parent_id", "parent_stem", "label"):
        if original.get(key) is not None:
            cleaned[key] = original[key]
    if cleaned.get("type") in ("short", "long"):
        cleaned["marking_scheme"] = _rescale_scheme(cleaned.get("marking_scheme") or [], cleaned["marks"])
    if study_set.kind == "exam" and cleaned.get("type") == "mcq" and body.get("marks"):
        try:
            cleaned["marks"] = max(1, min(50, int(body["marks"])))
        except (TypeError, ValueError):
            pass
    questions[index] = cleaned
    # Sub-parts share one scenario: an edited scenario applies to all of them
    stem = body.get("parent_stem")
    if isinstance(stem, str) and stem.strip() and original.get("parent_id"):
        for q in questions:
            if q.get("parent_id") == original["parent_id"]:
                q["parent_stem"] = stem.strip()[:1500]
    _save_questions(db, study_set, questions, container if study_set.kind == "exam" else None)
    bank.add_questions(db, user.id, study_set.document_id, study_set.id, [cleaned], study_set.kind)
    return {"question": cleaned, "set": to_response(study_set)}


class _NoShuffle(random.Random):
    """A Random whose shuffle leaves the order unchanged (for manual edits)."""

    def shuffle(self, x, *args, **kwargs):  # noqa: D401
        return None


@router.delete("/sets/{set_id}/questions/{qid}")
async def delete_question(set_id: str, qid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    study_set = _owned_set(db, user, set_id)
    container, questions = _questions_of(study_set)
    remaining = [q for q in questions if q.get("id") != qid]
    if len(remaining) == len(questions):
        raise HTTPException(status_code=404, detail="Question not found")
    if not remaining:
        raise HTTPException(status_code=400, detail="A quiz needs at least one question. Delete the whole quiz instead.")
    _save_questions(db, study_set, remaining, container if study_set.kind == "exam" else None)
    return to_response(study_set)


@router.post("/sets/{set_id}/questions/stream")
async def add_questions(set_id: str, request: AddMoreRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Append more questions to a saved quiz (NDJSON stream, then the updated set)."""
    study_set = _owned_set(db, user, set_id, kinds=("quiz",))
    _, questions = _questions_of(study_set)
    if len(questions) + request.count > 60:
        raise HTTPException(status_code=400, detail="A quiz can hold at most 60 questions.")
    config = json.loads(study_set.config or "{}")
    documents = _documents(db, user, _doc_ids_of(study_set))
    types = request.types or config.get("types") or ["mcq"]
    slots = plan_slots(request.count, types, request.difficulty or config.get("difficulty") or "mixed",
                       config.get("bloom") or "balanced", random.Random())
    avoid = [q.get("question", "") for q in questions]
    set_id_ = study_set.id

    async def events() -> AsyncIterator[str]:
        added: List[Dict] = []
        async for event in generate_slots(documents, slots, avoid=avoid, topics=config.get("topics") or None,
                                          sections=config.get("sections") or None):
            if event["type"] == "question":
                added.append(event["question"])
            yield ndjson(event)
        db2 = SessionLocal()
        try:
            fresh = db2.query(StudySet).filter(StudySet.id == set_id_).first()
            current = upgrade_quiz(json.loads(fresh.data))
            fresh.data = json.dumps(current + added)
            cfg = json.loads(fresh.config or "{}")
            cfg["count"] = len(current) + len(added)
            fresh.config = json.dumps(cfg)
            db2.commit()
            bank.add_questions(db2, fresh.user_id, fresh.document_id, fresh.id, added, "quiz")
            db2.refresh(fresh)
            yield ndjson({"type": "done", "set": to_response(fresh).model_dump()})
        finally:
            db2.close()

    return streaming_response(_guard(events()))


# ---------------------------------------------------------------------------
# Taking a quiz (any question type)
# ---------------------------------------------------------------------------

AnswerValue = Optional[Union[int, float, str, List[Optional[Union[int, str]]]]]


class QuizResponseItem(BaseModel):
    qid: str
    answer: AnswerValue = None
    time_ms: int = Field(default=0, ge=0, le=24 * 3600 * 1000)
    confidence: Optional[int] = Field(default=None, ge=1, le=3)
    flagged: bool = False
    hints_used: int = Field(default=0, ge=0, le=5)
    fifty_fifty: bool = False


class QuizAttemptV2Request(BaseModel):
    mode: Literal["practice", "test", "adaptive", "speed", "survival", "review"] = "test"
    responses: List[QuizResponseItem] = Field(min_length=1, max_length=100)
    duration_ms: int = Field(default=0, ge=0)


class CheckRequest(BaseModel):
    set_id: str
    qid: str
    answer: AnswerValue = None


class QuestionIdsRequest(BaseModel):
    qids: List[str] = Field(min_length=1, max_length=60)


def _breakdown(results: List[Dict], questions: Dict[str, Dict], key: str) -> List[Dict]:
    """Score per topic / Bloom level / type / difficulty, weakest first."""
    groups: Dict[str, Dict] = {}
    for r in results:
        q = questions.get(r["qid"]) or {}
        label = str(q.get(key) or ("General" if key == "topic" else "")).strip()
        if not label:
            continue
        g = groups.setdefault(label.lower(), {"label": label, "score": 0.0, "total": 0, "correct": 0})
        g["total"] += 1
        g["score"] += r["score"]
        g["correct"] += 1 if r["correct"] else 0
    out = [{**g, "score": round(g["score"], 2), "pct": round(100 * g["score"] / g["total"]) if g["total"] else 0}
           for g in groups.values()]
    return sorted(out, key=lambda g: g["pct"])


async def _grade_all(questions_by_id: Dict[str, Dict], responses: List[Dict]) -> List[Dict]:
    """Grade answers; free-text answers that need judgement go to the AI in one batch."""
    results, ai_items = [], []
    for item in responses:
        q = questions_by_id.get(item["qid"])
        if not q:
            continue
        r = grade_item(q, item.get("answer"))
        result = {"qid": item["qid"], "score": round(r["score"], 3), "correct": r["correct"], "feedback": "",
                  "expected": answer_text(q)}
        if r["needs_ai"]:
            ai_items.append((len(results), q, str(item.get("answer") or "")))
        results.append(result)
    if ai_items:
        checked = await ai_check([(q, a) for _, q, a in ai_items])
        for (idx, _, _), outcome in zip(ai_items, checked):
            results[idx]["score"] = outcome["score"]
            results[idx]["correct"] = outcome["score"] >= 0.999
            results[idx]["feedback"] = outcome["feedback"]
    return results


@router.post("/sets/{set_id}/attempts")
async def submit_attempt(set_id: str, request: QuizAttemptV2Request,
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Grade a quiz attempt (all question types, any subset of the questions) and record it."""
    study_set = _owned_set(db, user, set_id, kinds=("quiz",))
    _, questions = _questions_of(study_set)
    by_id = {q["id"]: q for q in questions}
    responses = [r.model_dump() for r in request.responses if r.qid in by_id]
    if not responses:
        raise HTTPException(status_code=400, detail="None of these answers belong to this quiz.")
    previous = [a for a in study_set.activities if a.kind == "quiz"]
    previous_best = max((score_pct(a.correct, a.total) for a in previous), default=None)
    results = await _grade_all(by_id, responses)
    total_score = sum(r["score"] for r in results)
    bank.record_results(db, user.id, study_set.document_id, study_set.id,
                        [(by_id[r["qid"]], r["score"]) for r in results], "quiz", commit=False)
    activity = record_activity(
        db, study_set, "quiz", round(total_score), len(results),
        details={"v": 2, "mode": request.mode, "responses": responses, "results": results,
                 "duration_ms": request.duration_ms},
    )
    return {
        "activity": to_activity_response(activity),
        "results": results,
        "score": round(total_score, 2),
        "total": len(results),
        "score_pct": round(100 * total_score / len(results)) if results else 0,
        "previous_best_pct": previous_best,
        "by_topic": _breakdown(results, by_id, "topic"),
        "by_bloom": _breakdown(results, by_id, "bloom"),
        "by_type": _breakdown(results, by_id, "type"),
        "by_difficulty": _breakdown(results, by_id, "difficulty"),
    }


@router.post("/check")
async def check_answer(request: CheckRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Grade one answer immediately (practice mode), including AI-checked short answers."""
    study_set = _owned_set(db, user, request.set_id, kinds=("quiz",))
    _, questions = _questions_of(study_set)
    by_id = {q["id"]: q for q in questions}
    if request.qid not in by_id:
        raise HTTPException(status_code=404, detail="Question not found")
    return (await _grade_all(by_id, [{"qid": request.qid, "answer": request.answer}]))[0]


@router.get("/sets/{set_id}/attempts")
async def list_attempts(set_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Past attempts of a quiz with their answers and results (newest first)."""
    study_set = _owned_set(db, user, set_id, kinds=("quiz",))
    attempts = sorted((a for a in study_set.activities if a.kind == "quiz"), key=lambda a: a.created_at, reverse=True)
    out = []
    for a in attempts:
        details = json.loads(a.details or "{}")
        out.append({
            "id": a.id, "created_at": a.created_at, "correct": a.correct, "total": a.total,
            "score_pct": score_pct(a.correct, a.total), "mode": details.get("mode", "test"),
            "duration_ms": details.get("duration_ms"), "results": details.get("results"),
            "responses": details.get("responses"), "answers": details.get("answers"),
        })
    return out


@router.post("/sets/{set_id}/variant/stream")
async def variant_quiz(set_id: str, request: QuestionIdsRequest,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """A fresh quiz with a new question on the same concept for each chosen (usually missed) question."""
    study_set = _owned_set(db, user, set_id, kinds=("quiz",))
    _, questions = _questions_of(study_set)
    wanted = set(request.qids)
    chosen = [q for q in questions if q["id"] in wanted]
    if not chosen:
        raise HTTPException(status_code=400, detail="Choose at least one question.")
    documents = _documents(db, user, _doc_ids_of(study_set))
    config = json.loads(study_set.config or "{}")
    title = f"Variant · {study_set.title}"[:200]
    doc_id, user_id = study_set.document_id, user.id
    avoid = [q.get("question", "") for q in questions]

    async def events() -> AsyncIterator[str]:
        yield ndjson({"type": "plan", "total": len(chosen), "batches": len(chosen)})
        made: List[Dict] = []
        for i, original in enumerate(chosen, start=1):
            yield ndjson({"type": "progress", "batch": i, "of": len(chosen)})
            try:
                q = await regenerate_question(documents, original, "variant", avoid + [m["question"] for m in made])
            except AIServiceError as e:
                yield ndjson({"type": "warning", "message": str(e)})
                continue
            made.append(q)
            yield ndjson({"type": "question", "index": len(made) - 1, "question": q})
        if not made:
            raise AIServiceError("Couldn't create any variant questions. Please try again.")
        db2 = SessionLocal()
        try:
            new_config = {**config, "schema": 2, "count": len(made), "variant_of": set_id}
            new_set = create_study_set(db2, SimpleNamespace(id=doc_id, user_id=user_id), "quiz", made, new_config, title)
            bank.add_questions(db2, user_id, doc_id, new_set.id, made, "quiz")
            yield ndjson({"type": "done", "set": to_response(new_set).model_dump()})
        finally:
            db2.close()

    return streaming_response(_guard(events()))


def _flashcard_front(q: Dict) -> str:
    qtype = q.get("type", "mcq")
    stem = q.get("question", "")
    if qtype in ("mcq", "multi_select"):
        return stem + "\n\n" + "\n".join(f"- {o}" for o in q.get("options", []))
    if qtype == "true_false":
        return f"True or false: {stem}"
    if qtype == "matching":
        return stem + "\n\n" + "\n".join(f"- {o}" for o in q.get("left", []))
    if qtype == "ordering":
        return stem + "\n\n" + "\n".join(f"- {o}" for o in sorted(q.get("items", [])))
    return stem


@router.post("/sets/{set_id}/to-flashcards")
async def to_flashcards(set_id: str, request: QuestionIdsRequest,
                        user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Turn chosen (usually missed) questions into a flashcard deck, so spaced repetition brings them back."""
    study_set = _owned_set(db, user, set_id)
    _, questions = _questions_of(study_set)
    wanted = set(request.qids)
    chosen = [q for q in questions if q["id"] in wanted]
    if not chosen:
        raise HTTPException(status_code=400, detail="Choose at least one question.")
    cards = []
    for q in chosen:
        back = answer_text(q)
        if q.get("explanation"):
            back = f"{back}\n\n{q['explanation']}" if back else q["explanation"]
        source = q.get("source") or {}
        if source.get("location"):
            back += f"\n\n(Source: {' · '.join(x for x in [source.get('document_title'), source.get('location')] if x)})"
        cards.append({"front": _flashcard_front(q)[:1500], "back": back[:2000]})
    title = f"Missed · {study_set.title}"[:200]
    # Add to this quiz's existing "missed" deck if there is one
    existing = db.query(StudySet).filter(StudySet.user_id == user.id, StudySet.kind == "flashcards",
                                         StudySet.title == title).first()
    if existing:
        current = json.loads(existing.data)
        fronts = {c["front"] for c in current}
        existing.data = json.dumps(current + [c for c in cards if c["front"] not in fronts])
        db.commit()
        db.refresh(existing)
        return to_summary(existing)
    deck = create_study_set(db, SimpleNamespace(id=study_set.document_id, user_id=user.id), "flashcards", cards,
                            {"count": len(cards), "from_quiz": set_id}, title)
    return to_summary(deck)


class SetMetaUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=360)
    instructions: Optional[List[str]] = Field(default=None, max_length=12)
    sections: Optional[List[Dict]] = Field(default=None, max_length=4)
    # University-style paper header: logo, institution, campus, department, details table, exam name
    header: Optional[Dict] = None


MAX_LOGO_CHARS = 400_000  # ~300 KB image as a data URL


def _clean_header(raw: Dict) -> Dict:
    def text(key: str, limit: int = 200) -> str:
        return str(raw.get(key) or "").strip()[:limit]
    logo = raw.get("logo")
    if not (isinstance(logo, str) and logo.startswith("data:image/") and len(logo) <= MAX_LOGO_CHARS):
        logo = None
    fields = []
    for f in (raw.get("fields") or [])[:24]:
        if isinstance(f, dict) and str(f.get("label") or "").strip():
            item = {"label": str(f["label"]).strip()[:60], "value": str(f.get("value") or "").strip()[:120]}
            if f.get("auto") in ("duration", "marks"):
                item["auto"] = f["auto"]
            fields.append(item)
    return {"logo": logo, "institution": text("institution"), "campus": text("campus"), "department": text("department"),
            "exam_name": text("exam_name"), "fields": fields,
            "show_logo": bool(raw.get("show_logo", True))}


@router.patch("/sets/{set_id}/meta")
async def update_meta(set_id: str, request: SetMetaUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Edit a quiz's title, or an exam paper's title, time allowed, instructions and section headings."""
    study_set = _owned_set(db, user, set_id)
    if request.title:
        study_set.title = request.title.strip()
    if study_set.kind == "exam":
        from routers.exams import active_attempt
        if active_attempt(db, user.id, set_id):
            raise HTTPException(status_code=409, detail="Finish or submit the exam you're sitting before editing the paper.")
        exam, questions = _questions_of(study_set)
        if request.title:
            exam["title"] = request.title.strip()
        if request.duration_minutes:
            exam["duration_minutes"] = request.duration_minutes
        if request.instructions is not None:
            exam["instructions"] = [str(i).strip()[:300] for i in request.instructions if str(i).strip()][:12]
        if request.header is not None:
            exam["header"] = _clean_header(request.header)
        for patch in request.sections or []:
            section = next((x for x in exam.get("sections", []) if x["id"] == patch.get("id")), None)
            if not section:
                continue
            if str(patch.get("title") or "").strip():
                section["title"] = str(patch["title"]).strip()[:80]
            if patch.get("instructions") is not None:
                section["instructions"] = str(patch["instructions"]).strip()[:400]
            if "attempt_any" in patch:
                groups = len({(next((q for q in questions if q["id"] == i), {}) or {}).get("parent_id") or i for i in section["question_ids"]})
                try:
                    n = int(patch["attempt_any"] or 0)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=422, detail="'Attempt any' must be a number.")
                section["attempt_any"] = n if 0 < n < groups else None
        _save_questions(db, study_set, questions, exam)
    else:
        db.commit()
    db.refresh(study_set)
    return to_response(study_set)
