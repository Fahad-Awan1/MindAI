"""Answer normalisation used for matching typed answers (fill-in-the-blank, numeric, short answers)."""
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Optional

_ARTICLES = re.compile(r"\b(a|an|the)\b")
_PUNCT = re.compile(r"[^\w\s.\-]")
_SPACES = re.compile(r"\s+")
_NUMBER = re.compile(r"^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$")


def normalize_text(text: str) -> str:
    """Lower-case, strip accents' variants, punctuation, articles and extra spaces."""
    text = unicodedata.normalize("NFKC", str(text or "")).lower().strip()
    text = _PUNCT.sub(" ", text)
    text = _ARTICLES.sub(" ", text)
    text = text.strip(" .-")
    return _SPACES.sub(" ", text).strip()


def parse_number(text) -> Optional[float]:
    """Parse '1,200', '1.2e3', '45 %', '9.8 m/s' (trailing unit ignored) into a float."""
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        return float(text)
    s = str(text or "").strip().replace(",", "").replace("−", "-")
    match = re.match(r"^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?", s)
    if not match:
        return None
    try:
        value = float(match.group(0))
    except ValueError:
        return None
    if value != value or value in (float("inf"), float("-inf")):
        return None
    return value


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def text_matches(answer: str, accepted: str) -> bool:
    """True if a typed answer matches an accepted answer (normalised, numeric or near-identical spelling)."""
    a, b = normalize_text(answer), normalize_text(accepted)
    if not a or not b:
        return False
    if a == b:
        return True
    # Both purely numeric: compare values ("3.50" == "3.5")
    if _NUMBER.match(a) and _NUMBER.match(b):
        na, nb = parse_number(a), parse_number(b)
        if na is not None and nb is not None and abs(na - nb) <= 1e-9 * max(1.0, abs(nb)):
            return True
    # Tolerate small typos in longer words
    if len(b) > 4 and similarity(a, b) >= 0.9:
        return True
    return False


def stem_tokens(text: str) -> set:
    return set(w for w in normalize_text(text).split() if len(w) > 2)


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
