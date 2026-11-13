#!/usr/bin/env bash
# Installs the Fabric transcript agent as a systemd service on Arch Linux and publishes it with
# Tailscale Funnel at a fixed https://<machine>.<tailnet>.ts.net:8443 address.
# Run as the regular user that should own the agent (sudo is used where needed):
#   FABRIC_API_KEY=<key from Vercel's HOME_AGENT_API_KEY> ./install.sh
# Prerequisites: tailscaled is running and logged in, and the tailnet policy grants this machine the
# `funnel` node attribute. Funnel accepts ports 443, 8443 and 10000; set FUNNEL_PORT to change 8443.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$HERE/../.." && pwd)
AGENT_USER=${AGENT_USER:-$USER}
ENV_FILE=/etc/fabric-agent.env
FUNNEL_PORT=${FUNNEL_PORT:-8443}

echo "==> packages"
sudo pacman -S --needed --noconfirm go yt-dlp deno

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

echo "==> Tailscale Funnel :$FUNNEL_PORT -> 127.0.0.1:8080"
sudo tailscale funnel --bg --https="$FUNNEL_PORT" http://127.0.0.1:8080
# Funnel status prints port 443 without ":443".
suffix=":$FUNNEL_PORT"; [ "$FUNNEL_PORT" = 443 ] && suffix=""
url=$(sudo tailscale funnel status | grep -oE "^https://[^ :]+$suffix \(Funnel on\)" | head -n 1 | cut -d' ' -f1 || true)

echo
echo "fabric-agent: $(systemctl is-active fabric-agent)"
echo "HOME_AGENT_URL:     ${url:-<not found: sudo tailscale funnel status>}"
echo "HOME_AGENT_API_KEY: $(sudo sed -n 's/^FABRIC_API_KEY=//p' "$ENV_FILE")"
echo
echo "Put HOME_AGENT_URL (and the key, if it was generated here) into the Vercel project and redeploy."
echo "The address is fixed: it changes only if this machine is renamed or moves to another tailnet."
