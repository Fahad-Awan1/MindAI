"""
Marking exam papers.

Objective questions are marked instantly. Written answers are marked against each question's marking
scheme AND the relevant passages of the document (so a correct point the answer key didn't list still
earns credit), a few questions per AI call so the per-minute token budget is respected. Results stream
question by question.

"Answer any N" sections count the student's best N questions.
"""
import asyncio
import json
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from starlette.concurrency import run_in_threadpool

from services.assessment.budget import budget, estimate_tokens
from services.groq_service import AIServiceError, _extract_list, _parse_json, complete_with_usage
from services.rag_service import rag_service

SHORT_BATCH = 3
LONG_BATCH = 1
CONTEXT_CHARS = 1200
MAX_ANSWER_CHARS = 5000

GRADE_BOUNDARIES = [(90, "A*"), (80, "A"), (70, "B"), (60, "C"), (50, "D"), (40, "E")]


def grade_letter(pct: float) -> str:
    for cutoff, letter in GRADE_BOUNDARIES:
        if pct >= cutoff:
            return letter
    return "U"


def _blank(answer: Any) -> bool:
    if answer is None:
        return True
    if isinstance(answer, str):
        return not answer.strip()
    if isinstance(answer, (int, float)) and not isinstance(answer, bool):
        return answer < 0
    return False


def mark_objective(q: Dict, answer: Any) -> Dict:
    marks = float(q.get("marks") or 1)
    try:
        chosen = int(answer)
    except (TypeError, ValueError):
        chosen = -1
    right = chosen == q.get("correct_answer_index")
    options = q.get("options") or []
    correct_text = options[q["correct_answer_index"]] if isinstance(q.get("correct_answer_index"), int) and q["correct_answer_index"] < len(options) else ""
    return {
        "awarded_marks": marks if right else 0.0,
        "max_marks": marks,
        "feedback": "Correct." if right else (f"The answer is: {correct_text}." if chosen >= 0 else "Not answered."),
        "missing_points": [],
        "points": [],
    }


def _passages(q: Dict, doc_ids: List[str]) -> str:
    query = f"{q.get('parent_stem', '')} {q.get('question', '')} {q.get('answer_key', '')}"[:600]
    chunks = rag_service.search(query, doc_ids, top_k=2)
    text = "\n---\n".join(c["text"] for c in chunks if c.get("text"))
    return text[:CONTEXT_CHARS]


def _marking_prompt(items: List[Tuple[Dict, str, str]], remark_reason: Optional[str] = None) -> List[Dict]:
    payload = []
    for q, answer, context in items:
        payload.append({
            "id": q["id"],
            "question": (f"{q['parent_stem']}\n" if q.get("parent_stem") else "") + q.get("question", ""),
            "max_marks": q.get("marks", 1),
            "marking_scheme": q.get("marking_scheme") or [],
            "answer_key": q.get("answer_key", "")[:1500],
            "document_extract": context,
            "student_answer": answer[:MAX_ANSWER_CHARS],
        })
    instructions = [
        "You are an experienced, fair examiner marking a student's written exam answers.",
        "For each answer: award marks per marking-scheme point (partial marks in 0.5 steps are fine),",
        "using the answer key AND the document extract - give credit for correct points phrased differently,",
        "and for correct relevant points supported by the document even if the key doesn't list them,",
        "but never exceed max_marks. Give no credit for irrelevant or incorrect content.",
        "Return JSON: {\"results\": [{\"id\": \"...\", \"points\": [{\"point\": \"...\", \"awarded\": n, \"evidence\": \"short quote or reason\"}],",
        "\"awarded_marks\": n, \"feedback\": \"2-3 sentences: what was good, what to add\", \"missing_points\": [\"...\"]}]}",
    ]
    if remark_reason:
        instructions.append(
            "This is a RE-MARK requested by the student, who argues: " + remark_reason[:800]
            + " Reconsider carefully and fairly; change the mark only if the argument is justified by the answer itself."
        )
    return [
        {"role": "system", "content": "You are a fair, consistent examiner. Always respond with valid JSON."},
        {"role": "user", "content": "\n".join(instructions) + "\n\n" + json.dumps(payload, ensure_ascii=False)},
    ]


def _clean_result(q: Dict, raw: Optional[Dict]) -> Dict:
    max_marks = float(q.get("marks") or 1)
    if not isinstance(raw, dict):
        return {"awarded_marks": 0.0, "max_marks": max_marks, "feedback": "This answer could not be marked automatically - try a re-mark.",
                "missing_points": [], "points": [], "error": True}
    try:
        awarded = float(raw.get("awarded_marks", 0))
    except (TypeError, ValueError):
        awarded = 0.0
    awarded = max(0.0, min(max_marks, round(awarded * 2) / 2))
    points = []
    for p in raw.get("points") or []:
        if isinstance(p, dict) and p.get("point"):
            try:
                pa = float(p.get("awarded", 0))
            except (TypeError, ValueError):
                pa = 0.0
            points.append({"point": str(p["point"])[:240], "awarded": max(0.0, pa), "evidence": str(p.get("evidence") or "")[:240]})
    missing = [str(m)[:240] for m in (raw.get("missing_points") or []) if m][:6]
    return {"awarded_marks": awarded, "max_marks": max_marks, "feedback": str(raw.get("feedback") or "")[:800],
            "missing_points": missing, "points": points}


