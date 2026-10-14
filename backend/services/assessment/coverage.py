"""
Choose which parts of the documents each generation batch is written from.

Instead of the first 15k characters, the documents are split into labelled passages (pages, slides,
sections) and every batch gets a different slice, spread evenly across all selected documents -
or only the chosen sections, or the passages most relevant to chosen topics.

Each passage shown to the model gets a short tag ("S3"); the model cites the tag and the server
resolves it to the real document/location, so citations can't be invented.
"""
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from models import Document
from services.document_service import document_segments
from services.rag_service import rag_service

BATCH_CONTEXT_CHARS = 3500
PASSAGE_CHARS = 1400
EXCERPT_CHARS = 400


@dataclass
class Passage:
    document_id: str
    document_title: str
    location: str
    text: str


@dataclass
class Batch:
    context: str
    sources: Dict[str, Dict] = field(default_factory=dict)


def _passages_for(document: Document, sections: Optional[List[str]] = None) -> List[Passage]:
    """The document as labelled passages of at most PASSAGE_CHARS characters."""
    passages: List[Passage] = []
    wanted = {s.strip().lower() for s in sections} if sections else None
    for label, text in document_segments(document):
        location = label or ""
        if wanted is not None and location.strip().lower() not in wanted:
            continue
        text = (text or "").strip()
        for start in range(0, len(text), PASSAGE_CHARS):
            piece = text[start:start + PASSAGE_CHARS].strip()
            if len(piece) > 40:
                passages.append(Passage(document.id, document.title, location, piece))
    return passages


def document_outline(document: Document) -> List[Dict]:
    """Section/page labels with sizes, for the 'choose sections' picker."""
    outline = []
    for label, text in document_segments(document):
        if label:
            outline.append({"label": label, "chars": len(text or "")})
    return outline


def _windows(passages: List[Passage], n: int) -> List[List[Passage]]:
    """n windows of consecutive passages, evenly spaced through the list (wrapping if short)."""
    if not passages:
        return [[] for _ in range(n)]
    per_window = max(1, round(BATCH_CONTEXT_CHARS / max(1, sum(len(p.text) for p in passages) / len(passages))))
    windows = []
    for i in range(n):
        start = math.floor(i * len(passages) / n) if len(passages) > per_window else 0
        window, size, j = [], 0, start
        while size < BATCH_CONTEXT_CHARS and len(window) < len(passages):
            p = passages[j % len(passages)]
            window.append(p)
            size += len(p.text)
            j += 1
        windows.append(window)
    return windows


def _rotate_for_variety(windows: List[List[Passage]], salt: int) -> List[List[Passage]]:
    if not salt or len(windows) < 2:
        return windows
    k = salt % len(windows)
    return windows[k:] + windows[:k]


def _batch_from(passages: List[Passage]) -> Batch:
    parts, sources = [], {}
    for i, p in enumerate(passages, start=1):
        tag = f"S{i}"
        where = " · ".join(x for x in [p.document_title, p.location] if x)
        parts.append(f"[{tag}] ({where})\n{p.text}")
        sources[tag] = {
            "document_id": p.document_id,
            "document_title": p.document_title,
            "location": p.location,
            "text": p.text[:EXCERPT_CHARS],
        }
    return Batch(context="\n\n".join(parts), sources=sources)


def _topic_passages(documents: List[Document], topics: List[str]) -> List[Passage]:
    titles = {d.id: d.title for d in documents}
    seen, passages = set(), []
    for topic in topics:
        for chunk in rag_service.search(topic, [d.id for d in documents], top_k=4):
            meta = chunk.get("metadata") or {}
            text = (chunk.get("text") or "").strip()
            key = text[:80]
            if not text or key in seen:
                continue
            seen.add(key)
            doc_id = meta.get("document_id", "")
            passages.append(Passage(doc_id, titles.get(doc_id, meta.get("title", "")), meta.get("location", ""), text[:PASSAGE_CHARS]))
    return passages


def sample_batches(
    documents: List[Document],
    n_batches: int,
    sections: Optional[List[str]] = None,
    topics: Optional[List[str]] = None,
    salt: int = 0,
) -> List[Batch]:
    """
    Contexts for `n_batches` generation calls.

    - topics: passages most relevant to those topics (semantic search)
    - sections: only those labelled sections/pages (applied to every document)
    - otherwise: the whole of every document, split proportionally to document length
    """
    n_batches = max(1, n_batches)
    if topics:
        passages = _topic_passages(documents, topics)
        if passages:
            return [_batch_from(w) for w in _rotate_for_variety(_windows(passages, n_batches), salt)]

    per_doc = {d.id: _passages_for(d, sections) for d in documents}
    per_doc = {k: v for k, v in per_doc.items() if v}
    if not per_doc:
        # Sections matched nothing (or no segments): fall back to whole documents
        per_doc = {d.id: _passages_for(d) for d in documents}
        per_doc = {k: v for k, v in per_doc.items() if v}
    if not per_doc:
        fallback = [Passage(d.id, d.title, "", (d.content or "")[:BATCH_CONTEXT_CHARS]) for d in documents if (d.content or "").strip()]
        return [_batch_from(fallback[i % len(fallback):i % len(fallback) + 1]) for i in range(n_batches)] if fallback else []

    # Split batches across documents in proportion to their length (at least one each when possible)
    sizes = {k: sum(len(p.text) for p in v) for k, v in per_doc.items()}
    total = sum(sizes.values()) or 1
    alloc = {k: max(1, round(n_batches * s / total)) for k, s in sizes.items()}
    while sum(alloc.values()) > n_batches and any(v > 1 for v in alloc.values()):
        biggest = max((k for k in alloc if alloc[k] > 1), key=lambda k: alloc[k])
        alloc[biggest] -= 1
    while sum(alloc.values()) < n_batches:
        biggest = max(sizes, key=lambda k: sizes[k] / alloc[k])
        alloc[biggest] += 1

    windows: List[List[Passage]] = []
    for doc_id, count in alloc.items():
        windows.extend(_windows(per_doc[doc_id], count))
    windows = _rotate_for_variety(windows, salt)
    # Interleave so a short quiz from several documents still mixes them
    return [_batch_from(w) for w in windows[:n_batches]] if len(windows) >= n_batches else \
        [_batch_from(windows[i % len(windows)]) for i in range(n_batches)]


def passage_batch(source: Optional[Dict], fallback: Optional[Batch] = None) -> Optional[Batch]:
    """A one-passage batch from a question's saved source (used to regenerate that question)."""
    if source and source.get("text"):
        p = Passage(source.get("document_id", ""), source.get("document_title", ""), source.get("location", ""), source["text"])
        return _batch_from([p])
    return fallback
