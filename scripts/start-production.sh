#!/bin/sh
set -eu

cd /app/web
# Refuse ephemeral storage or a deployment that would bypass the public form limit.
if ! mountpoint -q /data; then
  echo "Mount the Streetlight persistent volume at /data before starting." >&2
  exit 1
fi
STREETLIGHT_DATABASE_PATH="$(realpath -m "${STREETLIGHT_DATABASE_PATH:?Set the persistent database path}")"
export STREETLIGHT_DATABASE_PATH
case "$STREETLIGHT_DATABASE_PATH" in
  /data/*) ;;
  *) echo "STREETLIGHT_DATABASE_PATH must be on the /data volume." >&2; exit 1 ;;
esac
if [ "${STREETLIGHT_TRUST_CLOUDFLARE:-}" != "1" ]; then
  echo "Configure the Cloudflare-only deployment before starting." >&2
  exit 1
fi

node db/migrate.mjs
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
