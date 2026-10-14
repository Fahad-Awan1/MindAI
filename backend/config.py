from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

# Directory containing this file. Relative paths in settings are resolved
# against it so the server works no matter which directory it is started from.
BASE_DIR = Path(__file__).resolve().parent


def resolve_path(path: str) -> str:
    """Resolve a (possibly relative) path against the backend directory."""
    p = Path(path)
    if not p.is_absolute():
        p = BASE_DIR / p
    return str(p.resolve())


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    Role:
    - validating environment variables.
    - providing default values for configuration.
    - managing sensitive keys (API keys, secrets).
    """

    groq_api_key: str
    secret_key: str = ""  # Signs login tokens; generated automatically when not set
    # Sessions last this long without opening the app; every visit renews them (POST /api/auth/refresh)
    access_token_expire_days: int = 60
    PROJECT_NAME: str = "MindAI API"
    VERSION: str = "1.0.0"
    database_url: str = "sqlite:///./mindai.db"
    upload_dir: str = "./uploads"
    chroma_persist_dir: str = "./chroma_db"

    # CORS settings
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        # The Android app (Capacitor) loads MindAI from these origins
        "https://localhost",
        "capacitor://localhost",
    ]

    # Email (verification and password-reset codes). Gmail: smtp.gmail.com + an App password.
    # Later with your own domain (e.g. Resend): smtp.resend.com, user "resend", the API key as password.
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = ""  # Sender address; defaults to smtp_user
    mail_from_name: str = "MindAI"
    # Without SMTP settings emails are printed to the console; a folder here also keeps a copy of each (tests)
    email_outbox_dir: str = ""

    # Google sign-in: OAuth client IDs whose ID tokens are accepted (comma separated; the Web client ID)
    google_client_ids: str = ""

    # RAG settings
    chunk_size: int = 500
    chunk_overlap: int = 50
    embedding_model: str = "all-MiniLM-L6-v2"
    top_k_results: int = 5

    # Groq settings (llama-3.3-70b-versatile was retired by Groq)
    groq_model: str = "openai/gpt-oss-120b"
    # Reasoning effort for gpt-oss models (low keeps responses fast and leaves token budget for the answer)
    groq_reasoning_effort: str = "low"

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def resolved_database_url(self) -> str:
        """Database URL with a relative SQLite path resolved against the backend dir."""
        prefix = "sqlite:///"
        if self.database_url.startswith(prefix):
            db_path = self.database_url[len(prefix):]
            if db_path and db_path != ":memory:":
                return prefix + resolve_path(db_path)
        return self.database_url

    @property
    def resolved_upload_dir(self) -> str:
        return resolve_path(self.upload_dir)

    @property
    def resolved_chroma_dir(self) -> str:
        return resolve_path(self.chroma_persist_dir)


SECRET_KEY_FILE = BASE_DIR / ".secret_key"
_PLACEHOLDER_SECRETS = {"", "your_secret_key_here", "your_secret_key_for_jwt_here", "your_secret_key", "changeme"}


def _token_secret(configured: str) -> str:
    """
    Secret used to sign login tokens.

    Uses SECRET_KEY from .env when it is set to a real value; otherwise generates a random key
    once and keeps it in backend/.secret_key so logins survive restarts.
    """
    if configured and configured.strip() not in _PLACEHOLDER_SECRETS and len(configured.strip()) >= 16:
        return configured.strip()
    if SECRET_KEY_FILE.exists():
        stored = SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
        if stored:
            return stored
    import secrets
    generated = secrets.token_hex(32)
    SECRET_KEY_FILE.write_text(generated, encoding="utf-8")
    return generated


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    settings = Settings()
    settings.secret_key = _token_secret(settings.secret_key)
    return settings
