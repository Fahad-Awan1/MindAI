from groq import AsyncGroq
from typing import List, Dict, Optional, Any, AsyncIterator
from config import get_settings
from schemas import Flashcard, QuizQuestion, StudyTask, ExamPaper, ExamQuestion
import json
import re

settings = get_settings()

# Configure async Groq client so LLM calls don't block the event loop
# Retries back off on rate limits (the free tier allows ~8k tokens/minute) using Groq's retry-after hints
client = AsyncGroq(api_key=settings.groq_api_key, max_retries=5)

# Maximum number of previous chat messages sent to the LLM
MAX_HISTORY_MESSAGES = 20


class AIServiceError(Exception):
    """Raised when the LLM fails or returns unusable output."""


def _describe_error(error: Exception) -> str:
    """User-facing message for an LLM API failure."""
    text = str(error)
    if "per day" in text or "(TPD)" in text or "(RPD)" in text:
        wait = re.search(r"try again in ([0-9hms.]+)", text)
        when = f" It refills gradually - try again in about {_humanize(wait.group(1))}." if wait else " It refills gradually over the day."
        return "MindAI has used today's free AI allowance (Groq's daily token limit)." + when
    if getattr(error, "status_code", None) == 429 or "rate_limit" in text:
        return "The AI service is busy (rate limit reached). Please wait a few seconds and try again."
    return f"AI service request failed: {error}"


def _humanize(duration: str) -> str:
    """'8m34.9s' -> '9 minutes', '1h2m3s' -> '1 hour 2 minutes'."""
    h = re.search(r"(\d+)h", duration)
    m = re.search(r"(\d+)m(?!s)", duration)
    s = re.search(r"([\d.]+)s", duration)
    hours, minutes = int(h.group(1)) if h else 0, int(m.group(1)) if m else 0
    if s and float(s.group(1)) > 0:
        minutes += 1
    if hours:
        return f"{hours} hour{'s' if hours > 1 else ''}" + (f" {minutes} minutes" if minutes else "")
    return f"{max(1, minutes)} minute{'s' if minutes > 1 else ''}"


def is_daily_limit(message: str) -> bool:
    return "daily" in message and "allowance" in message


def _content(content: Optional[str]) -> str:
    return content or ""


