# fabric-mcp — Fabric patterns + YouTube transcripts for Claude

A remote MCP server (a claude.ai **custom connector**) that lets Claude chat and Claude Cowork
fetch YouTube transcripts and apply Fabric patterns such as `extract_wisdom` — no browser involved.

```
Claude (chat / Cowork)
   │  MCP over HTTPS
   ▼
Vercel: mcp/  (this folder)          ──► raw.githubusercontent.com  (Fabric patterns)
   │  POST /youtube/transcript
   ▼
Cloudflare Tunnel ──► your home machine: `fabric --serve` + yt-dlp
```

Why two pieces: YouTube blocks caption downloads from cloud/datacenter IPs. `yt-dlp` works from a
residential connection, so transcripts are fetched by the Fabric REST server on **your** machine
and relayed through a tunnel. The Vercel part is always up; when the home machine is off, pattern
tools still work and transcript tools return a clear "home agent offline" error.

The server never calls an LLM. It hands Claude the transcript and the pattern's system prompt;
Claude does the reasoning, so there is no second model bill.

## Tools

| Tool | What it does |
| --- | --- |
| `extract_wisdom(url, language?)` | Transcript + the `extract_wisdom` pattern, ready to apply |
| `apply_pattern(url, pattern?, language?)` | Same, with any Fabric pattern (default `extract_wisdom`) |
| `get_transcript(url, language?, timestamps?)` | Just the transcript, with title and channel |
| `list_patterns(query?)` | Browse the 200+ Fabric patterns |
| `get_pattern(name)` | A pattern's system prompt, to apply to any text |
| `health()` | Are patterns and the home agent reachable? |

## 1. Home machine: transcript agent

**This deployment:** the agent runs on `io` (Arch Linux) — follow [`home-agent/README.md`](home-agent/README.md),
which has the exact hosts, names and steps. The manual steps below are the same thing by hand (macOS/other).

