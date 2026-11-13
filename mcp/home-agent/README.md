# Home transcript agent — runbook for `io` (Arch Linux)

Diagrams of the whole system (architecture, files and processes on `io`, request sequence, state
lifecycle, troubleshooting): [`docs/fabric-on-io.md`](../../docs/fabric-on-io.md).

## What lives where

| Piece | Where it runs | Address | Who created it |
| --- | --- | --- | --- |
| MCP server (what Claude talks to) | Vercel, project **`fabric`**, team FRAQTIV | `https://fabric-theta-murex.vercel.app/mcp/<MCP_PATH_TOKEN>` | Josh (Vercel import), code in this repo `mcp/` |
| Transcript agent (`fabric --serve` + yt-dlp) | `io`, systemd unit `fabric-agent` | `http://127.0.0.1:8080` on `io` only | `install.sh` below |
| Funnel (public HTTPS → port 8080 on `io`) | `io`, Tailscale Funnel in `tailscaled` | `https://io.TAILNET.ts.net:8443`, **fixed; `install.sh` and `sudo tailscale funnel status` print it** | `install.sh` below |
| Pattern library | GitHub, this repo, branch `main` | read live by the MCP server | already there |

Nothing is hosted on `fraqtiv.com`. The public name comes from Tailscale (`<machine>.<tailnet>.ts.net`, with a
Let's Encrypt certificate that `tailscaled` manages), so no domain or DNS change is needed. It survives reboots
and restarts, and changes only if `io` is renamed or moves to another tailnet.

Secrets (never commit them):

| Name | Lives in | Used by |
| --- | --- | --- |
| `MCP_PATH_TOKEN` | Vercel → project `fabric` → Settings → Environment Variables | the connector URL path |
| `HOME_AGENT_API_KEY` | same place on Vercel **and** `/etc/fabric-agent.env` on `io` as `FABRIC_API_KEY` (same value) | Vercel → `io` requests |
| `HOME_AGENT_URL` | Vercel → project `fabric` → Environment Variables | the Funnel address from `install.sh` |

## Install on `io` (one time, ~10 minutes)

Prerequisites:

- The value of `HOME_AGENT_API_KEY` from Vercel (Settings → Environment Variables → the eye icon).
- `tailscaled` running and logged in on `io`, and the tailnet policy granting `io` the `funnel` node attribute
  (Tailscale admin → Access controls). Funnel only accepts ports 443, 8443 and 10000; 443 on `io` is already
  taken, so the agent uses 8443.

```bash
git clone https://github.com/FRAQTIV/Fabric.git ~/Fabric      # or: cd ~/Fabric && git pull
cd ~/Fabric/mcp/home-agent
FABRIC_API_KEY=<paste HOME_AGENT_API_KEY here> ./install.sh
```

The script: `pacman -S go yt-dlp deno`, builds `fabric` into `/usr/local/bin`, writes the key to
`/etc/fabric-agent.env`, enables `fabric-agent`, runs `tailscale funnel --bg --https=8443 http://127.0.0.1:8080`
(kept in `tailscaled`'s state, so it survives reboots), and ends with:

```
fabric-agent: active
HOME_AGENT_URL:     https://io.TAILNET.ts.net:8443
HOME_AGENT_API_KEY: <the key>
```

## Connect Vercel to `io`

1. Vercel → project `fabric` → Settings → Environment Variables → `HOME_AGENT_URL` → set it to the
   `HOME_AGENT_URL` line printed above (with `https://` and `:8443`, nothing after the port) → Save.
2. Vercel → Deployments → latest Production deployment → ⋯ → **Redeploy**. Env changes only reach a new deployment.
3. Verify from anywhere (the `health` tool reports `home agent: ok`):

```bash
curl -s -X POST "https://fabric-theta-murex.vercel.app/mcp/<MCP_PATH_TOKEN>" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"health","arguments":{}}}'
```

## If `health` says the home agent is offline

```bash
systemctl status fabric-agent tailscaled
sudo tailscale funnel status      # expect: https://io.TAILNET.ts.net:8443 (Funnel on) → http://127.0.0.1:8080
```

- 8443 missing from the Funnel list: `sudo tailscale funnel --bg --https=8443 http://127.0.0.1:8080`. If
  that fails, the tailnet policy lost the `funnel` node attribute for `io`. Moving `io` to a new tailnet does
  this; re-grant it in the policy.
- The name differs from `HOME_AGENT_URL` on Vercel (`io` was renamed or changed tailnet): put the new value into
  `HOME_AGENT_URL` and Redeploy (steps 1–2 above).

## Operate

```bash
systemctl status fabric-agent tailscaled
sudo tailscale funnel status
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
