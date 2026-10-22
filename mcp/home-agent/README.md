# Home transcript agent — runbook for `io` (Arch Linux)

## What lives where

| Piece | Where it runs | Address | Who created it |
| --- | --- | --- | --- |
| MCP server (what Claude talks to) | Vercel, project **`fabric`**, team FRAQTIV | `https://fabric-theta-murex.vercel.app/mcp/<MCP_PATH_TOKEN>` | Josh (Vercel import), code in this repo `mcp/` |
| Transcript agent (`fabric --serve` + yt-dlp) | `io`, systemd unit `fabric-agent` | `http://127.0.0.1:8080` on `io` only | `install.sh` below |
| Tunnel (public HTTPS → port 8080 on `io`) | `io`, systemd unit `cloudflared-quick` | `https://<random-words>.trycloudflare.com` — **Cloudflare assigns it; `install.sh` prints it** | `install.sh` below |
| Pattern library | GitHub, this repo, branch `main` | read live by the MCP server | already there |

Nothing is hosted on `fraqtiv.com`. `fraqtiv.com`'s DNS is at Vercel, not Cloudflare, so it cannot carry a
Cloudflare tunnel hostname; that is why the tunnel uses a Cloudflare-assigned `trycloudflare.com` address.

Secrets (never commit them):

| Name | Lives in | Used by |
| --- | --- | --- |
| `MCP_PATH_TOKEN` | Vercel → project `fabric` → Settings → Environment Variables | the connector URL path |
| `HOME_AGENT_API_KEY` | same place on Vercel **and** `/etc/fabric-agent.env` on `io` as `FABRIC_API_KEY` (same value) | Vercel → `io` requests |
| `HOME_AGENT_URL` | Vercel → project `fabric` → Environment Variables | the tunnel address from `install.sh` |

## Install on `io` (one time, ~10 minutes)

Prerequisite: the value of `HOME_AGENT_API_KEY` from Vercel (Settings → Environment Variables → the eye icon).

```bash
git clone https://github.com/FRAQTIV/Fabric.git ~/Fabric      # or: cd ~/Fabric && git pull
cd ~/Fabric/mcp/home-agent
FABRIC_API_KEY=<paste HOME_AGENT_API_KEY here> ./install.sh
```

The script: `pacman -S go yt-dlp deno cloudflared`, builds `fabric` into `/usr/local/bin`, writes the key to
`/etc/fabric-agent.env`, enables `fabric-agent` and `cloudflared-quick`, and ends with:

```
fabric-agent: active
cloudflared-quick: active
HOME_AGENT_URL:     https://<random-words>.trycloudflare.com
HOME_AGENT_API_KEY: <the key>
```

## Connect Vercel to `io`

1. Vercel → project `fabric` → Settings → Environment Variables → `HOME_AGENT_URL` → set it to the
   `HOME_AGENT_URL` line printed above (with `https://`, nothing after `.com`) → Save.
2. Vercel → Deployments → latest Production deployment → ⋯ → **Redeploy**. Env changes only reach a new deployment.
3. Verify from anywhere (the `health` tool reports `home agent: ok`):

```bash
curl -s -X POST "https://fabric-theta-murex.vercel.app/mcp/<MCP_PATH_TOKEN>" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"health","arguments":{}}}'
```

## When the tunnel URL changes

A quick tunnel gets a new `trycloudflare.com` name whenever `cloudflared-quick` restarts (reboot, crash,
`systemctl restart`). systemd keeps it running otherwise. If `health` says the home agent is offline:

```bash
journalctl -u cloudflared-quick -o cat | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

Put the new value into `HOME_AGENT_URL` on Vercel and Redeploy (steps 1–2 above).

A permanent name needs a domain whose DNS is on Cloudflare (`fraqtiv.com` is not; it is on Vercel). If one is
available: Cloudflare dashboard → Networking → Tunnels → Create a tunnel → copy the token → on `io` run
`CLOUDFLARE_TUNNEL_TOKEN=<token> FABRIC_API_KEY=<key> ./install.sh` → tunnel → Routes → Add route → Published
application → Hostname `fabric-agent` + that domain, Service URL `http://localhost:8080` → Add route.
`HOME_AGENT_URL` is then `https://fabric-agent.<that domain>` and never changes.

## Operate

```bash
systemctl status fabric-agent cloudflared-quick
journalctl -u fabric-agent -f
sudo nano /etc/fabric-agent.env && sudo systemctl restart fabric-agent     # key or yt-dlp args
sudo pacman -Syu yt-dlp                                                   # YouTube changes often
```

Local check on `io`:

```bash
curl -s -X POST http://127.0.0.1:8080/youtube/transcript \
  -H "X-API-Key: $(sudo sed -n 's/^FABRIC_API_KEY=//p' /etc/fabric-agent.env)" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/URCUAj1bt28","language":"en"}' | head -c 300
```

If YouTube answers "Sign in to confirm you're not a bot": in `/etc/fabric-agent.env` set
`FABRIC_EXTRA_ARGS=--yt-dlp-args "--cookies-from-browser firefox"` (a logged-in browser profile must exist
for the service user) and `sudo systemctl restart fabric-agent`.
