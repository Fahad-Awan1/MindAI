"""
Prompts for question generation. Kept compact: only the requested types' formats are included,
so each call stays small enough for the per-minute token budget.
"""
import json
from typing import Dict, List, Optional

COMMON_FIELDS = (
    '"type", "question", "topic" (1-4 word label), "difficulty" (easy|medium|hard), '
    '"bloom" (remember|understand|apply|analyze|evaluate|create), "explanation" (why the answer is right, '
    'citing the passage; for choices also why the others are wrong), "hint" (a nudge that does not give the answer away), '
    '"source" (the tag of the passage it is based on, e.g. "S2")'
)

TYPE_FORMATS = {
    "mcq": '"mcq": "options": 4 plausible, distinct options; "correct_answer_index": 0-3',
    "multi_select": '"multi_select": "options": 5 distinct options; "correct_indices": 2-3 indices of ALL correct options; stem ends with "(Select all that apply)"',
    "true_false": '"true_false": "question" is a single clear statement; "correct_bool": true or false (make about half false, with a subtle but real error)',
    "fill_blank": '"fill_blank": "question" is ONE declarative sentence from the material with exactly one "____" per missing key term (e.g. "The ____ is the powerhouse of the cell.") - never a question, and never a sentence followed by a separate question; "blanks": [{"accepted": ["term", "synonym or spelling variant"]}] in order',
    "matching": '"matching": "question" is an instruction like "Match each term to its definition"; "left": 4 terms; "right": their 4 matches in the SAME order (the server shuffles)',
    "ordering": '"ordering": "question" asks to put steps/events in order; "items": 4-6 items listed in the CORRECT order (the server shuffles)',
    "numeric": '"numeric": a calculation or quantity from the passage; "answer": number; "tolerance": acceptable absolute error; "unit": unit or ""',
    "short_answer": '"short_answer": needs a 1-3 sentence answer; "model_answer": ideal answer; "key_points": 2-4 points a correct answer must mention',
    "short": '"short": needs a short written answer; "marks": integer; "answer_key": model answer; "marking_scheme": [{"point": "...", "marks": n}] summing to marks',
    "long": '"long": an extended/essay answer; "marks": integer; "answer_key": model answer outline; "marking_scheme": [{"point": "...", "marks": n}] summing to marks',
}

DIFFICULTY_GUIDE = {
    "easy": "easy = direct recall of a stated fact",
    "medium": "medium = understanding or connecting two ideas",
    "hard": "hard = applying, analysing or evaluating; distractors must be genuinely tempting",
}

BLOOM_GUIDE = (
    "Bloom levels: remember (recall facts), understand (explain), apply (use in a new case), "
    "analyze (compare, find causes), evaluate (judge, justify), create (design, propose)."
)


def spec_line(slot: Dict) -> str:
    extra = f", {slot['marks']} marks" if slot.get("marks") else ""
    return f'{slot["type"]} ({slot["difficulty"]}, {slot["bloom"]}{extra})'


def build_generation_prompt(
    slots: List[Dict],
    context: str,
    avoid: Optional[List[str]] = None,
    focus_topics: Optional[List[str]] = None,
    known_topics: Optional[List[str]] = None,
    exam_style: Optional[str] = None,
    style_notes: Optional[str] = None,
) -> List[Dict]:
    """Messages asking for exactly len(slots) questions, one per slot (type, difficulty, bloom, marks)."""
    types = list(dict.fromkeys(s["type"] for s in slots))
    lines = [
        f"Write exactly {len(slots)} assessment questions from the study passages below.",
        "Questions to write (one each, in this order):",
        *[f"{i}. {spec_line(s)}" for i, s in enumerate(slots, start=1)],
        "",
        "Rules:",
        "- Base every question ONLY on the passages; test important ideas, not trivia.",
        "- Each question must cite the passage it uses in \"source\" (its tag, e.g. \"S1\"). Spread questions across passages.",
        "- Questions must be self-contained, unambiguous and have one defensible answer.",
        "- Never reveal the answer in the stem; avoid 'all/none of the above'.",
        f"- {'; '.join(DIFFICULTY_GUIDE.values())}.",
        f"- {BLOOM_GUIDE}",
    ]
    if exam_style:
        lines.append(f"- Write in a formal examination style: {exam_style}")
    if style_notes:
        lines.append(f"- Match this paper's style: {style_notes[:600]}")
    if focus_topics:
        lines.append(f"- Concentrate on these topics the student finds hard (from new angles): {', '.join(focus_topics)}. Use these exact topic labels.")
    if known_topics:
        lines.append(f"- Reuse these topic labels when they fit: {', '.join(known_topics[:20])}.")
    if avoid:
        lines.append("- Do NOT repeat or closely paraphrase these existing questions:")
        lines.extend(f"  * {q[:140]}" for q in avoid[:12])
    lines += [
        "",
        f"Every question object has: {COMMON_FIELDS}.",
        "Type-specific fields:",
        *[f"- {TYPE_FORMATS[t]}" for t in types if t in TYPE_FORMATS],
        "",
        'Return a JSON object: {"questions": [ ... ]}',
        "",
        "PASSAGES:",
        context,
    ]
    return [
        {"role": "system", "content": "You are an expert examiner who writes accurate, well-constructed assessment questions. Always respond with valid JSON."},
        {"role": "user", "content": "\n".join(lines)},
    ]


def build_regenerate_prompt(original: Dict, mode: str, context: str, avoid: List[str]) -> List[Dict]:
    """Messages to rewrite one question: a fresh one, a harder/easier version, or a variant."""
    instruction = {
        "same": "Write a NEW question of the same type and difficulty on the same idea, worded differently.",
        "harder": "Write a HARDER question of the same type on the same idea (higher Bloom level, subtler distractors).",
        "easier": "Write an EASIER question of the same type on the same idea (more direct, clearer options).",
        "variant": "Write a different question of the same type that tests the same concept from a new angle.",
    }.get(mode, "Write a NEW question of the same type on the same idea.")
    keep = {k: original.get(k) for k in ("type", "question", "topic", "difficulty", "bloom", "marks") if original.get(k) is not None}
    lines = [
        instruction,
        f"Original question: {json.dumps(keep)}",
        "Keep the same \"type\" and \"topic\"" + (" and \"marks\"" if original.get("marks") else "") + ".",
        f"Every question object has: {COMMON_FIELDS}.",
        f"- {TYPE_FORMATS.get(original.get('type', 'mcq'), TYPE_FORMATS['mcq'])}",
    ]
    if avoid:
        lines.append("Do not repeat these questions:")
        lines.extend(f"  * {q[:140]}" for q in avoid[:10])
    lines += ['Return a JSON object: {"questions": [ <one question> ]}', "", "PASSAGES:", context]
    return [
        {"role": "system", "content": "You are an expert examiner. Always respond with valid JSON."},
        {"role": "user", "content": "\n".join(lines)},
    ]