def _request_kwargs(messages: List[Dict], temperature: float, max_tokens: int, json_mode: bool = False) -> Dict[str, Any]:
    """Build the keyword arguments for a Groq chat completion request."""
    kwargs: Dict[str, Any] = {
        "model": settings.groq_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if settings.groq_model.startswith("openai/gpt-oss") and settings.groq_reasoning_effort:
        # Reasoning tokens count toward max_tokens; keep reasoning light
        kwargs["reasoning_effort"] = settings.groq_reasoning_effort
    return kwargs


async def _complete(messages: List[Dict], temperature: float, max_tokens: int, json_mode: bool = False) -> str:
    """Send a chat completion request to Groq and return the text."""
    try:
        response = await client.chat.completions.create(**_request_kwargs(messages, temperature, max_tokens, json_mode))
    except Exception as e:
        raise AIServiceError(_describe_error(e)) from e

    return response.choices[0].message.content or ""


async def complete_with_usage(messages: List[Dict], temperature: float, max_tokens: int, json_mode: bool = False) -> tuple:
    """Like _complete, but also returns the total tokens the request used (for rate budgeting)."""
    try:
        response = await client.chat.completions.create(**_request_kwargs(messages, temperature, max_tokens, json_mode))
    except Exception as e:
        raise AIServiceError(_describe_error(e)) from e
    usage = getattr(response, "usage", None)
    total = getattr(usage, "total_tokens", None) if usage else None
    return response.choices[0].message.content or "", total


async def stream_completion(messages: List[Dict], temperature: float = 0.7, max_tokens: int = 2048) -> AsyncIterator[str]:
    """Stream a chat completion from Groq, yielding text pieces as they arrive."""
    try:
        stream = await client.chat.completions.create(
            **_request_kwargs(messages, temperature, max_tokens),
            stream=True
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            piece = chunk.choices[0].delta.content
            if piece:
                yield piece
    except Exception as e:
        raise AIServiceError(_describe_error(e)) from e


def _parse_json(text: str) -> Any:
    """Parse JSON from LLM output, tolerating stray markdown code fences."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise AIServiceError("AI returned invalid JSON. Please try again.") from e


def _extract_list(data: Any, keys: List[str]) -> List[Any]:
    """Extract a list of items from parsed JSON that may be wrapped in an object."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in keys:
            if isinstance(data.get(key), list):
                return data[key]
        # Fall back to the first list value in the object
        for value in data.values():
            if isinstance(value, list):
                return value
    return []


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _convert_history(history: List[Dict]) -> List[Dict]:
    """Convert frontend chat history (roles 'user'/'model') to Groq format."""
    messages = []
    for msg in history[-MAX_HISTORY_MESSAGES:]:
        text = msg.get("text") or ""
        if not text:
            parts = msg.get("parts") or []
            text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        if not text.strip():
            continue
        role = "assistant" if msg.get("role") in ("model", "assistant") else "user"
        messages.append({"role": role, "content": text})
    return messages


async def generate_summary(content: str) -> str:
    """
    Generate a concise summary of the provided text content.

    Flow:
    1. Truncate content to 10k chars to fit context window.
    2. Construct a prompt asking for a 3-paragraph summary.
    3. Call Groq API with the system and user messages.
    4. Return the generated summary text.
    """
    content = _content(content)
    if not content.strip():
        return "No text could be extracted from this document, so a summary is not available."

    try:
        prompt = f"Please provide a concise summary (max 3 paragraphs) of this document. Focus on the key concepts and main arguments.\n\nDocument:\n{content[:10000]}"

        text = await _complete(
            messages=[
                {"role": "system", "content": "You are a helpful assistant that creates concise summaries."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=500
        )
        return text or "Unable to generate summary."

    except Exception as e:
        print(f"Error generating summary: {e}")
        return "Summary generation failed."


CHAT_TEMPERATURE = 0.7
CHAT_MAX_TOKENS = 2048
MARKDOWN_INSTRUCTION = "Format answers with Markdown (headings, bullet lists, bold key terms, tables) when it improves readability."
CITATION_INSTRUCTION = (
    "The context is split into numbered passages like [1], [2]. After each statement that uses a passage, "
    "cite it with its number in plain ASCII square brackets, e.g. [1] or [2][3] (not 【1】 or footnotes). "
    "Only cite numbers that appear in the context, and never invent citations."
)

# Citation styles some models use instead of [n]: 【1】, 【1†source】, [^1]
_CITATION_VARIANTS = re.compile(r"【\s*(\d+)(?:[^】]*)】|\[\^(\d+)\]")


def normalize_citations(text: str) -> str:
    """Rewrite alternative citation markers to the [n] form the app links to sources."""
    return _CITATION_VARIANTS.sub(lambda m: f"[{m.group(1) or m.group(2)}]", text)


def build_document_messages(
    history: List[Dict],
    content: str,
    message: str,
    rag_context: str = ""
) -> List[Dict]:
    """
    Build the Groq messages for chatting with a single document.

    Flow:
    1. Construct system message defining the assistant's persona.
    2. Append RAG context (or truncated content) to the system message.
    3. Convert chat history to the format expected by Groq API.
    4. Append the new user message.
    """
    system_message = f"""You are MindAI, an intelligent student assistant.
Answer the user's questions based on the provided document and context.
If the answer is not in the document or context, politely say so.
{MARKDOWN_INSTRUCTION}
{CITATION_INSTRUCTION if rag_context else ""}

DOCUMENT CONTEXT:
{rag_context if rag_context else _content(content)[:30000]}"""

    messages = [{"role": "system", "content": system_message}]
    messages.extend(_convert_history(history))
    messages.append({"role": "user", "content": message})
    return messages


def build_knowledge_base_messages(
    history: List[Dict],
    message: str,
    rag_context: str
) -> List[Dict]:
    """Build the Groq messages for chatting with the whole knowledge base."""
    system_message = f"""You are MindAI, a Knowledge Base Assistant.
You have access to multiple documents. Answer the user's questions by synthesizing information from ALL available documents.
If the answer is not in the context, politely say so.
{MARKDOWN_INSTRUCTION}
{CITATION_INSTRUCTION if rag_context else ""}

KNOWLEDGE BASE CONTEXT:
{rag_context if rag_context else "(No relevant content was found in the knowledge base.)"}"""

    messages = [{"role": "system", "content": system_message}]
    messages.extend(_convert_history(history))
    messages.append({"role": "user", "content": message})
    return messages


async def chat_with_document(
    history: List[Dict],
    content: str,
    message: str,
    rag_context: str = ""
) -> str:
    """Chat with a document using RAG context."""
    messages = build_document_messages(history, content, message, rag_context)
    text = await _complete(messages, temperature=CHAT_TEMPERATURE, max_tokens=CHAT_MAX_TOKENS)
    return text or "I couldn't generate a response."


async def chat_with_knowledge_base(
    history: List[Dict],
    message: str,
    rag_context: str
) -> str:
    """Chat with multiple documents using RAG context."""
    messages = build_knowledge_base_messages(history, message, rag_context)
    text = await _complete(messages, temperature=CHAT_TEMPERATURE, max_tokens=CHAT_MAX_TOKENS)
    return text or "I couldn't generate a response."


async def generate_flashcards(content: str, count: int = 10) -> List[Flashcard]:
    """
    Generate study flashcards from document content.

    Flow:
    1. Construct a prompt requesting JSON output.
    2. Call Groq API in JSON mode.
    3. Parse the JSON response into a list of Flashcard objects.
    """
    prompt = f"""Create {count} high-quality study flashcards from this document. The front should be a concept or question, and the back should be the definition or answer.

Return a JSON object of the form {{"flashcards": [{{"front": "...", "back": "..."}}]}}.

Document:
{_content(content)[:15000]}"""

    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a helpful assistant that creates study flashcards. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5,
        max_tokens=4096,
        json_mode=True
    )

    cards = []
    for item in _extract_list(_parse_json(text), ['flashcards', 'cards']):
        if not isinstance(item, dict):
            continue
        front = str(item.get('front') or item.get('question') or '').strip()
        back = str(item.get('back') or item.get('answer') or '').strip()
        if front and back:
            cards.append(Flashcard(front=front, back=back))
    return cards


async def generate_quiz(
    content: str,
    count: int = 5,
    focus_topics: Optional[List[str]] = None,
    known_topics: Optional[List[str]] = None,
    avoid_questions: Optional[List[str]] = None
) -> List[QuizQuestion]:
    """
    Generate quiz questions from document.

    focus_topics: weak topics most questions should target (adaptive quiz).
    known_topics: topic labels already in use, so labels stay consistent between quizzes.
    avoid_questions: earlier questions not to repeat.
    """
    extra = ""
    if focus_topics:
        focus_count = max(1, round(count * 0.7))
        extra += (
            "\nIMPORTANT - this is a focused revision quiz. The student keeps getting these topics wrong: "
            + "; ".join(f'"{t}"' for t in focus_topics) + ".\n"
            f"At least {focus_count} of the {count} questions MUST test one of these topics, each from a new angle "
            "(different facts, applications or misconceptions), and their \"topic\" field MUST be exactly one of those "
            "names, copied verbatim. Only the remaining questions may cover other parts of the document.\n"
        )
    if known_topics:
        extra += "\nReuse these existing topic labels when a question fits one of them: " + "; ".join(known_topics) + ".\n"
    if avoid_questions:
        extra += "\nDo NOT repeat or closely paraphrase these earlier questions:\n" + "\n".join(f"- {q}" for q in avoid_questions) + "\n"

    prompt = f"""Create a multiple-choice quiz with {count} questions based on the provided document.
For each question, provide:
1. The question text
2. 4 distinct options
3. The index of the correct answer (0-3)
4. A detailed explanation that:
   - Explains why the correct answer is correct
   - Mentions specific context from the document
   - Briefly explains why distractors are incorrect
5. A topic: the key concept being tested, as a short label of 1-4 words (e.g. "Calvin cycle")
{extra}
Return a JSON object of the form {{"questions": [{{"question": "...", "options": ["...", "...", "...", "..."], "correct_answer_index": 0, "explanation": "...", "topic": "..."}}]}}.

Document:
{_content(content)[:15000]}"""

    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a helpful assistant that creates educational quizzes. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5,
        max_tokens=4096,
        json_mode=True
    )

    questions = []
    for item in _extract_list(_parse_json(text), ['questions', 'quiz']):
        if not isinstance(item, dict):
            continue
        question = str(item.get('question') or '').strip()
        options = [str(o).strip() for o in (item.get('options') or []) if str(o).strip()]
        index = _to_int(item.get('correct_answer_index', item.get('correctAnswerIndex')), -1)
        explanation = str(item.get('explanation') or '').strip()
        topic = str(item.get('topic') or '').strip()[:60] or None
        # Skip malformed questions instead of failing the whole quiz
        if not question or len(options) < 2 or not (0 <= index < len(options)):
            continue
        questions.append(QuizQuestion(
            question=question,
            options=options,
            correct_answer_index=index,
            explanation=explanation,
            topic=topic
        ))
    return questions


async def generate_study_plan(content: str, days: int = 5) -> List[StudyTask]:
    """Generate study plan from document."""
    prompt = f"""Create a {days}-day study plan to master the content of this document.
Break it down into logical sections. For each day, provide:
- day (integer)
- topic (string)
- tasks (array of strings - specific tasks like reading, reviewing, practicing)
- estimated_minutes (integer)

Return a JSON object of the form {{"plan": [{{"day": 1, "topic": "...", "tasks": ["..."], "estimated_minutes": 60}}]}} with exactly {days} entries.

Document:
{_content(content)[:15000]}"""

    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a helpful assistant that creates study plans. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5,
        max_tokens=4096,
        json_mode=True
    )

    plan = []
    for idx, item in enumerate(_extract_list(_parse_json(text), ['plan', 'study_plan', 'days'])):
        if not isinstance(item, dict):
            continue
        tasks = item.get('tasks') or []
        if isinstance(tasks, str):
            tasks = [tasks]
        tasks = [str(t).strip() for t in tasks if str(t).strip()]
        topic = str(item.get('topic') or '').strip()
        if not topic and not tasks:
            continue
        plan.append(StudyTask(
            day=_to_int(item.get('day'), idx + 1),
            topic=topic or f"Day {idx + 1}",
            tasks=tasks,
            estimated_minutes=_to_int(item.get('estimated_minutes', item.get('estimatedMinutes')), 60)
        ))
    return plan


# Matches node shapes like id((text)), id[text], id{{text}}, id))text(( (no space before the bracket)
_SHAPE_RE = re.compile(r"^[\w-]*[\(\[\{\)]+(.*?)[\)\]\}\(]+$")


def _clean_node_text(text: str) -> str:
    """Strip Mermaid shape syntax and characters that break the mindmap parser."""
    text = text.strip()
    text = re.sub(r"^[-*+]\s+", "", text)  # markdown bullets
    match = _SHAPE_RE.match(text)
    if match and match.group(1).strip():
        text = match.group(1)
    text = re.sub(r"[\(\)\[\]\{\}\"`]", "", text)
    return text.strip()


def sanitize_mindmap(code: str) -> str:
    """
    Normalize LLM-generated Mermaid mindmap code so it renders reliably.

    Keeps the indentation-based hierarchy, wraps the root as root((...)) and
    removes shape/icon syntax from the other nodes.
    """
    code = code.replace("```mermaid", "").replace("```", "")
    lines = code.splitlines()

    # Drop everything before the 'mindmap' keyword
    start = next((i for i, l in enumerate(lines) if l.strip().lower() == "mindmap"), None)
    if start is not None:
        lines = lines[start + 1:]

    nodes = []
    for line in lines:
        if not line.strip() or line.strip().startswith("::") or line.strip().startswith("%%"):
            continue
        indent = len(line) - len(line.lstrip())
        text = _clean_node_text(line)
        if text:
            nodes.append((indent, text))

    if not nodes:
        return ""

    root_indent, root_text = nodes[0]
    out = ["mindmap", f"  root(({root_text}))"]
    for indent, text in nodes[1:]:
        # Every non-root node must be indented deeper than the root
        relative = max(indent - root_indent, 1)
        out.append("  " + " " * (relative + 2) + text)
    return "\n".join(out)


async def generate_mind_map(content: str) -> str:
    """Generate Mermaid mind map from document."""
    prompt = f"""Create a mind map using Mermaid.js syntax that represents the key concepts and hierarchy of this document. Return ONLY the Mermaid code starting with 'mindmap'. Use indentation to show hierarchy, keep each node short, and do not use parentheses, brackets or quotes inside node text. Do not include markdown code blocks or explanations.

Document:
{_content(content)[:10000]}"""

    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a helpful assistant that creates mind maps in Mermaid syntax."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5,
        max_tokens=1500
    )

    return sanitize_mindmap(text)


