#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# docker-entrypoint.sh — runtime TLS cert provisioning for the BridgeLink Web UI
# container.
#
# Generates a self-signed cert on first start if one isn't already present at
# $SSL_CERT_FILE / $SSL_KEY_FILE. This means:
#   - Every container instance gets a unique cert/key pair (no shared private
#     keys across deployments, which was the case when the cert was baked into
#     the image).
#   - Operators who want to use their own cert can mount it as a volume at
#     /app/certs (or wherever SSL_CERT_FILE/SSL_KEY_FILE points). If both files
#     exist on startup, this script does nothing.
#
# Exec'ing the final command keeps the node process as PID 1 so SIGTERM from
# `docker stop` reaches it directly for clean shutdown.
# ──────────────────────────────────────────────────────────────────────────────

set -e

# ── License acceptance gate — must run before ANY other action ──────
# Mirrors BridgeLink-WebAdmin-installer/installer-files/install.sh:151-182.
if [ -n "${BL_ACCEPT_LICENSE:-}" ] && [ "${BL_ACCEPT_LICENSE}" != "1" ]; then
    echo "[entrypoint] Error: BL_ACCEPT_LICENSE must be 1 (or unset)" >&2
    exit 1
fi

if [ "${BL_ACCEPT_LICENSE:-}" = "1" ]; then
    echo "[entrypoint] License terms accepted via BL_ACCEPT_LICENSE=1 (LICENSE, SUPPLEMENTAL-TERMS.md at /app/)"
else
    echo "" >&2
    echo "BridgeLink WebAdmin is licensed under the Business Source License 1.1" >&2
    echo "and the BridgeLink WebAdmin Supplemental Terms. Both documents are" >&2
    echo "included in this image:" >&2
    echo "  /app/LICENSE" >&2
    echo "  /app/SUPPLEMENTAL-TERMS.md" >&2
    echo "" >&2
    echo "To accept and start the container:" >&2
    echo "" >&2
    echo "  docker run -e BL_ACCEPT_LICENSE=1 ... innovarhc/bridgelink-web-ui:latest" >&2
    echo "" >&2
    echo "  # or in docker-compose.yml:" >&2
    echo "  environment:" >&2
    echo "    BL_ACCEPT_LICENSE: \"1\"" >&2
    echo "" >&2
    exit 1
fi

# ── Write webadmin.conf from environment ──────────────────────────────────────
CONF=/app/webadmin.conf

# Start from the baked-in defaults (already COPY'd into image).
# Overwrite individual keys if the corresponding env var is set.
# Supports: PORT, BRIDGELINK_SERVER_URL, BRIDGELINK_ALLOWED_SERVERS

update_conf() {
    KEY="$1"
    VAL="$2"
    # Escape characters special in sed replacement strings: \ & and the | delimiter
    ESCAPED_VAL=$(printf '%s' "$VAL" | sed 's/[\\&|]/\\&/g')
    if grep -q "^${KEY}=" "$CONF" 2>/dev/null; then
        sed -i "s|^${KEY}=.*|${KEY}=${ESCAPED_VAL}|" "$CONF"
    else
        printf '%s=%s\n' "$KEY" "$VAL" >> "$CONF"
    fi
}

[ -n "${PORT:-}" ]                       && update_conf PORT                       "$PORT"
[ -n "${BRIDGELINK_SERVER_URL:-}" ]      && update_conf BRIDGELINK_SERVER_URL      "$BRIDGELINK_SERVER_URL"
[ -n "${BRIDGELINK_ALLOWED_SERVERS:-}" ] && update_conf BRIDGELINK_ALLOWED_SERVERS "$BRIDGELINK_ALLOWED_SERVERS"

echo "[entrypoint] webadmin.conf:"
grep -v '^#' "$CONF" | grep -v '^$'

# ── TLS cert provisioning ─────────────────────────────────────────────────────
CERT_PATH="${SSL_CERT_FILE:-/app/certs/server.crt}"
KEY_PATH="${SSL_KEY_FILE:-/app/certs/server.key}"

if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  echo "[entrypoint] No TLS cert found — generating self-signed cert at $CERT_PATH"
  mkdir -p "$(dirname "$CERT_PATH")" "$(dirname "$KEY_PATH")"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY_PATH" \
    -out    "$CERT_PATH" \
    -days 825 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    >/dev/null 2>&1
  chmod 600 "$KEY_PATH"
else
  echo "[entrypoint] Using existing TLS cert at $CERT_PATH"
fi

exec "$@"
