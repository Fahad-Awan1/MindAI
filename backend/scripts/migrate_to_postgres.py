"""
Copy MindAI's data from the local SQLite database into PostgreSQL (e.g. Neon), plus the uploaded files.

    venv\\Scripts\\python.exe scripts/migrate_to_postgres.py "postgresql://user:pass@host/db?sslmode=require"

- Creates the tables in PostgreSQL, then copies every table in dependency order (parents first).
- Uploaded documents and rendered audio are copied into the stored_files table, so a host whose disk is
  wiped on restart can bring them back.
- Refuses to copy into tables that already have rows (so it can't duplicate data); pass --replace to empty
  the PostgreSQL tables first.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, func, inspect, select  # noqa: E402

BATCH = 500


def clean(value):
    # PostgreSQL text can't hold NUL characters (text extracted from some PDFs has them)
    return value.replace("\x00", "") if isinstance(value, str) else value


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    target_url = args[0]
    replace = "--replace" in sys.argv

    # The local database (this backend's .env / default), opened before pointing the models anywhere else
    from config import get_settings, resolve_path
    settings = get_settings()
    source_url = settings.resolved_database_url
    if not source_url.startswith("sqlite"):
        sys.exit(f"The source should be the local SQLite database, not {source_url.split('@')[-1]}")

    from database import Base, _add_missing_columns  # noqa: F401 - brings the local schema up to date first
    import models  # noqa: F401 - registers every table
    _add_missing_columns()

    source = create_engine(source_url)
    target = create_engine(target_url, pool_pre_ping=True)
    Base.metadata.create_all(target)

    source_tables = set(inspect(source).get_table_names())
    tables = [t for t in Base.metadata.sorted_tables if t.name != "stored_files"]

    with target.begin() as conn:
        busy = [t.name for t in tables if conn.execute(select(func.count()).select_from(t)).scalar()]
        if busy and not replace:
            sys.exit(f"PostgreSQL already has data in: {', '.join(busy)}. Run again with --replace to overwrite it.")
        if replace:
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(table.delete())

    total = 0
    for table in tables:
        if table.name not in source_tables:
            print(f"  {table.name}: not in the local database, skipped")
            continue
        present = {c["name"] for c in inspect(source).get_columns(table.name)}
        columns = [c for c in table.columns if c.name in present]
        with source.connect() as src:
            rows = [dict(r._mapping) for r in src.execute(select(*columns))]
        rows = [{k: clean(v) for k, v in row.items()} for row in rows]
        with target.begin() as dst:
            for i in range(0, len(rows), BATCH):
                dst.execute(table.insert(), rows[i:i + BATCH])
        total += len(rows)
        print(f"  {table.name}: {len(rows)} rows")

    # Files: uploaded documents and rendered audio overviews
    stored = Base.metadata.tables["stored_files"]
    documents = Base.metadata.tables["documents"]
    study_sets = Base.metadata.tables["study_sets"]
    paths = set()
    with source.connect() as src:
        paths.update(p for (p,) in src.execute(select(documents.c.file_path)) if p)
        for (data,) in src.execute(select(study_sets.c.data).where(study_sets.c.kind == "audio_overview")):
            audio = (json.loads(data or "{}") or {}).get("audio") or {}
            if audio.get("file"):
                paths.add(audio["file"])
    copied = missing = 0
    with target.begin() as dst:
        for path in sorted(paths):
            absolute = resolve_path(path)
            if not os.path.exists(absolute):
                missing += 1
                continue
            with open(absolute, "rb") as f:
                dst.execute(stored.insert(), [{"path": path, "data": f.read(), "created_at": int(time.time() * 1000)}])
            copied += 1
    print(f"  stored_files: {copied} files copied" + (f" ({missing} missing on disk)" if missing else ""))
    print(f"Done: {total} rows copied to {target_url.split('@')[-1].split('?')[0]}")


if __name__ == "__main__":
    main()
