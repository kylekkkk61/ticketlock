#!/usr/bin/env bash
# One-time setup for a small Ubuntu host that runs the demo: Node 24, pnpm, cloudflared,
# swap for the 1 GB instance, and the two systemd services. Run as root on the host.
set -euo pipefail

APP_DIR=/opt/ticketlock-demo

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates git sqlite3
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
npm install -g pnpm@12.21.0

mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  > /etc/apt/sources.list.d/cloudflared.list
apt-get update -y && apt-get install -y cloudflared

id ticketlock >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin ticketlock
mkdir -p "$APP_DIR" /etc/cloudflared
chown -R ticketlock:ticketlock "$APP_DIR"

install -m 0644 "$(dirname "$0")/ticketlock-app.service" /etc/systemd/system/ticketlock-app.service
install -m 0644 "$(dirname "$0")/ticketlock-tunnel.service" /etc/systemd/system/ticketlock-tunnel.service
systemctl daemon-reload
echo "Provisioned. Node $(node -v), pnpm $(pnpm -v), $(cloudflared --version | head -1)"
