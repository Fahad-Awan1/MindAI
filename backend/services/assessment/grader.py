"""
Grading for every question type.

Answer formats (what the player sends):
    mcq, true_false   int    chosen option index (true_false: 0 = True, 1 = False)
    multi_select      [int]  chosen option indices
    fill_blank        [str]  one entry per blank
    matching          [int]  for each left item, the chosen right index (-1 = none)
    ordering          [int]  item indices (into the correct order) in the order the student placed them
    numeric           str | number
    short_answer      str

Everything is graded deterministically except short answers that don't match the model answer
exactly - those are checked by the AI in one batched call per attempt.
"""
import json
from typing import Any, Dict, List, Optional, Tuple

from services.assessment.budget import budget, estimate_tokens
from services.assessment.normalize import normalize_text, parse_number, text_matches
from services.groq_service import AIServiceError, _extract_list, _parse_json, complete_with_usage


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None and not isinstance(value, bool) else None
    except (TypeError, ValueError):
        return None


def _int_list(value: Any) -> List[int]:
    if not isinstance(value, list):
        return []
    return [v for v in (_as_int(x) for x in value) if v is not None]


def _lis_length(seq: List[int]) -> int:
    """Length of the longest increasing subsequence (items already in the right relative order)."""
    tails: List[int] = []
    for x in seq:
        lo, hi = 0, len(tails)
        while lo < hi:
            mid = (lo + hi) // 2
            if tails[mid] < x:
                lo = mid + 1
            else:
                hi = mid
        if lo == len(tails):
            tails.append(x)
        else:
            tails[lo] = x
    return len(tails)


def is_blank(answer: Any) -> bool:
    if answer is None:
        return True
    if isinstance(answer, str):
        return not answer.strip()
    if isinstance(answer, list):
        return all(is_blank(a) or a == -1 for a in answer) if answer else True
    if isinstance(answer, int) and not isinstance(answer, bool):
        return answer < 0
    return False


def grade_item(q: Dict, answer: Any) -> Dict:
    """{"score": 0..1, "correct": bool, "needs_ai": bool} for one answer."""
    qtype = q.get("type", "mcq")
    result = {"score": 0.0, "correct": False, "needs_ai": False}
    if is_blank(answer):
        return result

    if qtype in ("mcq", "true_false"):
        chosen = _as_int(answer)
        result["score"] = 1.0 if chosen is not None and chosen == q.get("correct_answer_index") else 0.0

    elif qtype == "multi_select":
        chosen = set(_int_list(answer))
        correct = set(q.get("correct_indices") or [])
        if correct:
            hits, wrong = len(chosen & correct), len(chosen - correct)
            result["score"] = max(0.0, (hits - wrong) / len(correct))
            result["correct"] = chosen == correct

    elif qtype == "fill_blank":
        given = answer if isinstance(answer, list) else [answer]
        blanks = q.get("blanks") or []
        if blanks:
            hits = sum(
                1 for i, blank in enumerate(blanks)
                if i < len(given) and any(text_matches(str(given[i] or ""), acc) for acc in blank.get("accepted", []))
            )
            result["score"] = hits / len(blanks)

    elif qtype == "matching":
        chosen = _int_list(answer)
        pairs = q.get("pairs") or []
        if pairs:
            hits = sum(1 for li, ri in pairs if li < len(chosen) and chosen[li] == ri)
            result["score"] = hits / len(pairs)

    elif qtype == "ordering":
        order = _int_list(answer)
        n = len(q.get("items") or [])
        if n and sorted(order) == list(range(n)):
            # Partial credit: the share of items already in the right relative order
            result["score"] = 1.0 if order == list(range(n)) else round(_lis_length(order) / n, 3)

    elif qtype == "numeric":
        value = parse_number(answer)
        target = q.get("answer")
        if value is not None and isinstance(target, (int, float)):
            tolerance = float(q.get("tolerance") or 0)
            result["score"] = 1.0 if abs(value - target) <= tolerance + 1e-9 * max(1.0, abs(target)) else 0.0

    elif qtype == "short_answer":
        text = str(answer)
        if text_matches(text, q.get("model_answer", "")):
            result["score"] = 1.0
        else:
            result["needs_ai"] = True

    if qtype != "multi_select":
        result["correct"] = result["score"] >= 0.999
    return result


