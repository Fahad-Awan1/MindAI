"""
Batched, streamed question generation for quizzes and exam papers.

A request becomes a list of "slots" (type + difficulty + Bloom level [+ marks]). Slots are generated
a few at a time from different parts of the documents, each call waits for the token budget, every
question is validated and de-duplicated, and missing slots are topped up from fresh passages - so the
user gets exactly what they asked for, streamed one question at a time.

Events yielded (dicts):
    {"type": "plan", "total": n, "batches": b}
    {"type": "progress", "batch": i, "of": b}
    {"type": "waiting", "seconds": s}             waiting for the per-minute token budget
    {"type": "question", "index": i, "question": {...}}
    {"type": "warning", "message": "..."}
"""
import asyncio
import math
import random
from typing import Any, AsyncIterator, Dict, List, Optional

from starlette.concurrency import run_in_threadpool

from models import Document
from services.assessment.budget import budget, estimate_tokens
from services.assessment.coverage import Batch, sample_batches
from services.assessment.prompts import build_generation_prompt
from services.assessment.schema import BLOOM_LEVELS, new_id
from services.assessment.validator import Deduper, clean_question
from services.groq_service import AIServiceError, _extract_list, _parse_json, complete_with_usage

QUIZ_BATCH = 5
MAX_TOP_UP_ROUNDS = 2
QUIZ_MAX_TOKENS = 2400

BLOOM_PRESETS = {
    "recall": {"remember": 5, "understand": 4, "apply": 1},
    "balanced": {"remember": 2, "understand": 3, "apply": 3, "analyze": 2},
    "higher": {"understand": 1, "apply": 3, "analyze": 3, "evaluate": 2, "create": 1},
}
DIFFICULTY_MIX = {"easy": 3, "medium": 4, "hard": 3}

# Exam section kinds -> question type, batch size, tokens per call
SECTION_KINDS = {
    "objective": {"type": "mcq", "batch": 5, "max_tokens": 2600, "marks": 1},
    "short": {"type": "short", "batch": 4, "max_tokens": 2800, "marks": 4},
    "long": {"type": "long", "batch": 2, "max_tokens": 3200, "marks": 10},
}
MINUTES_PER_MARK = {"objective": 1.2, "short": 1.8, "long": 1.8}


def _spread(weights: Dict[str, float], n: int, rng: random.Random) -> List[str]:
    """n labels in proportion to weights (largest-remainder), shuffled."""
    weights = {k: v for k, v in weights.items() if v and v > 0}
    if not weights:
        return []
    total = sum(weights.values())
    exact = {k: n * v / total for k, v in weights.items()}
    counts = {k: int(math.floor(x)) for k, x in exact.items()}
    for k in sorted(exact, key=lambda k: exact[k] - counts[k], reverse=True)[: n - sum(counts.values())]:
        counts[k] += 1
    labels = [k for k, c in counts.items() for _ in range(c)]
    rng.shuffle(labels)
    return labels


def plan_slots(count: int, types: List[str], difficulty: str, bloom: Any, rng: random.Random,
               extra: Optional[Dict] = None) -> List[Dict]:
    """One slot per question: type (evenly spread), difficulty and Bloom level."""
    types = types or ["mcq"]
    type_list = [types[i % len(types)] for i in range(count)]
    rng.shuffle(type_list)
    difficulties = _spread(DIFFICULTY_MIX, count, rng) if difficulty == "mixed" else [difficulty] * count
    bloom_weights = BLOOM_PRESETS.get(bloom) if isinstance(bloom, str) else bloom
    if not isinstance(bloom_weights, dict) or not any(v for v in bloom_weights.values() if isinstance(v, (int, float))):
        bloom_weights = BLOOM_PRESETS["balanced"]
    bloom_weights = {k: float(v) for k, v in bloom_weights.items() if k in BLOOM_LEVELS and isinstance(v, (int, float))}
    blooms = _spread(bloom_weights, count, rng) or ["understand"] * count
    return [{"type": t, "difficulty": d, "bloom": b, **(extra or {})} for t, d, b in zip(type_list, difficulties, blooms)]


