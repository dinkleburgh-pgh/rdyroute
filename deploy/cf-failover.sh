#!/bin/sh
# Cloudflare DNS failover watchdog for ReadyRoute USB standby.
#
# Runs continuously on the USB server. Every CHECK_INTERVAL seconds it checks
# the primary backend health endpoint. If it fails FAIL_THRESHOLD times in a
# row it:
#   1. Promotes the local standby postgres to primary (pg_promote via psql)
#   2. Updates the rdyroute.app Cloudflare A record to point at USB_IP
#
# When the primary recovers, it logs a WARNING but does NOT auto-revert.
# Auto-revert is intentionally manual because the TrueNAS postgres may have
# diverged and needs pg_rewind before being re-joined. Run:
#   docker exec readyroutev2-usb-failover /cf-failover.sh --revert
# once you have verified TrueNAS postgres is healthy and data is reconciled.
#
# Required env vars:
#   CF_ZONE_ID      — Cloudflare Zone ID for rdyroute.app
#   CF_API_TOKEN    — Cloudflare API token with Zone:DNS:Edit permission
#   USB_IP          — This server's public IP (standby target)
#   PGPASSWORD      — DB password for pg_promote call
#
# Optional env vars:
#   PRIMARY_HEALTH_URL  (default: http://73.117.168.91:8000/health)
#   DOMAIN              (default: rdyroute.app)
#   PRIMARY_IP          (default: 73.117.168.91)
#   DB_USER             (default: readyroute)
#   DB_NAME             (default: readyroute)
#   CHECK_INTERVAL      (default: 30)
#   FAIL_THRESHOLD      (default: 3)

set -e

PRIMARY_HEALTH_URL="${PRIMARY_HEALTH_URL:-http://73.117.168.91:8000/health}"
DOMAIN="${DOMAIN:-rdyroute.app}"
PRIMARY_IP="${PRIMARY_IP:-73.117.168.91}"
USB_IP="${USB_IP:?USB_IP must be set to this server's public IP}"
CF_ZONE_ID="${CF_ZONE_ID:?CF_ZONE_ID must be set}"
CF_API_TOKEN="${CF_API_TOKEN:?CF_API_TOKEN must be set}"
DB_USER="${DB_USER:-readyroute}"
DB_NAME="${DB_NAME:-readyroute}"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }
ok()   { curl -sf -m 8 "$1" >/dev/null 2>&1; }

cf_get_record_id() {
    curl -sf \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=A&name=${DOMAIN}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
    | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//'
}

cf_set_ip() {
    local new_ip="$1"
    local record_id
    record_id=$(cf_get_record_id)
    if [ -z "$record_id" ]; then
        log "ERROR: could not find Cloudflare A record for ${DOMAIN}"
        return 1
    fi
    curl -sf -X PUT \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${record_id}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"A\",\"name\":\"${DOMAIN}\",\"content\":\"${new_ip}\",\"ttl\":60,\"proxied\":true}" \
        >/dev/null
    log "Cloudflare DNS for ${DOMAIN} updated to ${new_ip}"
}

promote_standby() {
    log "Promoting local standby postgres to primary..."
    if psql -h db -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT pg_is_in_recovery()" | grep -q t; then
        psql -h db -U "$DB_USER" -d "$DB_NAME" -c "SELECT pg_promote(true, 60)" >/dev/null
        log "Standby promoted to primary successfully"
    else
        log "Postgres is already primary (not in recovery) — skipping promotion"
    fi
}

# --revert flag for manual DNS revert after TrueNAS is restored
if [ "${1:-}" = "--revert" ]; then
    log "Manual revert: updating Cloudflare DNS for ${DOMAIN} back to primary (${PRIMARY_IP})..."
    cf_set_ip "$PRIMARY_IP"
    log "Done. You must also manually reconfigure the TrueNAS postgres as a standby replica."
    exit 0
fi

log "Failover watchdog started."
log "  Primary health:  ${PRIMARY_HEALTH_URL}"
log "  Domain:          ${DOMAIN}"
log "  Primary IP:      ${PRIMARY_IP}"
log "  USB IP:          ${USB_IP}"
log "  Check interval:  ${CHECK_INTERVAL}s  Fail threshold: ${FAIL_THRESHOLD}"

fails=0
failed_over=false

while true; do
    if ok "$PRIMARY_HEALTH_URL"; then
        if [ "$failed_over" = "true" ]; then
            log "WARNING: Primary is back up but auto-revert is disabled."
            log "         Verify TrueNAS postgres state, then run:"
            log "           docker exec readyroutev2-usb-failover /cf-failover.sh --revert"
        fi
        fails=0
    else
        fails=$((fails + 1))
        log "Primary health check FAILED (${fails}/${FAIL_THRESHOLD})"

        if [ "$fails" -ge "$FAIL_THRESHOLD" ] && [ "$failed_over" = "false" ]; then
            log "FAILOVER TRIGGERED — primary appears down"
            promote_standby
            cf_set_ip "$USB_IP"
            failed_over=true
            log "Failover complete. Traffic for ${DOMAIN} now routes to USB (${USB_IP})."
            log "standby.${DOMAIN} remains always available as a direct URL."
        fi
    fi

    sleep "$CHECK_INTERVAL"
done