async def generate_exam_paper(
    content: str,
    num_questions: int,
    difficulty: str,
    question_type: str
) -> Optional[ExamPaper]:
    """Generate exam paper from document."""
    if question_type == 'mixed':
        type_instruction = "include both short and long answer questions"
    else:
        type_instruction = f"every question must be of type '{question_type}'"

    prompt = f"""Create a formal exam paper based on this document.
Configuration:
- Number of Questions: {num_questions}
- Difficulty: {difficulty}
- Question Type: {question_type} ({type_instruction})

Return a JSON object with:
- title (string - e.g., "Mid-Term Examination: [Subject]")
- total_marks (integer)
- duration_minutes (integer)
- questions (array of objects with: id (integer), question (string), marks (integer), type ('short' or 'long'), answer_key (string))

Document:
{_content(content)[:15000]}"""

    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a helpful assistant that creates formal examination papers. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5,
        max_tokens=6000,
        json_mode=True
    )

    exam_data = _parse_json(text)
    if not isinstance(exam_data, dict):
        raise AIServiceError("AI returned an unexpected exam format. Please try again.")

    # Handle potential wrapper keys
    for key in ('exam', 'exam_paper'):
        if isinstance(exam_data.get(key), dict):
            exam_data = exam_data[key]
            break

    questions = []
    for idx, item in enumerate(exam_data.get('questions') or []):
        if not isinstance(item, dict):
            continue
        question = str(item.get('question') or '').strip()
        if not question:
            continue
        q_type = str(item.get('type') or '').lower()
        if q_type not in ('short', 'long'):
            q_type = question_type if question_type in ('short', 'long') else 'short'
        questions.append(ExamQuestion(
            id=len(questions) + 1,
            question=question,
            marks=max(_to_int(item.get('marks'), 5), 1),
            type=q_type,
            answer_key=str(item.get('answer_key') or item.get('answerKey') or '').strip()
        ))

    if not questions:
        return None

    computed_total = sum(q.marks for q in questions)
    return ExamPaper(
        title=str(exam_data.get('title') or 'Examination Paper').strip(),
        # Keep the header consistent with the marks actually shown per question
        total_marks=computed_total,
        duration_minutes=max(_to_int(exam_data.get('duration_minutes', exam_data.get('durationMinutes')), 60), 1),
        questions=questions
    )


