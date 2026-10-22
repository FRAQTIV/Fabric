# Home transcript agent (Arch Linux / systemd)

Runs Fabric's REST server (`fabric --serve`) on a machine with a residential IP so the Vercel-hosted
`mcp` service can fetch YouTube captions through yt-dlp, and exposes it with a Cloudflare tunnel.
Nothing here is custom: the agent is this repository's own server binary.

```bash
git clone https://github.com/FRAQTIV/Fabric.git && cd Fabric/mcp/home-agent   # or git pull in an existing clone
FABRIC_API_KEY=<the HOME_AGENT_API_KEY value from the Vercel project> ./install.sh
```

What it does: installs `go yt-dlp deno cloudflared` with pacman, builds `fabric` to `/usr/local/bin`,
writes the key to `/etc/fabric-agent.env`, installs and starts two services, and prints the tunnel URL
to put into Vercel as `HOME_AGENT_URL` (then **Redeploy** in Vercel so the function picks it up).

| Unit | Role |
| --- | --- |
| `fabric-agent.service` | `fabric --serve --address 127.0.0.1:8080`, API key from `/etc/fabric-agent.env`, restarts on failure |
| `cloudflared-quick.service` | `cloudflared tunnel --url http://127.0.0.1:8080` (public HTTPS → localhost) |

Useful commands:

```bash
systemctl status fabric-agent cloudflared-quick
journalctl -u cloudflared-quick -o cat | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1   # current URL
journalctl -u fabric-agent -f
sudo systemctl restart fabric-agent              # after editing /etc/fabric-agent.env
```

Local check (same machine):

```bash
curl -s -X POST http://127.0.0.1:8080/youtube/transcript \
  -H "X-API-Key: $(sudo sed -n 's/^FABRIC_API_KEY=//p' /etc/fabric-agent.env)" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/URCUAj1bt28","language":"en"}' | head -c 300
```

## Stable hostname (named tunnel)

A quick tunnel gets a new `*.trycloudflare.com` URL whenever `cloudflared` restarts, which means
updating `HOME_AGENT_URL` in Vercel each time. If you have a domain on Cloudflare, use a named
tunnel instead (free):

```bash
cloudflared tunnel login                      # one-time browser auth
cloudflared tunnel create fabric-agent
cloudflared tunnel route dns fabric-agent fabric-agent.example.com
sudo mkdir -p /etc/cloudflared && sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: fabric-agent
credentials-file: $HOME/.cloudflared/$(cloudflared tunnel list -o json | jq -r '.[] | select(.name=="fabric-agent") | .id').json
ingress:
  - hostname: fabric-agent.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF
sudo systemctl disable --now cloudflared-quick
sudo cloudflared service install && sudo systemctl enable --now cloudflared
```

`HOME_AGENT_URL` is then `https://fabric-agent.example.com` and never changes.

## YouTube bot checks

If transcripts start failing with "Sign in to confirm you're not a bot", give yt-dlp a logged-in
browser's cookies: set `FABRIC_EXTRA_ARGS=--yt-dlp-args "--cookies-from-browser firefox"` in
`/etc/fabric-agent.env` (a browser profile must exist for the service user) and restart the agent.
Keeping `yt-dlp` current (`sudo pacman -Syu yt-dlp`) matters too; YouTube changes often.
