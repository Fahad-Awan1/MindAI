"""
AI Study Group: a seminar-style discussion between the student and AI classmates.

Each persona has its own personality. Every turn, two classmates speak (the first answers
the student or the last speaker, the second reacts), they cite the student's documents,
and they regularly hand the floor back to the student.
"""
import json
import time
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi.concurrency import run_in_threadpool

from services.groq_service import (
    AIServiceError,
    _complete,
    _extract_list,
    _parse_json,
    _str_list,
    _to_int,
    normalize_citations,
    stream_completion,
)
from services.rag_service import format_sources, rag_service

PERSONAS: Dict[str, Dict[str, str]] = {
    "explainer": {
        "id": "explainer",
        "name": "Maya",
        "role": "The Explainer",
        "color": "#6366f1",
        "description": "Breaks ideas down clearly, step by step, with examples.",
        "style": ("You explain ideas clearly and accurately, step by step, often with a concrete example or analogy. "
                  "You correct misunderstandings kindly and build on good points others make."),
    },
    "skeptic": {
        "id": "skeptic",
        "name": "Leo",
        "role": "The Skeptic",
        "color": "#0ea5e9",
        "description": "Questions claims, asks for evidence, spots weak reasoning.",
        "style": ("You are a friendly skeptic. You question claims, ask 'how do we know that?', point out assumptions, "
                  "limitations or exceptions, and insist on evidence from the documents."),
    },
    "novice": {
        "id": "novice",
        "name": "Zoe",
        "role": "The Curious Beginner",
        "color": "#ec4899",
        "description": "Asks the basic questions everyone is afraid to ask.",
        "style": ("You are new to this topic and curious. You ask simple, honest questions, admit when something is "
                  "confusing, connect ideas to everyday life, and sometimes make a small, natural mistake others can correct."),
    },
    "devil": {
        "id": "devil",
        "name": "Omar",
        "role": "The Devil's Advocate",
        "color": "#f97316",
        "description": "Argues the other side to stress-test ideas.",
        "style": ("You play devil's advocate. You argue the opposite view or an alternative interpretation to stress-test "
                  "ideas, provoke debate, and push others to defend their reasoning - while staying respectful."),
    },
}

TRANSCRIPT_WINDOW = 14       # Lines of conversation the AI sees
ASK_STUDENT_AFTER = 3        # AI lines in a row before the student is asked directly


def now_ms() -> int:
    return int(time.time() * 1000)


def opening_line(topic: str, persona_ids: List[str], student_name: str) -> Dict[str, Any]:
    names = ", ".join(f"{PERSONAS[p]['name']} ({PERSONAS[p]['role'].replace('The ', '').lower()})" for p in persona_ids)
    return {
        "speaker": "moderator",
        "text": (f"Welcome to today's study group on **{topic}**! Joining you: {names}. "
                 f"{student_name}, share what you already know, ask a question, or press *Let them talk* to hear the group first."),
        "at": now_ms(),
    }


def _speaker_name(line: Dict[str, Any], student_name: str) -> str:
    if line["speaker"] == "student":
        return student_name
    if line["speaker"] == "moderator":
        return "Moderator"
    return PERSONAS.get(line["speaker"], {}).get("name", "Classmate")


def transcript_text(transcript: List[Dict[str, Any]], student_name: str, window: int = TRANSCRIPT_WINDOW) -> str:
    return "\n".join(f"{_speaker_name(l, student_name)}: {l['text']}" for l in transcript[-window:])


def pick_speakers(transcript: List[Dict[str, Any]], persona_ids: List[str], student_spoke: bool) -> List[str]:
    """Two speakers for this turn: a responder and a reactor, favouring those who spoke least recently."""
    last_spoken = {p: -1 for p in persona_ids}
    for i, line in enumerate(transcript):
        if line["speaker"] in last_spoken:
            last_spoken[line["speaker"]] = i
    order = sorted(persona_ids, key=lambda p: last_spoken[p])
    first = order[0]
    last_line = transcript[-1] if transcript else None
    # A student question is best answered by the Explainer first
    if student_spoke and "explainer" in persona_ids and last_line and "?" in last_line["text"]:
        first = "explainer"
    second = next((p for p in order if p != first), None)
    return [first] + ([second] if second else [])