async def _mark_written(items: List[Tuple[Dict, str]], doc_ids: List[str], remark_reason: Optional[str] = None,
                        on_wait=None) -> Dict[str, Dict]:
    contexts = await run_in_threadpool(lambda: [_passages(q, doc_ids) for q, _ in items])
    messages = _marking_prompt([(q, a, c) for (q, a), c in zip(items, contexts)], remark_reason)
    max_tokens = 1200 + (1600 if items[0][0].get("type") == "long" else 900) * len(items)
    estimate = estimate_tokens(len(messages[1]["content"]), max_tokens)
    wait = budget.wait_seconds(estimate)
    if wait > 0.5:
        if on_wait:
            await on_wait(wait)
        await asyncio.sleep(wait)
    handle = budget.reserve(estimate)
    results: List[Any] = []
    failure: Optional[str] = None
    for attempt in range(2):
        try:
            text, used = await complete_with_usage(messages, temperature=0.1, max_tokens=max_tokens, json_mode=True)
            budget.settle(handle, used)
            data = _parse_json(text)
            # Usually {"results": [...]}, but a single answer sometimes comes back as one bare object
            if isinstance(data, dict) and "awarded_marks" in data:
                results = [data]
            elif isinstance(data, dict) and isinstance(data.get("results") or data.get("questions"), list):
                results = data.get("results") or data.get("questions")
            elif isinstance(data, list):
                results = data
            else:
                results = _extract_list(data, ["results", "questions"])
            results = [r for r in results if isinstance(r, dict) and ("awarded_marks" in r or "points" in r)]
            break
        except AIServiceError as e:
            print(f"Exam marking call failed (attempt {attempt + 1}): {e}")
            failure = str(e)
            if "daily" in str(e):
                break
            if attempt == 0:
                # Usually the per-minute limit: wait for the window to clear, then try once more
                if on_wait:
                    await on_wait(25)
                await asyncio.sleep(25)
    by_id = {str(r.get("id")): r for r in results if isinstance(r, dict)}
    out = {q["id"]: _clean_result(q, by_id.get(q["id"]) or (results[i] if len(results) == len(items) and isinstance(results[i], dict) else None))
           for i, (q, _) in enumerate(items)}
    if failure and not results:
        for result in out.values():
            result["feedback"] = f"Not marked yet - {failure} Use \"I deserve more marks\" to have it marked later."
    return out


async def mark_exam(exam: Dict, answers: Dict[str, Any], doc_ids: List[str]) -> AsyncIterator[Dict]:
    """Yield {"type": "graded", "qid", "result"} per question (and "waiting" events)."""
    questions = exam.get("questions") or []
    written_short: List[Tuple[Dict, str]] = []
    written_long: List[Tuple[Dict, str]] = []
    for q in questions:
        answer = answers.get(q["id"])
        if q.get("type") == "mcq":
            yield {"type": "graded", "qid": q["id"], "result": mark_objective(q, answer)}
        elif _blank(answer):
            yield {"type": "graded", "qid": q["id"], "result": {
                "awarded_marks": 0.0, "max_marks": float(q.get("marks") or 1), "feedback": "Not answered.",
                "missing_points": [p["point"] for p in (q.get("marking_scheme") or [])][:6], "points": []}}
        elif q.get("type") == "long":
            written_long.append((q, str(answer)))
        else:
            written_short.append((q, str(answer)))

    batches = [written_short[i:i + SHORT_BATCH] for i in range(0, len(written_short), SHORT_BATCH)]
    batches += [written_long[i:i + LONG_BATCH] for i in range(0, len(written_long), LONG_BATCH)]
    waits: List[float] = []

    async def note_wait(seconds: float):
        waits.append(seconds)

    for batch in batches:
        for q, _ in batch:
            yield {"type": "grading", "qid": q["id"]}
        task = asyncio.ensure_future(_mark_written(batch, doc_ids, on_wait=note_wait))
        while not task.done():
            await asyncio.sleep(0.3)
            if waits:
                yield {"type": "waiting", "seconds": round(waits.pop())}
        for qid, result in task.result().items():
            yield {"type": "graded", "qid": qid, "result": result}


async def remark_question(q: Dict, answer: str, reason: str, doc_ids: List[str]) -> Dict:
    results = await _mark_written([(q, answer)], doc_ids, remark_reason=reason)
    return results[q["id"]]