# ---------------------------------------------------------------------------
# Tutoring
# ---------------------------------------------------------------------------

def build_explain_mistake_messages(
    question: str,
    options: List[str],
    correct_index: int,
    chosen_index: int,
    explanation: str,
    context: str,
    history: List[Dict],
    follow_up: Optional[str] = None,
    question_type: str = "mcq",
    correct_text: Optional[str] = None,
    student_text: Optional[str] = None,
) -> List[Dict]:
    """Messages for the "Explain my mistake" tutor (first explanation or a follow-up question)."""
    letters = "ABCDEFGH"
    option_lines = "\n".join(f"{letters[i]}. {opt}" for i, opt in enumerate(options)) or "(not a multiple-choice question)"
    chosen = f"{letters[chosen_index]}. {options[chosen_index]}" if 0 <= chosen_index < len(options) else (student_text or "(no answer)")
    correct = f"{letters[correct_index]}. {options[correct_index]}" if 0 <= correct_index < len(options) else (correct_text or "(unknown)")
    kind = "a multiple-choice question" if question_type in ("mcq", "true_false") else f"a {question_type.replace('_', ' ')} question"

    system_message = f"""You are MindAI, a patient and encouraging tutor.
A student answered {kind} incorrectly. Help them understand their mistake using the document context.
- Explain why their chosen answer is wrong and why the correct answer is right.
- Name the likely misconception behind their choice.
- Ground the explanation in the document; quote it briefly where helpful.
- End with ONE short check-for-understanding question (don't answer it).
Keep it concise and use Markdown. When answering follow-up questions, stay focused on this topic.

QUESTION:
{question}

OPTIONS:
{option_lines}

STUDENT'S ANSWER: {chosen}
CORRECT ANSWER: {correct}
QUIZ EXPLANATION: {explanation or "(none)"}

DOCUMENT CONTEXT:
{context or "(no extra context found)"}"""

    messages = [{"role": "system", "content": system_message}]
    messages.extend(_convert_history(history))
    messages.append({"role": "user", "content": follow_up or "Explain my mistake."})
    return messages


