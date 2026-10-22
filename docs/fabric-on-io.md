# Fabric on `io` — how the transcript agent works

Reference for humans and for AI sessions running on `io` (Arch Linux). Everything here is the
actual deployment: real hostnames, real paths, real unit names. Secrets are named, never written out.

Color legend used in every diagram:

| Color | Meaning |
| --- | --- |
| Blue | runs on Vercel (cloud) |
| Green | runs on `io` |
| Orange | external service (Cloudflare edge, YouTube, GitHub, Claude/ChatGPT) |
| Red | secret — value lives only in the named store |
| Grey | file on disk |

## 1. Architecture — who talks to whom

```mermaid
flowchart LR
  subgraph legend["Legend"]
    direction LR
    L1["Vercel"]:::cloud
    L2["io"]:::io
    L3["External"]:::ext
    L4["Secret"]:::secret
    L5["File"]:::file
  end

  subgraph clients["Clients"]
    C1["Claude chat / Cowork"]:::ext
    C2["ChatGPT plugin"]:::ext
  end

  subgraph vercel["Vercel project fabric — fabric-theta-murex.vercel.app"]
    V1["mcp service<br/>mcp/server.ts → src/mcp.ts"]:::cloud
    V2[("env vars<br/>MCP_PATH_TOKEN<br/>HOME_AGENT_API_KEY<br/>HOME_AGENT_URL")]:::secret
  end

  subgraph gh["GitHub FRAQTIV/Fabric, branch main"]
    G1["data/patterns/NAME/system.md"]:::file
    G2["scripts/pattern_descriptions/<br/>pattern_descriptions.json"]:::file
  end

  subgraph cfe["Cloudflare edge"]
    T1["quick tunnel hostname<br/>RANDOM.trycloudflare.com"]:::ext
  end

  subgraph io["io — Arch Linux, residential IP"]
    I1["cloudflared-quick.service"]:::io
    I2["fabric-agent.service<br/>fabric --serve --address 127.0.0.1:8080"]:::io
    I3["yt-dlp + deno"]:::io
    I4[("/etc/fabric-agent.env<br/>FABRIC_API_KEY")]:::secret
  end

  Y["YouTube"]:::ext
  N["noembed.com<br/>title + channel"]:::ext

  C1 -- "MCP over HTTPS<br/>/mcp/MCP_PATH_TOKEN" --> V1
  C2 -- "MCP over HTTPS" --> V1
  V1 -. "reads at runtime" .-> V2
  V1 -- "GET raw.githubusercontent.com" --> G1
  V1 -- "GET (pattern index)" --> G2
  V1 -- "GET metadata" --> N
  V1 -- "POST /youtube/transcript<br/>header X-API-Key" --> T1
  T1 -- "outbound tunnel: io dials out,<br/>no inbound port on io" --> I1
  I1 -- "http://127.0.0.1:8080" --> I2
  I2 -. "compares key" .-> I4
  I2 -- "exec" --> I3
  I3 -- "auto-captions, VTT" --> Y

  classDef cloud fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
  classDef io fill:#dcfce7,stroke:#15803d,color:#14532d
  classDef ext fill:#ffedd5,stroke:#c2410c,color:#7c2d12
  classDef secret fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  classDef file fill:#f3f4f6,stroke:#4b5563,color:#1f2937
```

Key facts:

- `io` never accepts inbound connections. `cloudflared` opens an outbound connection to Cloudflare and
  requests are relayed back down it to `127.0.0.1:8080`.
- Access control is two keys: the path token on the Vercel URL, and `X-API-Key` on the hop into `io`.
- No LLM runs anywhere in this chain. The client model (Claude or ChatGPT) applies the pattern.

## 2. Files and processes on `io`

