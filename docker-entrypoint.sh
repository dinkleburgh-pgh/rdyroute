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

exec "$@"
