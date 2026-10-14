import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Optional, Tuple
from config import get_settings
import os
import threading

settings = get_settings()

# Bump when the chunk format changes; older documents are re-indexed automatically
CHUNK_VERSION = 2


class RAGService:
    """
    Service for Retrieval Augmented Generation (RAG).

    Role:
    - Manages ChromaDB persistent client.
    - Handles text splitting and embedding generation.
    - Stores document chunks and retrieves relevant context.

    Flow:
    - `add_document`: Splits text -> Embeds -> Stores in ChromaDB.
    - `search`: Embeds query -> Query ChromaDB -> Returns chunks.
    """

    def __init__(self):
        self.client = None
        self.collection = None
        self.embedding_model = None
        self.text_splitter = None
        self._initialized = False
        self._init_lock = threading.Lock()

    def _ensure_initialized(self):
        """Lazy initialization of ChromaDB - only when needed (thread-safe)."""
        if self._initialized:
            return

        with self._init_lock:
            if self._initialized:
                return
            try:
                # Initialize ChromaDB
                persist_dir = settings.resolved_chroma_dir
                os.makedirs(persist_dir, exist_ok=True)
                self.client = chromadb.PersistentClient(
                    path=persist_dir,
                    settings=ChromaSettings(anonymized_telemetry=False)
                )

                # Get or create collection
                self.collection = self.client.get_or_create_collection(
                    name="documents",
                    metadata={"hnsw:space": "cosine"}
                )

                # Initialize embedding model
                self.embedding_model = SentenceTransformer(settings.embedding_model)

                # Initialize text splitter
                self.text_splitter = RecursiveCharacterTextSplitter(
                    chunk_size=settings.chunk_size,
                    chunk_overlap=settings.chunk_overlap,
                    length_function=len,
                )

                self._initialized = True
            except Exception as e:
                print(f"Error initializing RAG service: {e}")
                raise

    def add_document(self, document_id: str, text: str, metadata: Optional[Dict] = None):
        """Add plain text (a single unlabelled segment) to the vector database."""
        self.add_segments(document_id, [(None, text)], metadata)

    def add_segments(self, document_id: str, segments: List[Tuple[Optional[str], str]], metadata: Optional[Dict] = None):
        """
        Add a document to the vector database.

        Flow:
        1. Initialize ChromaDB if needed.
        2. Split each labelled segment (page, slide, section) into chunks.
        3. Generate embeddings for chunks using `SentenceTransformer`.
        4. Store chunks with their location label so answers can cite them.
        """
        self._ensure_initialized()

        chunks: List[str] = []
        chunk_metadata: List[Dict] = []
        for segment_index, (label, text) in enumerate(segments):
            for piece in self.text_splitter.split_text(text or ""):
                if not piece.strip():
                    continue
                chunk_metadata.append({
                    **(metadata or {}),
                    "document_id": document_id,
                    "chunk_index": len(chunks),
                    "segment_index": segment_index,
                    "location": label or "",
                    "chunk_version": CHUNK_VERSION,
                })
                chunks.append(piece)

        if not chunks:
            print(f"No chunks generated for document: {document_id}")
            return

        embeddings = self.embedding_model.encode(chunks).tolist()
        chunk_ids = [f"{document_id}_chunk_{i}" for i in range(len(chunks))]

        # Upsert so re-indexing a document never fails on duplicate IDs
        self.collection.upsert(
            ids=chunk_ids,
            embeddings=embeddings,
            documents=chunks,
            metadatas=chunk_metadata
        )

        print(f"Added {len(chunks)} chunks for document {document_id}")

    def needs_reindex(self, document_id: str) -> bool:
        """True if the document's chunks are missing or were indexed without location labels."""
        self._ensure_initialized()
        try:
            result = self.collection.get(where={"document_id": document_id}, limit=1, include=["metadatas"])
        except Exception as e:
            print(f"Error checking index for {document_id}: {e}")
            return True
        metadatas = result.get("metadatas") or []
        return not metadatas or (metadatas[0] or {}).get("chunk_version") != CHUNK_VERSION

    def search(self, query: str, document_ids: Optional[List[str]] = None, top_k: Optional[int] = None) -> List[Dict]:
        """Search for relevant chunks using semantic similarity."""
        if top_k is None:
            top_k = settings.top_k_results

        try:
            self._ensure_initialized()

            # Generate query embedding
            query_embedding = self.embedding_model.encode(query).tolist()

            # Build where filter for specific documents
            where_filter = None
            if document_ids:
                where_filter = {"document_id": {"$in": list(document_ids)}}

            # Search in ChromaDB
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                where=where_filter
            )
        except Exception as e:
            # Fall back gracefully: callers use the raw document content instead
            print(f"Error searching vector database: {e}")
            return []

        # Format results
        chunks = []
        documents = (results or {}).get('documents') or []
        if documents and documents[0]:
            metadatas = (results.get('metadatas') or [[]])[0] or []
            distances = (results.get('distances') or [[]])[0] or []
            for i, doc in enumerate(documents[0]):
                chunks.append({
                    "text": doc,
                    "metadata": metadatas[i] if i < len(metadatas) and metadatas[i] else {},
                    "distance": distances[i] if i < len(distances) else 0
                })

        return chunks

    def delete_document(self, document_id: str):
        """Delete all chunks of a document from the vector database."""
        self._ensure_initialized()

        try:
            self.collection.delete(where={"document_id": document_id})
            print(f"Deleted chunks for document {document_id}")
        except Exception as e:
            print(f"Error deleting document from ChromaDB: {e}")

    def get_context(self, query: str, document_ids: Optional[List[str]] = None, include_sources: bool = False) -> str:
        """Get context string from relevant chunks for a query."""
        chunks = self.search(query, document_ids)

        if not chunks:
            return ""

        # Combine chunks into context
        context_parts = []
        for chunk in chunks:
            if include_sources:
                title = chunk['metadata'].get('title', 'Unknown document')
                context_parts.append(f"[Source: {title}]\n{chunk['text']}")
            else:
                context_parts.append(chunk['text'])

        return "\n\n".join(context_parts)


    def get_sources(self, query: str, document_ids: Optional[List[str]] = None) -> List[Dict]:
        """
        Numbered source passages for a query, for answers with citations.

        Each source: {n, document_id, document_title, location, text}.
        """
        sources = []
        for n, chunk in enumerate(self.search(query, document_ids), start=1):
            meta = chunk["metadata"] or {}
            sources.append({
                "n": n,
                "document_id": meta.get("document_id", ""),
                "document_title": meta.get("title", ""),
                "location": meta.get("location", ""),
                "text": chunk["text"],
            })
        return sources


def format_sources(sources: List[Dict], include_titles: bool = False) -> str:
    """Render numbered sources for the LLM prompt: "[1] (Title, Page 3)" followed by the passage."""
    blocks = []
    for source in sources:
        where = ", ".join(x for x in (source["document_title"] if include_titles else "", source["location"]) if x)
        header = f"[{source['n']}]" + (f" ({where})" if where else "")
        blocks.append(f"{header}\n{source['text']}")
    return "\n\n".join(blocks)


# Global RAG service instance
rag_service = RAGService()
