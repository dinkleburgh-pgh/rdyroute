#!/bin/sh
# Entrypoint for the ReadyRoute V2 backend.
#
# If the postgres container hostname can't be resolved via DNS (common when the
# DB lives on a different Docker network, e.g. TrueNAS ix-postgres), the script
# queries the Docker socket to find its IP and injects it into /etc/hosts so
# SQLAlchemy can connect. No manual POSTGRES_NETWORK config required.
set -e

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ix-postgres-postgres-1}"

if ! getent hosts "$POSTGRES_CONTAINER" > /dev/null 2>&1; then
    if [ -S /var/run/docker.sock ]; then
        POSTGRES_IP=$(python3 /app/docker_resolve.py "$POSTGRES_CONTAINER" 2>/dev/null || true)
        if [ -n "$POSTGRES_IP" ]; then
            printf '[entrypoint] %s not resolvable — injecting %s into /etc/hosts\n' \
                "$POSTGRES_CONTAINER" "$POSTGRES_IP"
            printf '%s\t%s\n' "$POSTGRES_IP" "$POSTGRES_CONTAINER" >> /etc/hosts
        else
            printf '[entrypoint] WARN: could not discover IP for %s via Docker socket\n' \
                "$POSTGRES_CONTAINER"
        fi
    else
        printf '[entrypoint] WARN: %s unresolvable and Docker socket not mounted\n' \
            "$POSTGRES_CONTAINER"
    fi
fi

exec "$@"
