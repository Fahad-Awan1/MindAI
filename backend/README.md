# MindAI Backend

Backend API for MindAI, built with FastAPI.

## Features
- Document Processing (PDF, DOCX, PPTX, TXT, MD)
- RAG (Retrieval Augmented Generation) with ChromaDB
- LLM Integration (Groq, `openai/gpt-oss-120b` by default; set `GROQ_MODEL` to change)
- Chat with a single document or the whole knowledge base (history is saved)
- AI Features:
    - Flashcard Generation
    - Quiz Generation
    - Study Plan Creation
    - Mind Map Generation
    - Exam Paper Generation

## API Endpoints

### Documents

- `POST /api/documents/upload` - Upload document (PDF, DOCX, PPTX, TXT, MD; max 50 MB)
- `GET /api/documents` - List all documents
- `GET /api/documents/{doc_id}` - Get document by ID (includes the original file as base64)
- `DELETE /api/documents/{doc_id}` - Delete document

### Chat

- `POST /api/chat/document` - Chat with single document (RAG)
- `POST /api/chat/knowledge-base` - Chat with all documents (RAG)
- `GET /api/chat/history/{doc_id}` - Get chat history for document
- `GET /api/chat/history` - Get knowledge base chat history

### AI Features (each result is saved as a study set and returned)

- `POST /api/ai/flashcards` - Generate flashcards
- `POST /api/ai/quiz` - Generate quiz questions (`focus_weak_topics` for an adaptive quiz)
- `POST /api/ai/study-plan` - Generate a study plan
- `POST /api/ai/mind-map` - Generate a Mermaid mind map
- `POST /api/ai/exam-paper` - Generate an exam paper
- `POST /api/ai/audio-overview` - Generate a two-host podcast script (+ studio audio when Groq TTS is enabled)

### Study Sets, Progress & Spaced Repetition

- `GET /api/study-sets` · `GET/PATCH/DELETE /api/study-sets/{id}` - Saved quizzes, decks, plans, exams, maps, teach-backs, overviews
- `POST /api/study-sets/{id}/quiz-attempts` - Score a quiz attempt
- `POST /api/study-sets/{id}/exam-attempts` - AI-mark written exam answers
- `GET /api/study-sets/{id}/schedule` · `POST /api/study-sets/{id}/reviews` - SM-2 flashcard schedule / Again-Hard-Good-Easy reviews
- `GET /api/review/due` - Today's review queue across all decks
- `GET /api/topics?document_id=` - Quiz accuracy per topic (weakest first)
- `GET /api/progress` - Streaks, activity, accuracy trend, mastery, due cards

### Tutoring, Reader & Voice

- `POST /api/tutor/explain/stream` - Explain a wrong quiz answer (streaming, follow-ups)
- `GET /api/tutor/concepts` · `POST /api/tutor/teach-back` - Concept suggestions / grade an own-words explanation
- `GET /api/documents/{id}/segments` - Document text split by page/slide/section
- `POST /api/tutor/selection/stream` · `/selection/flashcards` · `/selection/quiz` - Actions on highlighted text
- `POST /api/voice/transcribe` · `POST /api/voice/speak` · `GET /api/voice/status` - Whisper speech-to-text / Orpheus text-to-speech
- `GET /api/audio/{set_id}` - Rendered audio overview (WAV)
- `GET /api/graph` - Concept graph across documents (`rebuild=true` to re-extract)

Chat streaming endpoints (`/api/chat/document/stream`, `/api/chat/knowledge-base/stream`) send NDJSON events:
`sources` (numbered passages), then `delta` text, then `done` (or `error`). Answers cite sources as `[n]`.

## Setup

Requires Python 3.13.

1. Create virtual environment:
```bash
python -m venv venv
.\venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment:
Copy `.env.example` to `.env` and set:
```
GROQ_API_KEY=your_key_here
```

4. Run server:
```bash
uvicorn main:app --reload
```

## API Documentation
Go to `http://localhost:8000/docs` for Swagger UI.