```mermaid
flowchart TB
  subgraph legend["Legend"]
    direction LR
    L2["process / unit"]:::io
    L4["secret"]:::secret
    L5["file"]:::file
    L6["runtime, transient"]:::tmp
  end

  subgraph systemd["systemd (enabled, multi-user.target)"]
    U1["fabric-agent.service<br/>User=AGENT_USER<br/>Restart=always, 5 s<br/>PrivateTmp=yes"]:::io
    U2["cloudflared-quick.service<br/>DynamicUser=yes<br/>Restart=always, 5 s"]:::io
  end

  subgraph bins["Binaries"]
    B1["/usr/local/bin/fabric<br/>built from ~/Fabric (go build ./cmd/fabric)"]:::file
    B2["/usr/bin/cloudflared  (pacman)"]:::file
    B3["/usr/bin/yt-dlp  (pacman)"]:::file
    B4["/usr/bin/deno  (pacman, JS runtime for yt-dlp)"]:::file
  end

  subgraph cfg["Configuration"]
    F1[("/etc/fabric-agent.env<br/>FABRIC_API_KEY=…<br/>FABRIC_EXTRA_ARGS=…  (optional)")]:::secret
    F2["~/.config/fabric/.env<br/>(AGENT_USER home; may be empty)"]:::file
    F3["/etc/systemd/system/fabric-agent.service"]:::file
    F4["/etc/systemd/system/cloudflared-quick.service"]:::file
    F5["~/Fabric  — git clone of FRAQTIV/Fabric<br/>~/Fabric/mcp/home-agent/install.sh"]:::file
  end

  subgraph run["Runtime"]
    R1["TCP 127.0.0.1:8080  (gin REST server)"]:::tmp
    R2["/tmp/fabric-youtube-VIDEOID/  (private tmp,<br/>VTT written then deleted per request)"]:::tmp
    R3["journald: journalctl -u fabric-agent<br/>journalctl -u cloudflared-quick  (holds the tunnel URL)"]:::tmp
  end

  F5 -- "install.sh writes" --> F1
  F5 -- "install.sh installs" --> F3
  F5 -- "install.sh installs" --> F4
  F5 -- "go build" --> B1
  F3 --> U1
  F4 --> U2
  U1 -- "EnvironmentFile" --> F1
  U1 -- "reads on start" --> F2
  U1 -- "ExecStart" --> B1
  B1 -- "listens" --> R1
  B1 -- "exec per request" --> B3
  B3 -. "uses" .-> B4
  B3 -- "writes" --> R2
  U2 -- "ExecStart --url http://127.0.0.1:8080" --> B2
  B2 -- "proxies to" --> R1
  U1 --> R3
  U2 --> R3

  classDef io fill:#dcfce7,stroke:#15803d,color:#14532d
  classDef secret fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  classDef file fill:#f3f4f6,stroke:#4b5563,color:#1f2937
  classDef tmp fill:#fef9c3,stroke:#a16207,color:#713f12
```