def ai_lines_since_student(transcript: List[Dict[str, Any]]) -> int:
    count = 0
    for line in reversed(transcript):
        if line["speaker"] == "student":
            break
        if line["speaker"] in PERSONAS:
            count += 1
    return count


def build_persona_messages(persona_id: str, topic: str, transcript: List[Dict[str, Any]], student_name: str,
                           context: str, ask_student: bool) -> List[Dict[str, str]]:
    persona = PERSONAS[persona_id]
    others = [PERSONAS[p]["name"] for p in PERSONAS if p != persona_id]
    system = f"""You are {persona['name']}, {persona['role'].lower()}, a student in a small study group discussing "{topic}".
{persona['style']}
The group: {student_name} (the real student you are helping learn), plus AI classmates {', '.join(others)} when present.

Rules:
- Write ONLY {persona['name']}'s next contribution: 2-4 sentences, conversational, no name prefix, no stage directions.
- React to what was just said (agree, challenge, build on it, or answer it) and address people by name.
- Stay accurate to the documents. When you use a fact from the context, cite its number like [1].
- Never repeat what someone already said.
{f"- End by asking {student_name} a direct, specific question to bring them into the discussion." if ask_student else ""}
Use light Markdown only (bold key terms).

CONTEXT FROM THE STUDENT'S DOCUMENTS:
{context or "(no matching passages)"}"""
    conversation = transcript_text(transcript, student_name) or "(The discussion is just starting.)"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Discussion so far:\n{conversation}\n\nWrite {persona['name']}'s next contribution now."},
    ]


async def persona_sources(document_ids: List[str], topic: str, transcript: List[Dict[str, Any]]) -> List[Dict]:
    recent = " ".join(l["text"] for l in transcript[-2:])
    return await run_in_threadpool(rag_service.get_sources, f"{topic}. {recent}"[:1500], document_ids)


async def stream_persona_line(persona_id: str, messages: List[Dict[str, str]]) -> AsyncIterator[str]:
    async for piece in stream_completion(messages, 0.8, 400):
        yield piece


async def summarize_session(topic: str, transcript: List[Dict[str, Any]], student_name: str) -> Dict[str, Any]:
    """Moderator wrap-up: key points, open questions and feedback on the student's contributions."""
    student_lines = [l["text"] for l in transcript if l["speaker"] == "student"]
    prompt = f"""You moderated a study group on "{topic}". Here is the discussion:

{transcript_text(transcript, student_name, window=60)}

Return a JSON object with:
- summary (string): 2-3 sentences on what the group covered
- key_points (array of 3-6 strings): the most important ideas established
- open_questions (array of 1-3 strings): good questions still worth exploring
- misconceptions (array of strings): mistakes raised during the discussion and their correction (empty if none)
- student_score (integer 0-100): how well {student_name} engaged and understood (accuracy, reasoning, participation);
  {"use 0 if they did not speak" if not student_lines else "base it on their contributions"}
- student_strengths (array of strings): what {student_name} did well
- student_improvements (array of strings): specific advice for {student_name}"""
    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a fair, encouraging seminar moderator. Always respond with valid JSON."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=2048,
        json_mode=True,
    )
    data = _parse_json(text)
    if not isinstance(data, dict):
        raise AIServiceError("AI returned an unexpected summary format.")
    return {
        "summary": str(data.get("summary") or "").strip(),
        "key_points": _str_list(data.get("key_points")),
        "open_questions": _str_list(data.get("open_questions"), 3),
        "misconceptions": _str_list(data.get("misconceptions")),
        "student_score": min(max(_to_int(data.get("student_score"), 0), 0), 100) if student_lines else None,
        "student_strengths": _str_list(data.get("student_strengths")),
        "student_improvements": _str_list(data.get("student_improvements")),
    }