async def suggest_concepts(content: str, count: int = 10) -> List[str]:
    """Key concepts from a document that a student could practise explaining."""
    prompt = f"""List the {count} most important concepts in this document that a student should be able to explain in their own words.
Use short names (1-5 words), ordered from most to least central.

Return a JSON object of the form {{"concepts": ["...", "..."]}}.

Document:
{_content(content)[:12000]}"""
    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a helpful study assistant. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,
        max_tokens=800,
        json_mode=True
    )
    concepts: List[str] = []
    for item in _extract_list(_parse_json(text), ["concepts"]):
        name = str(item).strip()
        if name and name.lower() not in {c.lower() for c in concepts}:
            concepts.append(name[:80])
    return concepts[:count]


def _str_list(value: Any, limit: int = 8) -> List[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()][:limit]


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def grade_teach_back(concept: str, explanation: str, context: str) -> Dict[str, Any]:
    """Grade a student's own-words explanation of a concept against the document (Feynman technique)."""
    prompt = f"""A student is using the Feynman technique: they explained a concept in their own words.
Grade their explanation against the document context. Be fair and encouraging, but honest about gaps and errors.

CONCEPT: {concept}

STUDENT'S EXPLANATION (between the markers):
<<<
{explanation}
>>>

DOCUMENT CONTEXT:
{context}

Return a JSON object with:
- score (integer 0-100): accuracy and completeness of the explanation
- verdict (string): one encouraging sentence summarising how well they understand it
- strengths (array of strings): what they explained correctly
- gaps (array of strings): important points from the document they missed
- misconceptions (array of strings): anything they stated that is wrong (empty if none)
- improved_explanation (string): a clear, simple model explanation (3-6 sentences) a student could learn from
- follow_up_question (string): one question to test the part they understand least"""
    text = await _complete(
        messages=[
            {"role": "system", "content": "You are an expert tutor who grades student explanations. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,
        max_tokens=2048,
        json_mode=True
    )
    data = _parse_json(text)
    if not isinstance(data, dict):
        raise AIServiceError("AI returned an unexpected format. Please try again.")
    return {
        "score": min(max(_to_int(data.get("score"), 0), 0), 100),
        "verdict": str(data.get("verdict") or "").strip(),
        "strengths": _str_list(data.get("strengths")),
        "gaps": _str_list(data.get("gaps")),
        "misconceptions": _str_list(data.get("misconceptions")),
        "improved_explanation": str(data.get("improved_explanation") or "").strip(),
        "follow_up_question": str(data.get("follow_up_question") or "").strip(),
    }


async def grade_exam_answers(exam: Dict[str, Any], answers: List[str]) -> Dict[str, Any]:
    """
    Mark a student's written exam answers against the answer key.

    Returns {"questions": [{id, awarded_marks, max_marks, feedback, missing_points}], "overall_feedback"}.
    Blank answers get 0 marks without asking the AI.
    """
    questions = exam.get("questions", [])
    to_grade = []
    for q, answer in zip(questions, answers):
        if answer.strip():
            to_grade.append({
                "id": q.get("id"),
                "question": q.get("question"),
                "max_marks": q.get("marks"),
                "answer_key": q.get("answer_key"),
                "student_answer": answer.strip()[:4000],
            })

    graded: Dict[int, Dict[str, Any]] = {}
    overall = ""
    if to_grade:
        prompt = f"""You are marking a student's exam. For each question, compare the student's answer with the answer key
and award marks out of max_marks. Give partial credit for partially correct answers, award full marks for answers
that are correct even if worded differently, and give 0 for irrelevant or wrong answers.

QUESTIONS TO MARK (JSON):
{json.dumps(to_grade, ensure_ascii=False)}

Return a JSON object of the form
{{"questions": [{{"id": 1, "awarded_marks": 3, "feedback": "what was good and what was missing", "missing_points": ["..."]}}],
  "overall_feedback": "2-3 sentences of overall advice"}}"""
        text = await _complete(
            messages=[
                {"role": "system", "content": "You are a fair, experienced examiner. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=4096,
            json_mode=True
        )
        data = _parse_json(text)
        for item in _extract_list(data, ["questions", "grades"]):
            if isinstance(item, dict):
                graded[_to_int(item.get("id"), -1)] = item
        if isinstance(data, dict):
            overall = str(data.get("overall_feedback") or "").strip()

    results = []
    for q, answer in zip(questions, answers):
        max_marks = max(_to_int(q.get("marks"), 1), 1)
        qid = _to_int(q.get("id"), -1)
        if not answer.strip():
            results.append({"id": qid, "awarded_marks": 0, "max_marks": max_marks,
                            "feedback": "No answer given.", "missing_points": []})
            continue
        item = graded.get(qid, {})
        awarded = min(max(_to_float(item.get("awarded_marks"), 0), 0), max_marks)
        results.append({
            "id": qid,
            "awarded_marks": round(awarded, 1),
            "max_marks": max_marks,
            "feedback": str(item.get("feedback") or "Could not be marked automatically.").strip(),
            "missing_points": _str_list(item.get("missing_points")),
        })
    return {"questions": results, "overall_feedback": overall}


# ---------------------------------------------------------------------------
# Reader: actions on highlighted text
# ---------------------------------------------------------------------------

SELECTION_PROMPTS = {
    "explain": (
        "Explain the highlighted passage to a student. Clarify what it means, define any key terms, "
        "and connect it to the surrounding ideas in the document. Use Markdown and keep it focused."
    ),
    "simplify": (
        "Rewrite the highlighted passage in plain, simple language a 12-year-old could follow. "
        "Keep every important idea, use short sentences, and add one everyday analogy at the end."
    ),
}


def build_selection_messages(action: str, selection: str, context: str, history: List[Dict], follow_up: Optional[str] = None) -> List[Dict]:
    """Messages for explaining or simplifying a passage the student highlighted in the reader."""
    system_message = f"""You are MindAI, a friendly tutor helping a student read their study material.
{SELECTION_PROMPTS[action]}

HIGHLIGHTED PASSAGE:
<<<
{selection}
>>>

SURROUNDING DOCUMENT CONTEXT:
{context or "(none)"}"""
    messages = [{"role": "system", "content": system_message}]
    messages.extend(_convert_history(history))
    messages.append({"role": "user", "content": follow_up or ("Explain this passage." if action == "explain" else "Simplify this passage.")})
    return messages


async def flashcards_from_selection(selection: str, context: str, max_cards: int = 2) -> List[Flashcard]:
    """Turn a highlighted passage into 1-2 focused flashcards."""
    prompt = f"""Create 1 to {max_cards} high-quality flashcards that capture the key facts or ideas in the highlighted passage.
Each card should test one idea: the front is a clear question or term, the back is a concise answer.

HIGHLIGHTED PASSAGE:
<<<
{selection}
>>>

SURROUNDING CONTEXT (for accuracy only):
{context[:4000]}

Return a JSON object of the form {{"flashcards": [{{"front": "...", "back": "..."}}]}}."""
    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a helpful assistant that creates study flashcards. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,
        max_tokens=1024,
        json_mode=True
    )
    cards = []
    for item in _extract_list(_parse_json(text), ["flashcards", "cards"]):
        if isinstance(item, dict):
            front = str(item.get("front") or "").strip()
            back = str(item.get("back") or "").strip()
            if front and back:
                cards.append(Flashcard(front=front, back=back))
    return cards[:max_cards]


# ---------------------------------------------------------------------------
# Audio overview (two-host podcast script)
# ---------------------------------------------------------------------------

PODCAST_HOSTS = {"A": "Alex", "B": "Sam"}
PODCAST_LENGTHS = {"short": (10, 14), "medium": (18, 24)}


async def generate_podcast_script(content: str, title: str, length: str = "short") -> Dict[str, Any]:
    """
    Write an engaging two-host audio overview of a document.

    Returns {"title": str, "lines": [{"speaker": "A"|"B", "name": str, "text": str}]}.
    """
    low, high = PODCAST_LENGTHS.get(length, PODCAST_LENGTHS["short"])
    prompt = f"""Write the script for a short, lively educational podcast that helps a student understand this document.
Two hosts talk: Alex (speaker "A", explains clearly) and Sam (speaker "B", curious, asks the questions a student would ask,
offers analogies and summaries). Make it conversational and accurate to the document:
- Open with a hook, cover the most important ideas in a logical order, and end with a quick recap of the key takeaways.
- Use plain spoken English: no Markdown, no bullet points, no stage directions, no sound effects.
- Each line is 1-3 sentences. Write {low}-{high} lines in total, alternating speakers naturally.

Document title: {title}

Return a JSON object of the form
{{"title": "catchy episode title", "lines": [{{"speaker": "A", "text": "..."}}, {{"speaker": "B", "text": "..."}}]}}

Document:
{_content(content)[:12000]}"""
    text = await _complete(
        messages=[
            {"role": "system", "content": "You are a skilled educational podcast writer. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        max_tokens=4096,
        json_mode=True
    )
    data = _parse_json(text)
    lines = []
    for item in _extract_list(data, ["lines", "script", "dialogue"]):
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speaker") or "").strip().upper()[:1]
        if speaker not in PODCAST_HOSTS:
            speaker = "A" if len(lines) % 2 == 0 else "B"
        line_text = re.sub(r"[*_#`]", "", str(item.get("text") or "")).strip()
        if line_text:
            lines.append({"speaker": speaker, "name": PODCAST_HOSTS[speaker], "text": line_text})
    if len(lines) < 4:
        raise AIServiceError("The AI did not return a usable podcast script. Please try again.")
    episode_title = str(data.get("title") or "").strip() if isinstance(data, dict) else ""
    return {"title": episode_title or f"Audio overview: {title}", "lines": lines}


# ---------------------------------------------------------------------------
# Concept graph
# ---------------------------------------------------------------------------

async def extract_concept_map(content: str, title: str, max_concepts: int = 14) -> Dict[str, Any]:
    """
    Key concepts in a document and how they relate.

    Returns {"concepts": [{"name", "description"}], "relations": [{"source", "target", "label"}]}.
    """
    prompt = f"""Build a concept map of this document for a student.
1. Pick the {max_concepts} most important concepts (short names, 1-4 words, Title Case; use standard terminology so
   the same concept in another document gets the same name).
2. Give each a one-sentence description based on the document.
3. List the most meaningful relationships between these concepts (only between names in your list), each with a short
   verb-phrase label such as "is part of", "produces", "requires", "is measured by", "contrasts with".

Document title: {title}

Return a JSON object of the form
{{"concepts": [{{"name": "...", "description": "..."}}],
  "relations": [{{"source": "concept name", "target": "concept name", "label": "..."}}]}}

Document:
{_content(content)[:8000]}"""
    text = await _complete(
        messages=[
            {"role": "system", "content": "You are an expert at building concept maps for learning. Always respond with valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,
        max_tokens=3000,
        json_mode=True
    )
    data = _parse_json(text)
    concepts, seen = [], set()
    for item in _extract_list(data, ["concepts", "nodes"]):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:60]
        if name and name.lower() not in seen:
            seen.add(name.lower())
            concepts.append({"name": name, "description": str(item.get("description") or "").strip()[:400]})
    concepts = concepts[:max_concepts]
    names = {c["name"].lower() for c in concepts}

    relations = []
    for item in _extract_list(data, ["relations", "edges", "relationships"]) if isinstance(data, dict) else []:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip()
        target = str(item.get("target") or "").strip()
        if source.lower() in names and target.lower() in names and source.lower() != target.lower():
            relations.append({"source": source, "target": target, "label": str(item.get("label") or "relates to").strip()[:40]})
    if not concepts:
        raise AIServiceError("The AI did not return any concepts. Please try again.")
    return {"concepts": concepts, "relations": relations}
