# syntax=docker/dockerfile:1.6
# ---------------------------------------------------------------------------
# ReadyRoute V2 — FastAPI backend
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps: curl for healthchecks; pg_dump v18 from PGDG for backups.
# Pin base to bookworm; use dynamic codename so PGDG channel stays correct.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates tini gnupg; \
    . /etc/os-release; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-18; \
    rm -rf /var/lib/apt/lists/*

# Install Python deps first for better layer caching. Install from the pinned
# lock (not requirements.txt) so a rebuild of unchanged code can't silently
# resolve a newer/breaking release. requirements.txt is copied too so the
# top-level intent ships with the image; regenerate the lock deliberately (see
# the header in requirements.lock).
COPY requirements.txt requirements.lock ./
RUN pip install --upgrade pip setuptools wheel \
 && pip install -r requirements.lock

# App source.
COPY . .

# Bake the git commit SHA and build version into the image.
ARG GIT_SHA=unknown
ARG APP_VERSION=dev
ENV GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION

# Drop the venv / local sqlite if they were copied in by accident.
RUN rm -rf .venv .data __pycache__

# Persist sqlite + logs across container restarts when this dir is a volume.
RUN mkdir -p /app/.data

COPY docker-entrypoint.sh docker_resolve.py ./
RUN chmod +x /app/docker-entrypoint.sh

# Run as non-root. The data volume must be owned by this user.
# Add appuser to the docker group (GID 999) so it can read the Docker socket
# when /var/run/docker.sock is mounted. On hosts where docker group GID differs
# set DOCKER_GID build-arg accordingly.
ARG DOCKER_GID=999
RUN addgroup --system appgroup \
 && addgroup --system --gid ${DOCKER_GID} docker 2>/dev/null || true \
 && adduser --system --ingroup appgroup appuser \
 && adduser appuser docker 2>/dev/null || true \
 && chown -R appuser:appgroup /app/.data
USER appuser

EXPOSE 8000

VOLUME ["/app/.data"]

# tini reaps zombie processes — important for uvicorn --reload children too.
# docker-entrypoint.sh auto-resolves the postgres hostname via Docker socket
# if it isn't reachable via normal DNS (e.g. cross-network on TrueNAS).
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
