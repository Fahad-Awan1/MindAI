"""
Validate and clean AI-generated questions.

Every question passes through `clean_question` before it is accepted: type-specific checks,
option shuffling (so the right answer isn't always in the same position), source resolution
and field limits. Invalid questions return None with a reason, and the generator asks for more.
"""
import math
import random
import re
from typing import Any, Dict, List, Optional, Tuple

from services.assessment.normalize import jaccard, parse_number, stem_tokens
from services.assessment.schema import BLANK, BLOOM_LEVELS, DIFFICULTIES, new_id

MAX_STEM = 800
MAX_OPTION = 240
MAX_EXPLANATION = 1200
DUPLICATE_SIMILARITY = 0.8


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit].strip() if not isinstance(value, (list, dict)) else ""


def _multiline(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit] if not isinstance(value, (list, dict)) else ""


def _str_list(value: Any, limit: int, max_items: int) -> List[str]:
    if not isinstance(value, list):
        return []
    items = [_text(v, limit) for v in value]
    return [v for v in items if v][:max_items]


def _int(value: Any) -> Optional[int]:
    try:
        if isinstance(value, bool):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _unique(items: List[str]) -> bool:
    # Light comparison (case, spacing, punctuation) - option text like "A" must survive
    keys = [" ".join("".join(ch for ch in i.lower() if ch.isalnum() or ch.isspace()).split()) or i.strip().lower() for i in items]
    return len(set(keys)) == len(keys) and all(keys)


def _shuffled_options(options: List[str], correct: List[int], rng: random.Random) -> Tuple[List[str], List[int]]:
    order = list(range(len(options)))
    rng.shuffle(order)
    new_options = [options[i] for i in order]
    new_correct = sorted(order.index(c) for c in correct)
    return new_options, new_correct


def _choice(value: Any, allowed: List[str], default: str) -> str:
    v = str(value or "").strip().lower()
    if v == "analyse":
        v = "analyze"
    return v if v in allowed else default


