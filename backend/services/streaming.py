"""
Shared NDJSON streaming for LLM answers.

Events (one JSON object per line):
    {"type": "<prelude event>", ...}     optional events sent first (e.g. sources)
    {"type": "delta", "text": "..."}     answer text as it is generated
    {"type": "done", "chat_id": "..."}   end of answer (chat_id from on_finish, may be "")
    {"type": "error", "detail": "..."}   the AI service failed
"""
import json
from typing import AsyncIterator, Callable, Dict, List, Optional

from fastapi.responses import StreamingResponse

from services.groq_service import AIServiceError, CHAT_MAX_TOKENS, CHAT_TEMPERATURE, stream_completion

FALLBACK_TEXT = "I couldn't generate a response."


def ndjson(event: Dict) -> str:
    return json.dumps(event) + "\n"


async def stream_answer(
    messages: List[Dict],
    on_finish: Optional[Callable[[str], Optional[str]]] = None,
    prelude: Optional[List[Dict]] = None,
    temperature: float = CHAT_TEMPERATURE,
    max_tokens: int = CHAT_MAX_TOKENS,
) -> AsyncIterator[str]:
    """
    Stream an LLM answer as NDJSON events.

    `on_finish(text)` runs exactly once with whatever was generated - also when the
    client disconnects mid-answer (Stop button) - and may return an ID for the done event.
    """
    parts: List[str] = []
    finished = False

    def finish() -> Optional[str]:
        nonlocal finished
        if finished:
            return None
        finished = True
        text = "".join(parts)
        if on_finish and text.strip():
            return on_finish(text)
        return None

    try:
        for event in prelude or []:
            yield ndjson(event)

        async for piece in stream_completion(messages, temperature, max_tokens):
            parts.append(piece)
            yield ndjson({"type": "delta", "text": piece})

        if not "".join(parts).strip():
            parts.append(FALLBACK_TEXT)
            yield ndjson({"type": "delta", "text": FALLBACK_TEXT})

        result_id = finish()
        yield ndjson({"type": "done", "chat_id": result_id or ""})
    except AIServiceError as e:
        finish()
        yield ndjson({"type": "error", "detail": str(e)})
    finally:
        # Client disconnected mid-stream: keep whatever was generated
        finish()


def streaming_response(events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        events,
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
