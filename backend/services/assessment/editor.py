"""Rewrite single questions: a fresh one, harder, easier, or a variant on the same concept."""
import asyncio
import random
from typing import Dict, List

from starlette.concurrency import run_in_threadpool

from services.assessment.budget import budget, estimate_tokens
from services.assessment.coverage import Passage, _batch_from, passage_batch, sample_batches
from services.assessment.generator import _ask
from services.assessment.prompts import build_regenerate_prompt
from services.assessment.schema import BLOOM_LEVELS, DIFFICULTIES
from services.assessment.validator import Deduper, _rescale_scheme, clean_question
from services.groq_service import AIServiceError
from services.rag_service import rag_service

CARRY_OVER = ("section_id", "parent_id", "parent_stem", "label")


def _shift(value: str, levels: List[str], step: int) -> str:
    i = levels.index(value) if value in levels else 1
    return levels[max(0, min(len(levels) - 1, i + step))]


async def regenerate_question(documents: list, original: Dict, mode: str, avoid: List[str]) -> Dict:
    """A replacement for `original`, written from the same part of the documents."""
    doc_ids = [d.id for d in documents]
    source = original.get("source") or {}
    search_ids = [source["document_id"]] if source.get("document_id") in doc_ids else doc_ids
    chunks = await run_in_threadpool(rag_service.search, original.get("question", ""), search_ids, 3)
    titles = {d.id: d.title for d in documents}
    passages = [
        Passage(c["metadata"].get("document_id", ""), titles.get(c["metadata"].get("document_id", ""), ""),
                c["metadata"].get("location", ""), c["text"][:1400])
        for c in chunks if c.get("text")
    ]
    batch = _batch_from(passages) if passages else passage_batch(source)
    if batch is None:
        batches = await run_in_threadpool(sample_batches, documents, 1)
        if not batches:
            raise AIServiceError("No readable text was found in the selected documents.")
        batch = batches[0]

    step = {"harder": 1, "easier": -1}.get(mode, 0)
    defaults = {
        "type": original.get("type", "mcq"),
        "difficulty": _shift(original.get("difficulty", "medium"), DIFFICULTIES, step),
        "bloom": _shift(original.get("bloom", "understand"), BLOOM_LEVELS, step),
        "marks": original.get("marks"),
        "section_id": original.get("section_id"),
    }
    deduper = Deduper(avoid + [original.get("question", "")])
    max_tokens = 3000 if defaults["type"] == "long" else 2000

    for _ in range(2):
        messages = build_regenerate_prompt({**original, **{k: v for k, v in defaults.items() if k in ("difficulty", "bloom")}},
                                           mode, batch.context, avoid)
        estimate = estimate_tokens(sum(len(m["content"]) for m in messages), max_tokens)
        wait = budget.wait_seconds(estimate)
        if wait > 0:
            await asyncio.sleep(min(wait, 45))
        handle = budget.reserve(estimate)
        for raw in await _ask(messages, max_tokens, handle):
            question, _ = clean_question(raw, [defaults["type"]], batch.sources, defaults, random.Random())
            if question and deduper.accept(question["question"]):
                for key in CARRY_OVER:
                    if original.get(key) is not None:
                        question[key] = original[key]
                if defaults["type"] in ("short", "long") and original.get("marks"):
                    question["marks"] = original["marks"]
                    question["marking_scheme"] = _rescale_scheme(question.get("marking_scheme") or [], original["marks"])
                return question
    raise AIServiceError("The AI couldn't write a valid replacement. Please try again.")