AI_CHECK_MAX_TOKENS = 1600


async def ai_check(items: List[Tuple[Dict, str]]) -> List[Dict]:
    """Score free-text answers against their model answers: [{"score": 0|0.5|1, "feedback": "..."}]."""
    if not items:
        return []
    payload = [
        {"n": i + 1, "question": q.get("question", "")[:400], "model_answer": q.get("model_answer", "")[:500],
         "key_points": q.get("key_points", [])[:5], "student_answer": str(a)[:800]}
        for i, (q, a) in enumerate(items)
    ]
    prompt = (
        "Mark each student answer against the model answer and key points.\n"
        "score: 1 = correct and covers the key idea(s) (wording may differ), 0.5 = partly correct, 0 = wrong or irrelevant.\n"
        "feedback: one short sentence for the student (what was right or what was missing).\n"
        'Return JSON: {"results": [{"n": 1, "score": 1, "feedback": "..."}]}\n\n'
        f"{json.dumps(payload, ensure_ascii=False)}"
    )
    messages = [
        {"role": "system", "content": "You are a fair, consistent examiner. Always respond with valid JSON."},
        {"role": "user", "content": prompt},
    ]
    estimate = estimate_tokens(len(prompt), AI_CHECK_MAX_TOKENS)
    wait = budget.wait_seconds(estimate)
    if wait > 0:
        import asyncio
        await asyncio.sleep(min(wait, 30))
    handle = budget.reserve(estimate)
    try:
        text, used = await complete_with_usage(messages, temperature=0.1, max_tokens=AI_CHECK_MAX_TOKENS, json_mode=True)
        budget.settle(handle, used)
        data = _parse_json(text)
        # A single answer sometimes comes back as one bare object instead of {"results": [...]}
        results = [data] if isinstance(data, dict) and "score" in data else _extract_list(data, ["results"])
    except AIServiceError:
        results = []
    by_n = {r.get("n"): r for r in results if isinstance(r, dict)}
    out = []
    for i, (q, a) in enumerate(items):
        r = by_n.get(i + 1)
        if r is None:
            # Fall back to keyword overlap with the key points
            words = set(normalize_text(a).split())
            points = q.get("key_points") or [q.get("model_answer", "")]
            hit = sum(1 for p in points if set(normalize_text(p).split()) & words)
            score = 1.0 if points and hit == len(points) else (0.5 if hit else 0.0)
            out.append({"score": score, "feedback": "Marked automatically by comparing with the key points."})
            continue
        try:
            score = float(r.get("score", 0))
        except (TypeError, ValueError):
            score = 0.0
        score = 1.0 if score >= 0.75 else (0.5 if score >= 0.25 else 0.0)
        out.append({"score": score, "feedback": str(r.get("feedback") or "")[:300]})
    return out


def answer_text(q: Dict) -> str:
    """The correct answer as readable text (for feedback, flashcards and exports)."""
    qtype = q.get("type", "mcq")
    options = q.get("options") or []
    if qtype in ("mcq", "true_false"):
        idx = q.get("correct_answer_index")
        return options[idx] if isinstance(idx, int) and 0 <= idx < len(options) else ""
    if qtype == "multi_select":
        return "; ".join(options[i] for i in q.get("correct_indices", []) if 0 <= i < len(options))
    if qtype == "fill_blank":
        return "; ".join((b.get("accepted") or [""])[0] for b in q.get("blanks", []))
    if qtype == "matching":
        left, right = q.get("left", []), q.get("right", [])
        return "; ".join(f"{left[li]} → {right[ri]}" for li, ri in q.get("pairs", []) if li < len(left) and ri < len(right))
    if qtype == "ordering":
        return " → ".join(q.get("items", []))
    if qtype == "numeric":
        value = q.get("answer")
        value = int(value) if isinstance(value, float) and value.is_integer() else value
        return f"{value} {q.get('unit') or ''}".strip()
    if qtype == "short_answer":
        return q.get("model_answer", "")
    return q.get("answer_key", "")