async def _ask(messages: List[Dict], max_tokens: int, handle: Optional[list] = None) -> List[Any]:
    text, used = await complete_with_usage(messages, temperature=0.6, max_tokens=max_tokens, json_mode=True)
    if handle is not None:
        budget.settle(handle, used)
    return _extract_list(_parse_json(text), ["questions", "quiz", "items"])


async def generate_slots(
    documents: List[Document],
    slots: List[Dict],
    *,
    batch_size: int = QUIZ_BATCH,
    max_tokens: int = QUIZ_MAX_TOKENS,
    avoid: Optional[List[str]] = None,
    focus_topics: Optional[List[str]] = None,
    known_topics: Optional[List[str]] = None,
    sections: Optional[List[str]] = None,
    topics: Optional[List[str]] = None,
    exam_style: Optional[str] = None,
    style_notes: Optional[str] = None,
    contexts: Optional[List[Batch]] = None,
    rng: Optional[random.Random] = None,
) -> AsyncIterator[Dict]:
    """Fill every slot with a validated question, yielding events as they arrive."""
    rng = rng or random.Random()
    deduper = Deduper(list(avoid or []))
    pending = list(slots)
    accepted = 0
    failures: List[str] = []

    for round_no in range(MAX_TOP_UP_ROUNDS + 1):
        if not pending:
            break
        chunks = [pending[i:i + batch_size] for i in range(0, len(pending), batch_size)]
        if contexts is not None and round_no == 0:
            batches = [contexts[i % len(contexts)] for i in range(len(chunks))] if contexts else []
        else:
            batches = await run_in_threadpool(sample_batches, documents, len(chunks), sections, topics, round_no * 7 + rng.randint(0, 5))
        if not batches:
            raise AIServiceError("No readable text was found in the selected documents.")
        if round_no > 0:
            yield {"type": "progress", "batch": 0, "of": len(chunks), "topping_up": len(pending)}
        missing: List[Dict] = []

        for i, (chunk, batch) in enumerate(zip(chunks, batches), start=1):
            if round_no == 0:
                yield {"type": "progress", "batch": i, "of": len(chunks)}
            messages = build_generation_prompt(chunk, batch.context, avoid=(avoid or [])[:12], focus_topics=focus_topics,
                                               known_topics=known_topics, exam_style=exam_style, style_notes=style_notes)
            estimate = estimate_tokens(sum(len(m["content"]) for m in messages), max_tokens)
            wait = budget.wait_seconds(estimate)
            if wait > 0.5:
                yield {"type": "waiting", "seconds": round(wait)}
                await asyncio.sleep(wait)
            handle = budget.reserve(estimate)
            try:
                raw_items = await _ask(messages, max_tokens, handle)
            except AIServiceError as e:
                if "daily" in str(e):
                    # Retrying can't help until the daily allowance refills
                    raise
                if "rate limit" in str(e).lower():
                    yield {"type": "waiting", "seconds": 20}
                    await asyncio.sleep(20)
                failures.append(str(e))
                missing.extend(chunk)
                continue

            open_slots = list(chunk)
            for raw in raw_items:
                if not open_slots:
                    break
                if not isinstance(raw, dict):
                    failures.append("not an object")
                    continue
                want = str(raw.get("type", "")).lower()
                slot = next((s for s in open_slots if s["type"] == want), open_slots[0])
                leaves = _expand_parts(raw)
                parent_stem = leaves[0].get("_parent_stem") if leaves and leaves[0] is not raw else None
                if parent_stem is not None and not deduper.accept(parent_stem):
                    failures.append("duplicate")
                    continue
                produced = []
                for leaf_raw in leaves:
                    question, reason = clean_question(leaf_raw, [slot["type"]], batch.sources, slot, rng)
                    if not question:
                        failures.append(reason)
                        produced = []
                        break
                    if leaf_raw.get("_parent_id"):
                        question.update(parent_id=leaf_raw["_parent_id"], parent_stem=leaf_raw["_parent_stem"])
                    produced.append(question)
                if not produced:
                    continue
                if parent_stem is None and not deduper.accept(produced[0]["question"]):
                    failures.append("duplicate")
                    continue
                open_slots.remove(slot)
                for question in produced:
                    yield {"type": "question", "index": accepted, "question": question}
                    accepted += 1
            missing.extend(open_slots)
        pending = missing

    if pending:
        yield {"type": "warning", "message": f"Generated {accepted} of {accepted + len(pending)} questions - the AI kept producing questions that failed quality checks. You can add more from the editor."}
    if accepted == 0:
        detail = next((f for f in failures if "AI" in f or "busy" in f), None)
        raise AIServiceError(detail or "The AI could not produce valid questions from these documents. Please try again.")