| Path | Owner | Purpose |
| --- | --- | --- |
| `/etc/fabric-agent.env` | root, mode 600 | `FABRIC_API_KEY` (must equal Vercel's `HOME_AGENT_API_KEY`); optional `FABRIC_EXTRA_ARGS` |
| `/etc/systemd/system/fabric-agent.service` | root | runs `fabric --serve --address 127.0.0.1:8080 $FABRIC_EXTRA_ARGS` |
| `/etc/systemd/system/cloudflared-quick.service` | root | runs `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080` |
| `/usr/local/bin/fabric` | root | Fabric binary built from the repo clone |
| `~/.config/fabric/.env` | AGENT_USER | Fabric's own config; present but empty is fine (no vendors needed) |
| `~/Fabric` | AGENT_USER | repo clone; `git pull` then re-run `install.sh` to upgrade |

## 3. One request, end to end

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant C as Claude / ChatGPT
  participant V as Vercel mcp service
  participant G as GitHub raw
  participant N as noembed.com
  participant T as Cloudflare tunnel
  participant F as fabric --serve on io
  participant Y as yt-dlp → YouTube

  U->>C: "Extract wisdom from https://youtu.be/URCUAj1bt28"
  C->>V: tools/call extract_wisdom {url}
  Note over V: path token checked first (wrong token → 404)
  par pattern
    V->>G: GET data/patterns/extract_wisdom/system.md
    G-->>V: system prompt (cached 10 min)
  and transcript
    V->>N: GET embed?url=…  (title, channel)
    N-->>V: JSON
    rect rgb(220, 252, 231)
      V->>T: POST /youtube/transcript {url, language:"en"} + X-API-Key
      T->>F: relayed to 127.0.0.1:8080
      F->>F: APIKeyMiddleware: sha256 compare, 401 on mismatch
      F->>Y: yt-dlp --write-auto-subs --skip-download --sub-format vtt --sub-langs en,en.*
      Y-->>F: VTT into /tmp/fabric-youtube-URCUAj1bt28 (deleted after read)
      F-->>T: 200 {transcript, videoId, title, description}
    end
    T-->>V: JSON (about 42 KB for this video, ~2 s)
  end
  V->>V: compose PATTERN + INPUT (title, channel, URL, transcript)
  V-->>C: one text block (~45 KB)
  C->>C: apply PATTERN to INPUT (the client's own model)
  C-->>U: SUMMARY, IDEAS, INSIGHTS, QUOTES, HABITS, FACTS, REFERENCES, TAKEAWAY, RECOMMENDATIONS
```

Green block = the part that runs on `io`. Timeouts: Vercel waits up to 100 s for the agent
(`TRANSCRIPT_TIMEOUT_MS`); `health` uses 10 s.

Tools the Vercel service exposes: `extract_wisdom(url, language?)`, `apply_pattern(url, pattern, language?)`,
`get_transcript(url, language?, timestamps?)`, `list_patterns(query?)`, `get_pattern(name)`, `health()`.
Only the first three reach `io`.

## 4. Service and tunnel lifecycle (state)

```mermaid
stateDiagram-v2
  [*] --> Installed: ./install.sh  (pacman, go build, units written)
  Installed --> Active: systemctl enable --now fabric-agent cloudflared-quick
  Active --> URLAssigned: cloudflared logs its RANDOM.trycloudflare.com URL
  URLAssigned --> Wired: HOME_AGENT_URL set in Vercel + Redeploy
  Wired --> Healthy: health tool reports home agent ok
  Healthy --> Stale: io reboot or cloudflared-quick restart (new URL)
  Stale --> URLAssigned: read URL from journalctl -u cloudflared-quick
  Healthy --> Down: fabric-agent exits
  Down --> Healthy: systemd restarts it after 5 s
  Healthy --> KeyMismatch: /etc/fabric-agent.env edited
  KeyMismatch --> Healthy: HOME_AGENT_API_KEY in Vercel updated + Redeploy

  classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
  classDef warn fill:#fef9c3,stroke:#a16207,color:#713f12
  classDef bad fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class Healthy,Wired,Active ok
  class Installed,URLAssigned warn
  class Stale,Down,KeyMismatch bad
```

The quick tunnel is the one piece of state that is **not** durable: its hostname is reassigned on
every `cloudflared` start. `fraqtiv.com` cannot host a permanent name because its DNS is at Vercel, not
Cloudflare; a permanent name needs a Cloudflare-hosted domain (see `mcp/home-agent/README.md`).

## 5. Troubleshooting — start from what `health` says

```mermaid
flowchart TD
  S(["health tool / curl says…"]):::start

  S --> A{"home agent: OFFLINE<br/>or Failed to parse URL"}
  S --> B{"home agent: reachable<br/>but API key rejected"}
  S --> C{"transcript error"}

  A --> A1["on io: systemctl status<br/>fabric-agent cloudflared-quick"]:::io
  A1 -->|both active| A2["journalctl -u cloudflared-quick -o cat<br/>#124; grep trycloudflare #124; tail -1"]:::io
  A2 --> A3["Vercel → HOME_AGENT_URL = that URL<br/>→ Redeploy"]:::cloud
  A1 -->|inactive| A4["sudo systemctl restart fabric-agent cloudflared-quick<br/>journalctl -u fabric-agent -n 50"]:::io

  B --> B1["/etc/fabric-agent.env FABRIC_API_KEY<br/>must equal Vercel HOME_AGENT_API_KEY"]:::secret
  B1 --> B2["fix one side, then<br/>restart fabric-agent or Redeploy"]:::cloud

  C --> C1{"message says"}
  C1 -->|"yt-dlp not found"| C2["sudo pacman -S yt-dlp deno"]:::io
  C1 -->|"Sign in to confirm you are not a bot"| C3["/etc/fabric-agent.env:<br/>FABRIC_EXTRA_ARGS=--yt-dlp-args #quot;--cookies-from-browser firefox#quot;<br/>sudo systemctl restart fabric-agent"]:::io
  C1 -->|"No captions were returned"| C4["video has no subtitles in that language;<br/>retry with language: es / de / …"]:::ext
  C1 -->|"timed out"| C5["sudo pacman -Syu yt-dlp<br/>(YouTube changes break old versions)"]:::io

  classDef start fill:#e0e7ff,stroke:#4338ca,color:#312e81
  classDef io fill:#dcfce7,stroke:#15803d,color:#14532d
  classDef cloud fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
  classDef secret fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  classDef ext fill:#ffedd5,stroke:#c2410c,color:#7c2d12
```

## 6. Commands an AI session on `io` can rely on

```bash
# status and logs
systemctl status fabric-agent cloudflared-quick
journalctl -u fabric-agent -f
journalctl -u cloudflared-quick -o cat | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1   # current tunnel URL

# local proof the agent works (no tunnel involved)
curl -s -X POST http://127.0.0.1:8080/youtube/transcript \
  -H "X-API-Key: $(sudo sed -n 's/^FABRIC_API_KEY=//p' /etc/fabric-agent.env)" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/URCUAj1bt28","language":"en"}' | head -c 300

# upgrade Fabric to the repo's main
cd ~/Fabric && git pull && cd mcp/home-agent && FABRIC_API_KEY="$(sudo sed -n 's/^FABRIC_API_KEY=//p' /etc/fabric-agent.env)" ./install.sh

# change yt-dlp behaviour
sudo nano /etc/fabric-agent.env && sudo systemctl restart fabric-agent
```

Do not: open port 8080 to the LAN or internet (the tunnel is the only intended path), put the API key
in the repo, or run `fabric --serve` without `--address 127.0.0.1:8080`.

Related: `mcp/README.md` (the Vercel service), `mcp/home-agent/README.md` (runbook and install script),
`mcp/chatgpt-plugin-prompt.md`.