def clean_question(
    raw: Any,
    allowed_types: List[str],
    sources: Dict[str, Dict],
    defaults: Dict[str, Any],
    rng: Optional[random.Random] = None,
) -> Tuple[Optional[Dict], str]:
    """
    Validate one generated question. Returns (question, "") or (None, reason).

    `sources` maps the context tags shown to the model ("S3") to real passages;
    `defaults` supplies difficulty/bloom/marks/section when the model leaves them out.
    """
    rng = rng or random.Random()
    if not isinstance(raw, dict):
        return None, "not an object"
    qtype = str(raw.get("type") or defaults.get("type") or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {"multiple_choice": "mcq", "truefalse": "true_false", "tf": "true_false", "fill_in_the_blank": "fill_blank",
               "fill_in_blank": "fill_blank", "multiselect": "multi_select", "multiple_select": "multi_select",
               "short": "short" if "short" in allowed_types else "short_answer"}
    qtype = aliases.get(qtype, qtype)
    if qtype not in allowed_types:
        return None, f"type '{qtype}' not requested"

    stem = _multiline(raw.get("question") or raw.get("stem"), MAX_STEM)
    if len(stem) < 8:
        return None, "missing question text"

    q: Dict[str, Any] = {
        "id": new_id(),
        "type": qtype,
        "question": stem,
        "topic": _text(raw.get("topic"), 60) or "General",
        "difficulty": _choice(raw.get("difficulty"), DIFFICULTIES, defaults.get("difficulty", "medium")),
        "bloom": _choice(raw.get("bloom"), BLOOM_LEVELS, defaults.get("bloom", "understand")),
        "explanation": _multiline(raw.get("explanation"), MAX_EXPLANATION),
        "hint": _text(raw.get("hint"), 240),
    }

    # Source: the model cites a context tag; resolve it to the real passage
    tag = str(raw.get("source") or raw.get("source_tag") or "").strip().strip("[]")
    source = sources.get(tag) or sources.get(tag.upper())
    if source:
        q["source"] = dict(source)

    if qtype == "mcq":
        options = _str_list(raw.get("options"), MAX_OPTION, 6)
        idx = _int(raw.get("correct_answer_index", raw.get("answer_index")))
        if len(options) < 3 or idx is None or not 0 <= idx < len(options) or not _unique(options):
            return None, "bad options or answer index"
        options, correct = _shuffled_options(options, [idx], rng)
        q.update(options=options, correct_answer_index=correct[0])

    elif qtype == "multi_select":
        options = _str_list(raw.get("options"), MAX_OPTION, 6)
        raw_idx = raw.get("correct_indices")
        idxs = sorted({i for i in (_int(v) for v in raw_idx) if i is not None}) if isinstance(raw_idx, list) else []
        if len(options) < 4 or not _unique(options) or len(idxs) < 2 or len(idxs) >= len(options) \
                or any(not 0 <= i < len(options) for i in idxs):
            return None, "bad multi-select options"
        options, correct = _shuffled_options(options, idxs, rng)
        q.update(options=options, correct_indices=correct)

    elif qtype == "true_false":
        value = raw.get("correct_bool", raw.get("answer"))
        if isinstance(value, str):
            value = {"true": True, "false": False}.get(value.strip().lower())
        if not isinstance(value, bool):
            return None, "missing true/false answer"
        q.update(correct_bool=value, options=["True", "False"], correct_answer_index=0 if value else 1)

    elif qtype == "fill_blank":
        stem = stem.replace("_____", BLANK).replace("___", BLANK) if BLANK not in stem else stem
        # "The ____ makes ATP. Which organelle is this?" -> keep only the sentence with the blank
        trailing = re.match(r"^(.*" + re.escape(BLANK) + r"[^?]*?[.!])\s+[^.!?]*\?\s*$", stem, re.S)
        if trailing:
            stem = trailing.group(1)
        blanks_raw = raw.get("blanks")
        if not isinstance(blanks_raw, list):
            return None, "missing blanks"
        blanks = []
        for b in blanks_raw:
            accepted = b.get("accepted") if isinstance(b, dict) else b
            accepted = [accepted] if isinstance(accepted, str) else accepted
            values = _str_list(accepted, 80, 6)
            if not values:
                return None, "blank without accepted answers"
            blanks.append({"accepted": values})
        if not blanks or stem.count(BLANK) != len(blanks) or len(blanks) > 4:
            return None, "blank count doesn't match the stem"
        q.update(question=stem, blanks=blanks)

    elif qtype == "matching":
        left = _str_list(raw.get("left"), 160, 6)
        right = _str_list(raw.get("right"), 160, 6)
        if len(left) < 3 or len(left) != len(right) or not _unique(left) or not _unique(right):
            return None, "bad matching lists"
        # The model lists matches in the same order; shuffle the right column and record the pairs
        order = list(range(len(right)))
        rng.shuffle(order)
        shuffled = [right[i] for i in order]
        pairs = [[i, order.index(i)] for i in range(len(left))]
        q.update(left=left, right=shuffled, pairs=pairs)

    elif qtype == "ordering":
        items = _str_list(raw.get("items"), 160, 7)
        if len(items) < 3 or not _unique(items):
            return None, "bad ordering items"
        q.update(items=items)

    elif qtype == "numeric":
        answer = parse_number(raw.get("answer"))
        if answer is None or not math.isfinite(answer):
            return None, "missing numeric answer"
        tolerance = parse_number(raw.get("tolerance"))
        if tolerance is None or tolerance < 0:
            tolerance = abs(answer) * 0.01
        q.update(answer=answer, tolerance=tolerance, unit=_text(raw.get("unit"), 30))

    elif qtype == "short_answer":
        model_answer = _multiline(raw.get("model_answer") or raw.get("answer"), 600)
        if not model_answer:
            return None, "missing model answer"
        q.update(model_answer=model_answer, key_points=_str_list(raw.get("key_points"), 200, 5))

    elif qtype in ("short", "long"):
        answer_key = _multiline(raw.get("answer_key") or raw.get("model_answer"), 3000)
        if not answer_key:
            return None, "missing answer key"
        marks = _int(raw.get("marks")) or defaults.get("marks") or (3 if qtype == "short" else 10)
        marks = max(1, min(marks, 50))
        scheme = []
        for item in raw.get("marking_scheme") or []:
            if isinstance(item, dict):
                point = _text(item.get("point"), 240)
                pm = parse_number(item.get("marks"))
                if point and pm and pm > 0:
                    scheme.append({"point": point, "marks": pm})
        scheme = _rescale_scheme(scheme, marks)
        q.update(answer_key=answer_key, marks=marks, marking_scheme=scheme)

    # Exam metadata
    if defaults.get("section_id"):
        q["section_id"] = defaults["section_id"]
        if qtype == "mcq":
            q["marks"] = defaults.get("marks") or 1
    return q, ""


def _rescale_scheme(scheme: List[Dict], marks: int) -> List[Dict]:
    """Make the marking-scheme points add up to the question's marks."""
    total = sum(p["marks"] for p in scheme)
    if not scheme or total <= 0:
        return [{"point": "Correct, complete answer matching the answer key", "marks": marks}]
    if abs(total - marks) < 1e-6:
        return scheme
    factor = marks / total
    scaled = [{"point": p["point"], "marks": round(p["marks"] * factor * 2) / 2} for p in scheme]
    diff = marks - sum(p["marks"] for p in scaled)
    scaled[-1]["marks"] = round(max(0.5, scaled[-1]["marks"] + diff), 2)
    return scaled


class Deduper:
    """Rejects questions too similar to ones already accepted (or to earlier quizzes)."""

    def __init__(self, existing: List[str]):
        self.seen = [stem_tokens(s) for s in existing if s]

    def accept(self, stem: str) -> bool:
        tokens = stem_tokens(stem)
        if any(jaccard(tokens, other) >= DUPLICATE_SIMILARITY for other in self.seen):
            return False
        self.seen.append(tokens)
        return True
