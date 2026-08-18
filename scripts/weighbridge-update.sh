#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${WEIGHBRIDGE_APP_DIR:-/var/www/weighbridge-app}"
LOG_FILE="${WEIGHBRIDGE_UPDATE_LOG:-$APP_DIR/data/system-update.log}"
LOCK_FILE="${WEIGHBRIDGE_UPDATE_LOCK:-/tmp/weighbridge-update.lock}"

mkdir -p "$(dirname "$LOG_FILE")"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another weighbridge update is already running." | tee -a "$LOG_FILE"
  exit 1
fi

{
  echo ""
  echo "=== Update script started $(date -Is) ==="
  echo "Requested by: ${WEIGHBRIDGE_UPDATE_REQUESTED_BY:-unknown}"
  cd "$APP_DIR"
  git pull origin master
  npm install
  npm run build
  systemctl restart weighbridge
  systemctl status weighbridge --no-pager
  echo "=== Update script finished $(date -Is) ==="
} 2>&1 | tee -a "$LOG_FILE"
