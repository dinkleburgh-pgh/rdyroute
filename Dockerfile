# syntax=docker/dockerfile:1.6
# ---------------------------------------------------------------------------
# ReadyRoute V2 — FastAPI backend
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps: curl for healthchecks, build tools only if a wheel is missing.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps first for better layer caching.
COPY requirements.txt ./
RUN pip install --upgrade pip setuptools wheel \
 && pip install -r requirements.txt

# App source.
COPY . .

# Drop the venv / local sqlite if they were copied in by accident.
RUN rm -rf .venv .data __pycache__

# Persist sqlite + logs across container restarts when this dir is a volume.
RUN mkdir -p /app/.data
VOLUME ["/app/.data"]

EXPOSE 8000

# tini reaps zombie processes — important for uvicorn --reload children too.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