def compute_totals(exam: Dict, grading: Dict[str, Dict]) -> Dict:
    """Section totals, honouring 'answer any N' (best N question groups count)."""
    by_id = {q["id"]: q for q in exam.get("questions", [])}
    sections_out = []
    total_awarded = total_max = 0.0
    for section in exam.get("sections", []):
        groups: Dict[str, Dict[str, float]] = {}
        for qid in section.get("question_ids", []):
            q = by_id.get(qid)
            if not q:
                continue
            key = q.get("parent_id") or qid
            g = groups.setdefault(key, {"awarded": 0.0, "max": 0.0})
            g["awarded"] += float(grading.get(qid, {}).get("awarded_marks", 0))
            g["max"] += float(q.get("marks") or 0)
        values = list(groups.values())
        n = section.get("attempt_any")
        if n and n < len(values):
            counted = sorted(values, key=lambda g: g["awarded"], reverse=True)[:n]
            max_marks = sum(sorted((g["max"] for g in values), reverse=True)[:n])
        else:
            counted = values
            max_marks = sum(g["max"] for g in values)
        awarded = sum(g["awarded"] for g in counted)
        sections_out.append({"id": section["id"], "title": section.get("title", section["id"]), "awarded": round(awarded, 1), "max": round(max_marks, 1)})
        total_awarded += awarded
        total_max += max_marks
    return {"sections": sections_out, "total_awarded": round(total_awarded, 1), "total_marks": round(total_max, 1)}


def _group_breakdown(exam: Dict, grading: Dict[str, Dict], key: str) -> List[Dict]:
    out: Dict[str, Dict] = {}
    for q in exam.get("questions", []):
        label = str(q.get(key) or ("General" if key == "topic" else "")).strip()
        if not label or q["id"] not in grading:
            continue
        g = out.setdefault(label.lower(), {"label": label, "awarded": 0.0, "max": 0.0})
        g["awarded"] += float(grading[q["id"]].get("awarded_marks", 0))
        g["max"] += float(q.get("marks") or 0)
    rows = [{**g, "awarded": round(g["awarded"], 1), "pct": round(100 * g["awarded"] / g["max"]) if g["max"] else 0} for g in out.values()]
    return sorted(rows, key=lambda r: r["pct"])


def build_report(exam: Dict, grading: Dict[str, Dict], time_spent_ms: Optional[int], mastery_pct: Optional[float]) -> Dict:
    totals = compute_totals(exam, grading)
    pct = round(100 * totals["total_awarded"] / totals["total_marks"]) if totals["total_marks"] else 0
    readiness = round(0.6 * pct + 0.4 * mastery_pct) if mastery_pct is not None else pct
    return {
        **totals,
        "pct": pct,
        "grade": grade_letter(pct),
        "by_topic": _group_breakdown(exam, grading, "topic"),
        "by_bloom": _group_breakdown(exam, grading, "bloom"),
        "time_spent_ms": time_spent_ms,
        "duration_minutes": exam.get("duration_minutes"),
        "readiness": readiness,
    }


async def next_steps(exam: Dict, grading: Dict[str, Dict], report: Dict) -> List[str]:
    """Three short, specific study actions from the weakest areas (one small AI call)."""
    weak = [r["label"] for r in report.get("by_topic", []) if r["pct"] < 70][:4]
    missing = []
    for g in grading.values():
        missing.extend(g.get("missing_points") or [])
    if not weak and not missing:
        return ["Great result - keep it fresh with a quick spaced-repetition review next week."]
    prompt = (
        "A student just sat a practice exam. Suggest exactly 3 short, specific next study steps (one sentence each).\n"
        f"Weak topics: {', '.join(weak) or 'none'}\nPoints they missed: {json.dumps(missing[:10], ensure_ascii=False)}\n"
        'Return JSON: {"steps": ["...", "...", "..."]}'
    )
    messages = [{"role": "system", "content": "You are a concise study coach. Always respond with valid JSON."},
                {"role": "user", "content": prompt}]
    estimate = estimate_tokens(len(prompt), 600)
    if budget.wait_seconds(estimate) > 20:
        return [f"Revise {t} - re-read the relevant section, then try a focus quiz." for t in (weak or ["the questions you lost marks on"])[:3]]
    handle = budget.reserve(estimate)
    try:
        text, used = await complete_with_usage(messages, temperature=0.4, max_tokens=600, json_mode=True)
        budget.settle(handle, used)
        steps = [str(s)[:220] for s in _extract_list(_parse_json(text), ["steps"]) if s][:3]
        if steps:
            return steps
    except AIServiceError:
        pass
    return [f"Revise {t} - re-read the relevant section, then try a focus quiz." for t in (weak or ["the questions you lost marks on"])[:3]]
