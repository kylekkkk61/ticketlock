#!/usr/bin/env bash
# Ships the current checkout to the demo host and restarts the app.
# The 1 GB host cannot finish `next build`, so the build runs on this machine and the
# output is copied over. Usage: deploy/push.sh
set -euo pipefail

cd "$(dirname "$0")/.."
# The host (user@address) comes from the environment or from .env; it is not kept in git.
HOST=${TICKETLOCK_HOST:-$(grep -E '^TICKETLOCK_HOST=' .env 2>/dev/null | cut -d= -f2-)}
: "${HOST:?Set TICKETLOCK_HOST=user@address in .env}"
KEY=${TICKETLOCK_SSH_KEY:-$HOME/.ssh/ticketlock_azure}

pnpm build
sync_to() { rsync -az --delete -e "ssh -i $KEY" "$@"; }
sync_to --exclude node_modules --exclude .next --exclude data --exclude .env --exclude .git \
  --exclude contracts/artifacts --exclude contracts/cache --exclude contracts/types ./ "$HOST:src/"
sync_to --exclude cache --exclude dev web/.next/ "$HOST:next-build-out/"

ssh -i "$KEY" "$HOST" '
  set -e
  sudo rsync -a --delete --exclude data --exclude .env --exclude node_modules --exclude .next \
    --chown=ticketlock:ticketlock src/ /opt/ticketlock-demo/
  sudo -u ticketlock -H bash -c "cd /opt/ticketlock-demo && pnpm install --frozen-lockfile --filter @ticketlock/web" | tail -1
  sudo rsync -a --delete --chown=ticketlock:ticketlock next-build-out/ /opt/ticketlock-demo/web/.next/
  sudo install -m 0644 src/deploy/ticketlock-app.service src/deploy/ticketlock-tunnel.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl restart ticketlock-app
  sleep 6
  echo "app: $(systemctl is-active ticketlock-app), tunnel: $(systemctl is-active ticketlock-tunnel)"
'