def _expand_parts(raw: Any) -> List[Any]:
    """A structured long question with sub-parts becomes one leaf per part (sharing the scenario)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("parts"), list) or len(raw["parts"]) < 2:
        return [raw]
    parent_id = new_id()
    leaves = []
    for part in raw["parts"][:4]:
        if not isinstance(part, dict):
            continue
        leaf = dict(part)
        leaf.setdefault("type", raw.get("type", "long"))
        for key in ("topic", "difficulty", "bloom", "source"):
            leaf.setdefault(key, raw.get(key))
        leaf["_parent_id"] = parent_id
        leaf["_parent_stem"] = str(raw.get("question") or "")[:800]
        leaves.append(leaf)
    return leaves or [raw]


# ---------------------------------------------------------------------------
# Exam papers
# ---------------------------------------------------------------------------

SECTION_TITLES = {"objective": "Objective questions", "short": "Short-answer questions", "long": "Long-answer questions"}
SECTION_INSTRUCTIONS = {
    "objective": "Choose the single best answer for each question.",
    "short": "Answer in a few sentences.",
    "long": "Answer in full, structured paragraphs. Show your reasoning.",
}


def default_blueprint(num_questions: int, kind: str = "mixed") -> List[Dict]:
    """A sensible paper layout from the old simple settings."""
    n = max(1, num_questions)
    if kind == "short":
        return [{"kind": "short", "count": n, "marks_each": 4}]
    if kind == "long":
        return [{"kind": "long", "count": n, "marks_each": 10}]
    if kind == "objective":
        return [{"kind": "objective", "count": n, "marks_each": 1}]
    objective = max(1, round(n * 0.4)) if n >= 3 else 0
    long = max(1, round(n * 0.2)) if n >= 3 else 0
    short = max(1, n - objective - long)
    sections = []
    if objective:
        sections.append({"kind": "objective", "count": objective, "marks_each": 1})
    sections.append({"kind": "short", "count": short, "marks_each": 4})
    if long:
        sections.append({"kind": "long", "count": long, "marks_each": 10})
    return sections


def normalize_blueprint(sections: List[Dict]) -> List[Dict]:
    clean = []
    for i, s in enumerate(sections[:4]):
        kind = s.get("kind") if s.get("kind") in SECTION_KINDS else "short"
        count = max(1, min(int(s.get("count") or 1), 30))
        marks = max(1, min(int(s.get("marks_each") or SECTION_KINDS[kind]["marks"]), 50))
        attempt_any = s.get("attempt_any")
        attempt_any = int(attempt_any) if attempt_any and 0 < int(attempt_any) < count else None
        clean.append({
            "id": chr(ord("A") + i), "kind": kind, "count": count, "marks_each": marks, "attempt_any": attempt_any,
            "subparts": bool(s.get("subparts")) and kind == "long",
            "title": str(s.get("title") or SECTION_TITLES[kind])[:80],
        })
    return clean


def section_marks(section: Dict) -> int:
    return section["marks_each"] * (section["attempt_any"] or section["count"])


def blueprint_duration(sections: List[Dict]) -> int:
    minutes = sum(section_marks(s) * MINUTES_PER_MARK[s["kind"]] for s in sections)
    return int(max(10, math.ceil(minutes / 5) * 5))


async def generate_exam(
    documents: List[Document],
    sections: List[Dict],
    difficulty: str,
    bloom: Any,
    *,
    avoid: Optional[List[str]] = None,
    topics: Optional[List[str]] = None,
    chapter_sections: Optional[List[str]] = None,
    style_notes: Optional[str] = None,
    collected: Optional[List[Dict]] = None,
) -> AsyncIterator[Dict]:
    """Generate an exam section by section. Accepted questions are appended to `collected`."""
    rng = random.Random()
    collected = collected if collected is not None else []
    for section in sections:
        cfg = SECTION_KINDS[section["kind"]]
        slots = plan_slots(section["count"], [cfg["type"]], difficulty, bloom, rng,
                           {"marks": section["marks_each"], "section_id": section["id"]})
        yield {"type": "section", "section": section["id"], "kind": section["kind"], "count": section["count"]}
        style = "formal command words (Define, Explain, Compare, Evaluate...), marks shown"
        if section.get("subparts"):
            style += '; make each question structured: a short scenario in "question" plus "parts" (2-3 sub-questions, each with its own marks, answer_key and marking_scheme) whose marks add up to the question total'
        async for event in generate_slots(
            documents, slots, batch_size=cfg["batch"], max_tokens=cfg["max_tokens"],
            avoid=(avoid or []) + [q["question"] for q in collected], topics=topics, sections=chapter_sections,
            exam_style=style, style_notes=style_notes, rng=rng,
        ):
            if event["type"] == "question":
                q = event["question"]
                q["section_id"] = section["id"]
                collected.append(q)
            yield event


def assemble_exam(title: str, sections: List[Dict], questions: List[Dict], difficulty: str, duration_minutes: int) -> Dict:
    """The saved exam document: sections in order, numbered labels (2(a), 2(b) for sub-parts)."""
    out_sections, ordered = [], []
    number = 0
    for section in sections:
        leaves = [q for q in questions if q.get("section_id") == section["id"]]
        seen_parents: Dict[str, int] = {}
        letters: Dict[str, int] = {}
        for q in leaves:
            parent = q.get("parent_id")
            if parent:
                if parent not in seen_parents:
                    number += 1
                    seen_parents[parent] = number
                letters[parent] = letters.get(parent, 0) + 1
                q["label"] = f"{seen_parents[parent]}({chr(96 + letters[parent])})"
            else:
                number += 1
                q["label"] = str(number)
            q.setdefault("marks", section["marks_each"])
            ordered.append(q)
        actual_count = len({q.get("parent_id") or q["id"] for q in leaves})
        attempt_any = section["attempt_any"] if section["attempt_any"] and section["attempt_any"] < actual_count else None
        marks = sum(q["marks"] for q in leaves)
        if attempt_any:
            per_question = marks / max(1, actual_count)
            marks = round(per_question * attempt_any)
        instructions = SECTION_INSTRUCTIONS[section["kind"]]
        instructions = (f"Answer any {attempt_any} of the {actual_count} questions. " if attempt_any else "Answer all questions. ") + instructions
        out_sections.append({
            "id": section["id"], "title": section["title"], "kind": section["kind"], "instructions": instructions,
            "attempt_any": attempt_any, "marks": marks, "question_ids": [q["id"] for q in leaves],
        })
    total = sum(s["marks"] for s in out_sections)
    return {
        "version": 2,
        "title": title,
        "difficulty": difficulty,
        "total_marks": total,
        "duration_minutes": duration_minutes,
        "instructions": [
            "Read every question carefully before answering.",
            "The marks for each question are shown in brackets.",
            "Write clearly; credit is given for relevant points and reasoning.",
        ],
        "sections": out_sections,
        "questions": ordered,
    }
