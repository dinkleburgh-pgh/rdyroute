#!/bin/sh
# Entrypoint for the ReadyRoute USB standby postgres container.
#
# On first boot (empty PGDATA):
#   - Waits for the primary to be reachable
#   - Runs pg_basebackup -R to clone the primary and auto-configure
#     postgresql.auto.conf with primary_conninfo + standby.signal
#   - Starts postgres in hot-standby mode (read-only)
#
# On subsequent boots:
#   - PGDATA is not empty → skips pg_basebackup → starts normally as standby
#
# Required env vars:
#   PRIMARY_HOST         — primary server hostname/IP (e.g. 73.117.168.91)
#   PRIMARY_PORT         — primary port (default 5432)
#   REPLICATION_PASSWORD — password for the replicator user
#
# Optional env vars:
#   REPLICATION_SLOT     — slot name on the primary (default: usb_standby)
set -e

PRIMARY_HOST="${PRIMARY_HOST:?PRIMARY_HOST must be set}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPLICATION_SLOT="${REPLICATION_SLOT:-usb_standby}"

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
    echo "[standby] PGDATA is empty — running initial pg_basebackup from primary..."

    # Wait until primary is reachable (up to 3 minutes)
    tries=0
    until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U replicator 2>/dev/null; do
        tries=$((tries + 1))
        if [ "$tries" -ge 60 ]; then
            echo "[standby] ERROR: primary not reachable after 3 minutes — aborting"
            exit 1
        fi
        echo "[standby] waiting for primary at ${PRIMARY_HOST}:${PRIMARY_PORT} (attempt ${tries}/60)..."
        sleep 3
    done

    echo "[standby] primary is up — cloning via pg_basebackup..."
    PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup \
        -h "$PRIMARY_HOST" \
        -p "$PRIMARY_PORT" \
        -U replicator \
        -D "$PGDATA" \
        -P \
        -Xs \
        -R \
        --slot="$REPLICATION_SLOT"

    # Ensure postgres owns the data directory
    chown -R postgres:postgres "$PGDATA" 2>/dev/null || true

    echo "[standby] pg_basebackup complete — starting as hot standby"
else
    echo "[standby] PGDATA exists — resuming standby"
fi

exec docker-entrypoint.sh postgres \
    -c hot_standby=on \
    -c hot_standby_feedback=on \
    -c listen_addresses=*
