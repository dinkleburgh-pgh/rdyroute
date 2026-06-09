#!/bin/sh
# Entrypoint for the ReadyRoute V2 backend.
#
# If the postgres container hostname can't be resolved via DNS (common when the
# DB lives on a different Docker network, e.g. TrueNAS ix-postgres), discover
# the postgres container's network via the Docker socket and attach ourselves
# to it. Once attached, Docker's built-in DNS resolves the hostname normally.
# No manual POSTGRES_NETWORK config required.
set -e

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ix-postgres-postgres-1}"

if ! getent hosts "$POSTGRES_CONTAINER" > /dev/null 2>&1; then
    if [ ! -S /var/run/docker.sock ]; then
        printf '[entrypoint] WARN: %s unresolvable and Docker socket not mounted\n' \
            "$POSTGRES_CONTAINER"
    else
        POSTGRES_NET=$(python3 /app/docker_resolve.py network "$POSTGRES_CONTAINER" 2>/dev/null || true)
        if [ -n "$POSTGRES_NET" ]; then
            printf '[entrypoint] attaching to %s network for %s\n' \
                "$POSTGRES_NET" "$POSTGRES_CONTAINER"
            if python3 /app/docker_resolve.py connect "$POSTGRES_NET" 2>&1; then
                # Give Docker a moment to wire up DNS on the new interface.
                i=0
                while [ $i -lt 20 ]; do
                    if getent hosts "$POSTGRES_CONTAINER" > /dev/null 2>&1; then
                        break
                    fi
                    sleep 0.25
                    i=$((i + 1))
                done
            fi
        fi

        if ! getent hosts "$POSTGRES_CONTAINER" > /dev/null 2>&1; then
            # Fallback: best-effort /etc/hosts injection.
            POSTGRES_IP=$(python3 /app/docker_resolve.py ip "$POSTGRES_CONTAINER" 2>/dev/null || true)
            if [ -n "$POSTGRES_IP" ]; then
                printf '[entrypoint] fallback: injecting %s %s into /etc/hosts\n' \
                    "$POSTGRES_IP" "$POSTGRES_CONTAINER"
                printf '%s\t%s\n' "$POSTGRES_IP" "$POSTGRES_CONTAINER" >> /etc/hosts
            else
                printf '[entrypoint] WARN: could not resolve %s via Docker socket\n' \
                    "$POSTGRES_CONTAINER"
            fi
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Postgres connection test — if DATABASE_URL targets postgres and it can't
# be reached, fall back to SQLite automatically and flag it for the health UI.
# ---------------------------------------------------------------------------
if [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -q "postgresql"; then
    _pg_ok=0
    _attempt=0
    while [ $_attempt -lt 4 ]; do
        _attempt=$((_attempt + 1))
        if python3 -c "
import sys, os
from urllib.parse import urlparse
url = os.environ['DATABASE_URL']
p = urlparse(url.replace('+psycopg','').replace('+asyncpg',''))
import psycopg
c = psycopg.connect(
    host=p.hostname,
    port=p.port or 5432,
    dbname=(p.path or '/').lstrip('/') or 'postgres',
    user=p.username,
    password=p.password,
    connect_timeout=5,
)
c.close()
" 2>/dev/null; then
            _pg_ok=1
            break
        fi
        if [ $_attempt -lt 4 ]; then
            printf '[entrypoint] postgres attempt %d/4 failed — retrying in 3s\n' "$_attempt"
            sleep 3
        fi
    done
    if [ $_pg_ok -eq 1 ]; then
        printf '[entrypoint] postgres connection OK — using %s\n' "$DATABASE_URL"
    else
        printf '[entrypoint] postgres unreachable after 4 attempts — falling back to SQLite\n'
        DATABASE_URL="sqlite:////app/.data/truckv2_prod.db"
        export DATABASE_URL
        export DB_FALLBACK_REASON="postgres unreachable at startup"
    fi
fi

exec "$@"
