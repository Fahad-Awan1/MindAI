from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base
from config import get_settings

settings = get_settings()

database_url = settings.resolved_database_url

if database_url.startswith("sqlite"):
    engine = create_engine(database_url, connect_args={"check_same_thread": False})
else:
    # Hosted PostgreSQL (Neon): it closes idle connections and may sleep, so test a pooled connection
    # before using it and recycle old ones instead of failing the request
    engine = create_engine(database_url, pool_pre_ping=True, pool_recycle=300, pool_size=5, max_overflow=5)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

if not database_url.startswith("sqlite"):
    from sqlalchemy import String, event
    from sqlalchemy.orm import Session

    @event.listens_for(Session, "before_flush")
    def _strip_nul_characters(session, flush_context, instances):
        """PostgreSQL text can't hold the NUL character, which text extracted from some PDFs contains."""
        for obj in list(session.new) + list(session.dirty):
            for column in obj.__table__.columns:
                if isinstance(column.type, String):  # Text is a String too
                    value = getattr(obj, column.key, None)
                    if isinstance(value, str) and "\x00" in value:
                        setattr(obj, column.key, value.replace("\x00", ""))

Base = declarative_base()


def get_db():
    """
    Dependency for getting a database session.

    Flow:
    1. Create a new SessionLocal instance.
    2. Yield the session to the requester.
    3. Ensure the session is closed after use (finally block).
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables and add columns introduced after a table was created."""
    import models  # noqa: F401 - imported to register the tables
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


# Columns added to existing tables after their first release: (table, column, SQL type)
_ADDED_COLUMNS = [
    ("chat_messages", "sources", "TEXT"),
    ("chat_messages", "persona", "VARCHAR"),
    # Accounts: owner of each row (existing rows are claimed by the first account created)
    ("documents", "user_id", "VARCHAR"),
    ("chat_messages", "user_id", "VARCHAR"),
    ("study_sets", "user_id", "VARCHAR"),
    ("study_activities", "user_id", "VARCHAR"),
    # Email verification: accounts that existed before it count as verified (DEFAULT 1 fills existing rows)
    ("users", "email_verified", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("users", "google_sub", "VARCHAR"),
    ("users", "token_version", "INTEGER NOT NULL DEFAULT 0"),
    # Chat history: each message belongs to a conversation (older messages are grouped into chats on first use)
    ("chat_messages", "conversation_id", "VARCHAR"),
]


def _add_missing_columns():
    """Minimal migration: create_all() never alters existing tables, so add new columns here."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, column, sql_type in _ADDED_COLUMNS:
            if table in inspector.get_table_names():
                existing = {c["name"] for c in inspector.get_columns(table)}
                if column not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))
                    print(f"Added column {table}.{column}")
        # Indexes for columns added above (create_all() only indexes tables it creates)
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_messages_conversation_id ON chat_messages (conversation_id)"))
