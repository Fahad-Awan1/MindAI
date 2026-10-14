import sys
from contextlib import asynccontextmanager

# Never let console logging crash a request on Windows code pages (e.g. cp1252)
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:
        pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from config import get_settings
from routers import auth, documents, chat, ai_features, study_sets, tutor, voice, audio, graph, rooms, study_group, imports, assessment, exams, bank

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Execute startup tasks.

    Flow:
    1. Initialize the database tables using init_db().
    2. Print status messages to the console.
    """
    init_db()
    print("[OK] Database initialized")
    # Existing quizzes, exams and attempts go into the question bank once (skipped when already imported)
    from database import SessionLocal
    from services.assessment.bank import backfill
    db = SessionLocal()
    try:
        imported = backfill(db)
        if imported:
            print(f"[OK] Question bank: imported {imported} quizzes/exams")
    finally:
        db.close()
    # Imported here so the embedding model only loads once the app is starting
    from services.indexing import start_background_reindex
    from services.import_service import mark_interrupted_jobs
    mark_interrupted_jobs()
    start_background_reindex()
    print("[OK] MindAI API is ready")
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Also allow any local dev port (e.g. Vite falling back to 5174) and the Cloudflare tunnel address
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|https://[a-z0-9-]+\.trycloudflare\.com)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(ai_features.router)
app.include_router(study_sets.router)
app.include_router(tutor.router)
app.include_router(voice.router)
app.include_router(audio.router)
app.include_router(graph.router)
app.include_router(rooms.router)
app.include_router(study_group.router)
app.include_router(imports.router)
app.include_router(assessment.router)
app.include_router(exams.router)
app.include_router(bank.router)


@app.get("/")
def root():
    """Root endpoint."""
    return {
        "message": "Welcome to MindAI API",
        "version": settings.VERSION,
        "docs": "/docs"
    }


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
