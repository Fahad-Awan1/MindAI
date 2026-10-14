"""
A simple token budget so generation stays under Groq's per-minute token limit.

Each call reserves an estimate (prompt tokens + max_tokens) and is settled to the real usage afterwards. When the rolling 60-second total
would go over the budget, callers are told how long to wait - the stream shows that to the user
instead of hitting a rate-limit error.
"""
import asyncio
import time
from collections import deque
from typing import Deque

WINDOW_S = 60.0
# The free tier allows ~8k tokens/minute; keep a margin for other features using the API at the same time
TOKENS_PER_MINUTE = 7000


def estimate_tokens(prompt_chars: int, max_tokens: int) -> int:
    # Groq checks the prompt plus the full max_tokens against the per-minute limit before running a request
    return int(prompt_chars / 3.5) + int(max_tokens)


class GroqBudget:
    def __init__(self, tokens_per_minute: int = TOKENS_PER_MINUTE):
        self.limit = tokens_per_minute
        self.events: Deque[list] = deque()
        self.lock = asyncio.Lock()

    def _prune(self, now: float) -> None:
        while self.events and now - self.events[0][0] >= WINDOW_S:
            self.events.popleft()

    def wait_seconds(self, tokens: int) -> float:
        """How long until `tokens` fit in the window (0 if they fit now)."""
        now = time.monotonic()
        self._prune(now)
        used = sum(t for _, t in self.events)
        if used + tokens <= self.limit or not self.events:
            return 0.0
        # Drop the oldest reservations until the new one fits
        freed = 0
        for ts, t in self.events:
            freed += t
            if used - freed + tokens <= self.limit:
                return max(0.0, WINDOW_S - (now - ts)) + 0.2
        return max(0.0, WINDOW_S - (now - self.events[-1][0])) + 0.2

    def reserve(self, tokens: int) -> list:
        """Reserve an estimate; returns a handle to settle with the real usage afterwards."""
        entry = [time.monotonic(), min(tokens, self.limit)]
        self.events.append(entry)
        return entry

    def settle(self, handle: list, actual_tokens) -> None:
        """Replace an estimate with the tokens the request really used."""
        if isinstance(actual_tokens, int) and actual_tokens > 0:
            handle[1] = min(actual_tokens, self.limit)


budget = GroqBudget()
