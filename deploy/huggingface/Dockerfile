# MindAI backend on Hugging Face Spaces (Docker SDK). Built from backend/ by deploy/huggingface/deploy.py.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface

# Spaces run the container as user 1000
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

# CPU-only PyTorch first (the default wheel bundles ~2 GB of CUDA that a CPU Space can't use)
COPY requirements.txt .
RUN pip install torch==2.9.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

USER user
# The search model is downloaded at build time, so a restart doesn't wait for it
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY --chown=user . .

# The Space's disk is wiped on restart: the database lives in PostgreSQL (DATABASE_URL secret), uploaded files
# are restored from it on demand, and the search index is rebuilt from the documents at startup.
ENV UPLOAD_DIR=/home/user/app/uploads \
    CHROMA_PERSIST_DIR=/home/user/app/chroma_db

EXPOSE 7860
# --proxy-headers: behind the Spaces proxy, rate limits must see each visitor's own address
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
