#!/usr/bin/env bash
# Installs the Fabric transcript agent + a Cloudflare quick tunnel as systemd services on Arch Linux.
# Run as the regular user that should own the agent (sudo is used where needed):
#   FABRIC_API_KEY=<key from Vercel's HOME_AGENT_API_KEY> ./install.sh
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$HERE/../.." && pwd)
AGENT_USER=${AGENT_USER:-$USER}
ENV_FILE=/etc/fabric-agent.env

echo "==> packages"
sudo pacman -S --needed --noconfirm go yt-dlp deno cloudflared

echo "==> build fabric from $REPO_DIR"
(cd "$REPO_DIR" && go build -o /tmp/fabric-build ./cmd/fabric)
sudo install -m 755 /tmp/fabric-build /usr/local/bin/fabric && rm -f /tmp/fabric-build
mkdir -p "$HOME/.config/fabric" && touch "$HOME/.config/fabric/.env"

echo "==> API key -> $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  key=${FABRIC_API_KEY:-$(openssl rand -hex 24)}
  printf 'FABRIC_API_KEY=%s\n# e.g. FABRIC_EXTRA_ARGS=--yt-dlp-args "--cookies-from-browser firefox"\nFABRIC_EXTRA_ARGS=\n' "$key" | sudo tee "$ENV_FILE" >/dev/null
  sudo chmod 600 "$ENV_FILE"
else
  echo "    exists, leaving as is"
fi

echo "==> systemd units"
sed "s/__USER__/$AGENT_USER/g; s#__HOME__#$HOME#g" "$HERE/fabric-agent.service" | sudo tee /etc/systemd/system/fabric-agent.service >/dev/null
sudo install -m 644 "$HERE/cloudflared-quick.service" /etc/systemd/system/cloudflared-quick.service
sudo systemctl daemon-reload
sudo systemctl enable --now fabric-agent.service cloudflared-quick.service

echo "==> waiting for the tunnel URL"
url=""
for _ in $(seq 1 30); do
  url=$(journalctl -u cloudflared-quick --no-pager -o cat 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n 1 || true)
  [ -n "$url" ] && break
  sleep 1
done

echo
echo "fabric-agent:      $(systemctl is-active fabric-agent)"
echo "cloudflared-quick: $(systemctl is-active cloudflared-quick)"
echo "HOME_AGENT_URL:    ${url:-<not found yet: journalctl -u cloudflared-quick -f>}"
echo "HOME_AGENT_API_KEY: $(sudo sed -n 's/^FABRIC_API_KEY=//p' "$ENV_FILE")"
echo
echo "Put HOME_AGENT_URL (and the key, if it was generated here) into the Vercel project and redeploy."
echo "Note: a quick tunnel gets a new URL on every restart; see README.md for a named tunnel."
