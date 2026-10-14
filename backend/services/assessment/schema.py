"""
The unified question schema.

Every question is a dict with common fields:
    id, type, question, topic, difficulty, bloom, explanation, hint, source, marks
plus type-specific fields:
    mcq           options[4], correct_answer_index
    multi_select  options[4-6], correct_indices[>=2]
    true_false    correct_bool (+ options ["True","False"], correct_answer_index for older readers)
    fill_blank    blanks[{accepted:[str]}]   (the stem contains one "____" per blank)
    matching      left[], right[], pairs[[left_index, right_index]]
    ordering      items[] (stored in the correct order)
    numeric       answer, tolerance (absolute), unit
    short_answer  model_answer, key_points[]
Exam questions (types mcq / short / long) also carry answer_key, marking_scheme[{point, marks}],
section_id and optionally parent_id / parent_stem / label for sub-parts like "2(b)".

Saved quizzes from before this schema are plain MCQ dicts without id/type; upgrade_* fills those in
so old sets keep working everywhere.
"""
import uuid
from typing import Any, Dict, List

QUIZ_TYPES = ["mcq", "multi_select", "true_false", "fill_blank", "matching", "ordering", "numeric", "short_answer"]
EXAM_TYPES = ["mcq", "short", "long"]
DIFFICULTIES = ["easy", "medium", "hard"]
BLOOM_LEVELS = ["remember", "understand", "apply", "analyze", "evaluate", "create"]

# Types whose answers are checked by the AI (free text that can't be matched exactly)
AI_CHECKED_TYPES = {"short_answer", "short", "long"}

TYPE_LABELS = {
    "mcq": "Multiple choice",
    "multi_select": "Select all that apply",
    "true_false": "True / false",
    "fill_blank": "Fill in the blank",
    "matching": "Matching",
    "ordering": "Put in order",
    "numeric": "Numeric answer",
    "short_answer": "Short answer",
    "short": "Short answer",
    "long": "Long answer",
}

BLANK = "____"


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def upgrade_quiz(data: Any) -> List[Dict]:
    """Quiz data in the current schema (old sets: MCQ dicts without id/type)."""
    if not isinstance(data, list):
        return []
    questions = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        q = dict(item)
        q.setdefault("type", "mcq")
        q.setdefault("id", f"q{i}")
        questions.append(q)
    return questions


def upgrade_exam(data: Any) -> Dict:
    """Exam data in the current schema (old papers: no sections, integer ids)."""
    if not isinstance(data, dict):
        return {"version": 2, "title": "Exam", "total_marks": 0, "duration_minutes": 60, "sections": [], "questions": []}
    exam = dict(data)
    questions = []
    for i, item in enumerate(exam.get("questions") or []):
        if not isinstance(item, dict):
            continue
        q = dict(item)
        q["id"] = str(q.get("id", i + 1))
        q.setdefault("type", "short")
        q.setdefault("section_id", "A")
        q.setdefault("label", str(i + 1))
        questions.append(q)
    exam["questions"] = questions
    if not exam.get("sections"):
        exam["sections"] = [{
            "id": "A", "title": "Written questions", "kind": "short", "instructions": "Answer all questions.",
            "attempt_any": None, "question_ids": [q["id"] for q in questions],
        }]
    exam.setdefault("version", 1)
    return exam


def question_text_for_search(q: Dict) -> str:
    """A short text representing the question (for RAG lookups and dedupe)."""
    return str(q.get("question") or "")[:300]
