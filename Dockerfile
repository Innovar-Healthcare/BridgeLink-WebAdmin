# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG BETA_MODE=""
RUN BETA_MODE="$BETA_MODE" npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# BridgeLink WebAdmin is licensed under the Business Source License 1.1 plus
# the BridgeLink WebAdmin Supplemental Terms. Surface the SPDX
# identifier on the image itself so it's visible via `docker inspect` and
# registry metadata without needing to run the container.
LABEL org.opencontainers.image.licenses="BUSL-1.1"

# openssl is needed at runtime so docker-entrypoint.sh can generate a unique
# self-signed cert per-container on first start (see docker-entrypoint.sh).
# Own /app itself (non-recursively) and /app/certs as node (UID 1000): WORKDIR
# creates /app root-owned and `COPY --chown` only sets ownership of copied
# *contents*, not the dir — but the entrypoint's `sed -i webadmin.conf` writes a
# temp file into /app, so /app must be node-writable. Non-recursive keeps the
# layer-dedup win of per-COPY --chown (no full-tree copy into a new layer).
RUN apk add --no-cache openssl && mkdir -p /app/certs && chown node:node /app /app/certs

ENV SSL_CERT_FILE=/app/certs/server.crt
ENV SSL_KEY_FILE=/app/certs/server.key

# Copy each layer already owned by node (UID 1000) via --chown, so we avoid a
# full-tree `chown -R /app` that would duplicate the whole app into a new layer.
# Use the standalone output (pruned node_modules) as the base
COPY --from=builder --chown=node:node /app/.next/standalone ./
# Override standalone's default server with the custom HTTPS-aware server
COPY --from=builder --chown=node:node /app/server.js ./server.js
# Copy static assets and public folder (not included in standalone by default)
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Cert provisioning happens at container start, not image build, so each
# instance has its own key. Operators may mount their own cert at /app/certs.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Bake the default webadmin.conf into the image so the entrypoint can read
# defaults and overwrite individual keys from env vars at container start.
# Owned by node (UID 1000) so it remains writable by `sed -i` at runtime.
COPY --chown=node:node webadmin.conf /app/webadmin.conf

# License documents (BSL 1.1 + Supplemental Terms) — required at container
# start by docker-entrypoint.sh's BL_ACCEPT_LICENSE gate.
COPY --chown=node:node LICENSE SUPPLEMENTAL-TERMS.md /app/

# Run as non-root for defense in depth. The official node:alpine image ships
# with a `node` user at UID 1000 — reuse it instead of creating our own.
USER node

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