Needs Go 1.26+ (to build Fabric), plus `yt-dlp` and `deno` (yt-dlp's JavaScript runtime for YouTube) on `PATH`.

```bash
# yt-dlp + its JS runtime
brew install yt-dlp deno       # macOS   (Windows: winget install yt-dlp DenoLand.Deno ; Linux: pipx install yt-dlp + https://deno.land)

# Fabric from this repo (go.mod requires Go 1.26)
go install ./cmd/fabric        # or: go build -o fabric ./cmd/fabric
fabric --setup                 # once; creates ~/.config/fabric (you can skip configuring vendors)

# run the REST server with an API key of your choosing (flag --api-key or env FABRIC_API_KEY)
export FABRIC_API_KEY="$(openssl rand -hex 24)"
fabric --serve --address 127.0.0.1:8080
```

If YouTube answers "Sign in to confirm you're not a bot", let yt-dlp reuse your browser's cookies:
`fabric --serve --yt-dlp-args '--cookies-from-browser safari'` (or `chrome`, `firefox`, `brave`).

Sanity check from the same machine:

```bash
curl -s -X POST http://127.0.0.1:8080/youtube/transcript \
  -H "X-API-Key: $FABRIC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/URCUAj1bt28","language":"en"}' | head -c 300
```

### Expose it with a Cloudflare Tunnel

```bash
brew install cloudflared       # or https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
cloudflared tunnel --url http://127.0.0.1:8080
```

The quick tunnel prints a random `https://<words>.trycloudflare.com` URL — that is `HOME_AGENT_URL`.
Quick tunnels change their URL on every restart; for a stable hostname create a
[named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/get-started/create-remote-tunnel/)
on a domain you own and run it as a service so it survives reboots.

Keep both processes running (a `launchd`/systemd service, or a terminal multiplexer).

## 2. Vercel: the MCP server

The repository root carries a `vercel.json` that declares this folder as the `mcp` **service**
(Vercel multi-service project) and exposes it publicly at `/mcp/:token`; everything else in the
repo stays undeployed. Import the repository root as the project (not `mcp/`), and Vercel builds
only the declared service. `server.ts` is the service entrypoint Vercel's Node runtime looks for;
it checks the token and hands the request to the MCP handler.

Two project settings matter:

- **Deployment Protection → Vercel Authentication**: set to *Only Preview Deployments* (or off).
  New projects protect every deployment with a Vercel login, which Claude's connector cannot pass.
  The secret path token is the access control instead.
- Environment variables (Production):

| Variable | Value |
| --- | --- |
| `HOME_AGENT_URL` | the tunnel URL, e.g. `https://xyz.trycloudflare.com` |
| `HOME_AGENT_API_KEY` | the same key the home agent runs with (`FABRIC_API_KEY` / `--api-key`) |
| `MCP_PATH_TOKEN` | a long random secret, e.g. `openssl rand -hex 24` — becomes part of the connector URL |
| `PATTERNS_BASE_URL` | optional; default `https://raw.githubusercontent.com/FRAQTIV/Fabric/main` |

The MCP endpoint is `https://<project>.vercel.app/mcp/<MCP_PATH_TOKEN>` — for this deployment
(Vercel project `fabric`): `https://fabric-theta-murex.vercel.app/mcp/<MCP_PATH_TOKEN>`. Use the
project's production domain; with Standard Protection, team aliases such as `fabric-fraqtiv.vercel.app`
stay behind Vercel login.
Requests with a wrong or missing token get a 404. There is no OAuth; the secret path is the
access control, so treat the URL like a password. Leave `MCP_PATH_TOKEN` empty only for local testing.

## 3. Claude: add the connector

claude.ai → **Settings → Connectors → Add custom connector**

- Name: `Fabric`
- Remote MCP server URL: `https://<project>.vercel.app/mcp/<MCP_PATH_TOKEN>`
- Authentication: none

Enable it in a chat (or Cowork) and ask, for example:

> Extract wisdom from https://youtu.be/URCUAj1bt28

Claude calls `extract_wisdom`, receives the pattern + transcript, and produces the usual
SUMMARY / IDEAS / INSIGHTS / QUOTES / … output. Other patterns: "apply the `summarize` pattern to …",
or "list fabric patterns about writing".

## 4. ChatGPT (optional)

ChatGPT connects to remote MCP servers as a custom connector (app) — Custom GPT *Actions* do not apply, they need
a REST/OpenAPI backend. In ChatGPT: Settings → Connectors (Apps) → Advanced → enable **Developer mode** → Create →
name `Fabric`, MCP server URL `https://fabric-theta-murex.vercel.app/mcp/<MCP_PATH_TOKEN>`, authentication none
(exact labels change between releases). Then put these instructions in the project or custom GPT that uses it:

> You have the Fabric MCP connector. When the user gives a YouTube link and asks for wisdom, insights, a summary,
> or any Fabric pattern, call the matching tool instead of answering from memory: `extract_wisdom(url)` for
> wisdom; `apply_pattern(url, pattern)` for a named pattern (`list_patterns(query)` to find one; `get_pattern(name)`
> to read it); `get_transcript(url, timestamps?)` for the raw transcript. The tool returns a PATTERN section and an
> INPUT section: follow the PATTERN instructions exactly against the INPUT and present only the result, in
> Markdown. If a tool reports the home agent is offline, say so and offer pattern-only help with pasted text.
> Run `health` when asked whether the connector works.

The URL contains the access token: share it only with people who may use the server.

## Local development

```bash
cd mcp && npm install
npm run mock-agent                                     # terminal 1: fake home agent on :8080
HOME_AGENT_URL=http://localhost:8080 MCP_PATH_TOKEN=dev npm run dev   # terminal 2
MCP_PATH_TOKEN=dev npm run smoke                       # terminal 3: JSON-RPC round-trip
npm run typecheck
```

`vercel dev` from the repository root runs the service through the real `vercel.json` routing instead.

Point `HOME_AGENT_URL` at a real tunnel (and set `HOME_AGENT_API_KEY`) to test real transcripts.

## Troubleshooting

- **"home agent is unreachable"** — `fabric --serve` or `cloudflared` is not running, or the quick-tunnel URL
  changed after a restart (update `HOME_AGENT_URL` on Vercel). Run the `health` tool to see which.
- **"API key rejected"** — `HOME_AGENT_API_KEY` on Vercel ≠ `--api-key` on the home machine.
- **"yt-dlp not found in PATH"** — install yt-dlp on the home machine; make sure the `fabric` process can see it.
- **"Sign in to confirm you're not a bot"** — YouTube is challenging your IP; restart the agent with
  `--yt-dlp-args '--cookies-from-browser <browser>'` so yt-dlp uses your logged-in browser session.
- **"No captions were returned"** — the video has no subtitles in that language; try `language: "es"` etc.
  yt-dlp itself occasionally needs an update (`yt-dlp -U`) when YouTube changes things.
- **Slow first call** — the transcript tool waits up to `TRANSCRIPT_TIMEOUT_MS` (100 s); long videos take 10–30 s.
