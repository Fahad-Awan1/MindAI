"""
Deploy the MindAI backend to a Hugging Face Space (Docker).

    backend\\venv\\Scripts\\python.exe deploy/huggingface/deploy.py --space Fahadriazdev/MindAI \\
        --token-file path/to/hf_token --database-url "postgresql://..."

- Uploads backend/ (without the local database, uploads, search index, virtualenvs, .env or tests)
  together with this folder's Dockerfile and README.md; the Space builds and starts it.
- Stores the settings as Space *secrets* (never in the code): the keys from backend/.env that the server
  needs, plus DATABASE_URL (PostgreSQL, e.g. Neon). --database-url can be left out on later deploys.
"""
import argparse
import shutil
import tempfile
from pathlib import Path

from dotenv import dotenv_values
from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
HERE = Path(__file__).resolve().parent

# Settings copied from backend/.env into Space secrets (paths are set by the Dockerfile instead)
SECRET_KEYS = ["GROQ_API_KEY", "SECRET_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
               "MAIL_FROM_NAME", "MAIL_FROM", "GOOGLE_CLIENT_IDS", "GROQ_MODEL"]
SKIP = shutil.ignore_patterns("venv*", ".env", ".env.*", "*.db", "*.db-*", "chroma_db", "uploads", "tests",
                              "__pycache__", "*.pyc", ".pytest_cache", ".ruff_cache", "outbox", "*.log")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--space", required=True, help="owner/name of the Space")
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--database-url", help="PostgreSQL URL (stored as the DATABASE_URL secret)")
    args = parser.parse_args()

    token = Path(args.token_file).read_text(encoding="utf-8").strip()
    api = HfApi(token=token)
    api.create_repo(args.space, repo_type="space", space_sdk="docker", exist_ok=True, private=False)

    env = dotenv_values(BACKEND / ".env")
    secrets = {k: env[k] for k in SECRET_KEYS if env.get(k)}
    if args.database_url:
        secrets["DATABASE_URL"] = args.database_url
    for key, value in secrets.items():
        api.add_space_secret(args.space, key, value)
    print(f"Secrets set: {', '.join(sorted(secrets))}")

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / "space"
        shutil.copytree(BACKEND, stage, ignore=SKIP)
        shutil.copy(HERE / "Dockerfile", stage / "Dockerfile")
        shutil.copy(HERE / "README.md", stage / "README.md")
        api.upload_folder(repo_id=args.space, repo_type="space", folder_path=str(stage),
                          commit_message="Deploy MindAI backend", delete_patterns=["*.py", "**/*.py"])
    owner, name = args.space.split("/")
    print(f"Uploaded. Building at https://huggingface.co/spaces/{args.space}")
    print(f"API address: https://{owner.lower()}-{name.lower().replace('_', '-')}.hf.space")


if __name__ == "__main__":
    main()
