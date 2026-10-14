"""
Cross-document concept graph.

Each document's concepts and relations are extracted once (and again only when its text
changes), then merged: the same concept in several documents becomes a single node that
links those documents together.
"""
import asyncio
import hashlib
import json
import re
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from models import ConceptMap, Document
from services.groq_service import extract_concept_map
from services.study_service import now_ms

# One document at a time keeps extraction under the free tier's tokens-per-minute limit
_extract_limit = asyncio.Semaphore(1)


def content_hash(document: Document) -> str:
    return hashlib.sha1((document.content or "").encode("utf-8")).hexdigest()


def concept_key(name: str) -> str:
    """Normalize a concept name so variants merge ("Calvin Cycle", "calvin cycle", "the Calvin cycle")."""
    key = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    # Only drop a leading "the": "a"/"an" can be meaningful ("A/B Testing")
    return re.sub(r"^the ", "", re.sub(r"\s+", " ", key).strip())


async def ensure_concept_maps(db: Session, documents: List[Document], force: bool = False) -> List[str]:
    """Extract concept maps for documents that have none (or are outdated). Returns failed document IDs."""
    todo = []
    for document in documents:
        if not (document.content or "").strip():
            continue
        current = document.concept_map
        if force or current is None or current.content_hash != content_hash(document):
            todo.append(document)

    async def extract(document: Document):
        async with _extract_limit:
            return await extract_concept_map(document.content, document.title)

    results = await asyncio.gather(*[extract(d) for d in todo], return_exceptions=True)
    failed = []
    for document, result in zip(todo, results):
        if isinstance(result, Exception):
            print(f"Concept extraction failed for {document.id}: {result}")
            failed.append(document.id)
            continue
        if document.concept_map is None:
            document.concept_map = ConceptMap(document_id=document.id, content_hash="", data="{}", created_at=0)
        document.concept_map.content_hash = content_hash(document)
        document.concept_map.data = json.dumps(result)
        document.concept_map.created_at = now_ms()
    db.commit()
    return failed


def merge_graph(documents: List[Document]) -> Dict[str, Any]:
    """Merge per-document concept maps into one graph."""
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: Dict[tuple, Dict[str, Any]] = {}

    for document in documents:
        if document.concept_map is None:
            continue
        data = json.loads(document.concept_map.data)
        doc_ref = {"id": document.id, "title": document.title}
        for concept in data.get("concepts", []):
            key = concept_key(concept["name"])
            if not key:
                continue
            node = nodes.setdefault(key, {"id": key, "name": concept["name"], "description": "", "documents": []})
            if len(concept.get("description", "")) > len(node["description"]):
                node["description"] = concept["description"]
            if doc_ref not in node["documents"]:
                node["documents"].append(doc_ref)
        for relation in data.get("relations", []):
            source, target = concept_key(relation["source"]), concept_key(relation["target"])
            if source not in nodes or target not in nodes or source == target:
                continue
            pair = (source, target) if (target, source) not in edges else (target, source)
            edge = edges.setdefault(pair, {"source": pair[0], "target": pair[1], "label": relation["label"], "documents": []})
            if document.id not in edge["documents"]:
                edge["documents"].append(document.id)

    degree: Dict[str, int] = {key: 0 for key in nodes}
    for source, target in edges:
        degree[source] += 1
        degree[target] += 1
    for key, node in nodes.items():
        node["degree"] = degree[key]

    return {
        "nodes": sorted(nodes.values(), key=lambda n: -n["degree"]),
        "edges": list(edges.values()),
        "documents": [
            {
                "id": d.id,
                "title": d.title,
                "concepts": len(json.loads(d.concept_map.data).get("concepts", [])) if d.concept_map else 0,
                "mapped": d.concept_map is not None,
            }
            for d in documents
        ],
        "shared_concepts": sum(1 for n in nodes.values() if len(n["documents"]) > 1),
    }
