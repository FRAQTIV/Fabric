import { config } from "./config.js";

export type Transcript = {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  language: string;
  timestamps: boolean;
  text: string;
};

export class AgentOfflineError extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s.includes("://") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.split("/")[1] ?? "";
    return ID_RE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v && ID_RE.test(v)) return v;
    const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

async function fetchMetadata(videoId: string): Promise<{ title: string; channel: string }> {
  try {
    const res = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return { title: "", channel: "" };
    const data = (await res.json()) as { title?: string; author_name?: string };
    return { title: data.title ?? "", channel: data.author_name ?? "" };
  } catch {
    return { title: "", channel: "" };
  }
}

function agentHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (config.homeAgentApiKey) h["X-API-Key"] = config.homeAgentApiKey;
  return h;
}

function requireAgentUrl(): string {
  if (!config.homeAgentUrl) {
    throw new AgentOfflineError(
      "HOME_AGENT_URL is not configured on the MCP server, so transcripts cannot be fetched.",
    );
  }
  return config.homeAgentUrl;
}

function offline(detail: string): AgentOfflineError {
  return new AgentOfflineError(
    `The home transcript agent is unreachable (${detail}). ` +
      "On the home machine make sure `fabric --serve` and the tunnel (cloudflared) are running.",
  );
}

export async function fetchTranscript(opts: {
  url: string;
  language?: string;
  timestamps?: boolean;
}): Promise<Transcript> {
  const videoId = extractVideoId(opts.url);
  if (!videoId) throw new Error(`Could not find a YouTube video ID in "${opts.url}"`);
  const base = requireAgentUrl();
  const language = opts.language?.trim() || "en";
  const timestamps = Boolean(opts.timestamps);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const [meta, res] = await Promise.all([
    fetchMetadata(videoId),
    fetch(`${base}/youtube/transcript`, {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify({ url, language, timestamps }),
      signal: AbortSignal.timeout(config.transcriptTimeoutMs),
    }).catch((err: unknown) => {
      throw offline(err instanceof Error ? err.message : String(err));
    }),
  ]);

  if (res.status === 401) {
    throw new Error("The home agent rejected the API key (HOME_AGENT_API_KEY does not match `fabric --serve --api-key`).");
  }
  if ([502, 503, 504, 530].includes(res.status)) {
    throw offline(`HTTP ${res.status} from the tunnel`);
  }
  const body = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
  if (!res.ok) {
    throw new Error(`Transcript fetch failed (HTTP ${res.status}): ${body.error ?? "unknown error"}`);
  }
  const text = (body.transcript ?? "").trim();
  if (!text) {
    throw new Error(`No captions were returned for ${url} (language "${language}"). The video may have no subtitles, or try another language code.`);
  }
  return {
    videoId,
    url,
    title: meta.title,
    channel: meta.channel,
    language,
    timestamps,
    text,
  };
}

export function describeTranscript(t: Transcript): string {
  return [
    `Title: ${t.title || "(unknown)"}`,
    `Channel: ${t.channel || "(unknown)"}`,
    `URL: ${t.url}`,
    `Video ID: ${t.videoId}`,
    `Language: ${t.language}${t.timestamps ? " (with timestamps)" : ""}`,
  ].join("\n");
}
