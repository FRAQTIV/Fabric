#!/usr/bin/env bash
# Installs the Fabric transcript agent + a Cloudflare tunnel as systemd services on Arch Linux.
# Run as the regular user that should own the agent (sudo is used where needed):
#   FABRIC_API_KEY=<key from Vercel's HOME_AGENT_API_KEY> ./install.sh
# Permanent hostname (recommended): create a tunnel in Cloudflare Zero Trust, add a public hostname
# pointing at http://localhost:8080, and pass its token:
#   CLOUDFLARE_TUNNEL_TOKEN=<token> FABRIC_API_KEY=<key> ./install.sh
# Without a token, a quick tunnel is used (random *.trycloudflare.com URL that changes on restart).
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

echo "==> fabric-agent service"
sed "s/__USER__/$AGENT_USER/g; s#__HOME__#$HOME#g" "$HERE/fabric-agent.service" | sudo tee /etc/systemd/system/fabric-agent.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now fabric-agent.service

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "==> named tunnel (cloudflared.service, token from Cloudflare Zero Trust)"
  sudo systemctl disable --now cloudflared-quick.service 2>/dev/null || true
  sudo cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN"
  sudo systemctl enable --now cloudflared.service
  tunnel_unit=cloudflared
  url="https://<the public hostname you configured for the tunnel>"
else
  echo "==> quick tunnel (cloudflared-quick.service)"
  sudo install -m 644 "$HERE/cloudflared-quick.service" /etc/systemd/system/cloudflared-quick.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now cloudflared-quick.service
  tunnel_unit=cloudflared-quick
  echo "==> waiting for the tunnel URL"
  url=""
  for _ in $(seq 1 30); do
    url=$(journalctl -u cloudflared-quick --no-pager -o cat 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n 1 || true)
    [ -n "$url" ] && break
    sleep 1
  done
fi

echo
echo "fabric-agent: $(systemctl is-active fabric-agent)"
echo "$tunnel_unit: $(systemctl is-active "$tunnel_unit")"
echo "HOME_AGENT_URL:     ${url:-<not found yet: journalctl -u cloudflared-quick -f>}"
echo "HOME_AGENT_API_KEY: $(sudo sed -n 's/^FABRIC_API_KEY=//p' "$ENV_FILE")"
echo
echo "Put HOME_AGENT_URL (and the key, if it was generated here) into the Vercel project and redeploy."
[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ] || echo "Note: a quick tunnel gets a new URL on every restart; see README.md for a named tunnel."
