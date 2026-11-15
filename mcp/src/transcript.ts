import { config } from "./config.js";

export type Transcript = {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  language: string;
  timestamps: boolean;
  text: string;
  /** Which provider returned the text. */
  source?: string;
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

function offline(detail: string): AgentOfflineError {
  return new AgentOfflineError(
    `The home transcript agent is unreachable (${detail}). ` +
      "On the home machine make sure `fabric --serve` is running and `tailscale funnel status` lists its port.",
  );
}

type Fetched = { text: string; title?: string; channel?: string; source: string };
type FetchOpts = { videoId: string; url: string; language: string; timestamps: boolean };

/** yt-dlp on the home agent (io), through Tailscale Funnel. */
async function fromAgent({ url, language, timestamps }: FetchOpts): Promise<Fetched> {
  if (!config.homeAgentUrl) throw new AgentOfflineError("HOME_AGENT_URL is not configured");
  const res = await fetch(`${config.homeAgentUrl}/youtube/transcript`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ url, language, timestamps }),
    signal: AbortSignal.timeout(config.transcriptTimeoutMs),
  }).catch((err: unknown) => {
    throw offline(err instanceof Error ? err.message : String(err));
  });
  if (res.status === 401) {
    throw new Error("the home agent rejected the API key (HOME_AGENT_API_KEY does not match `fabric --serve --api-key`)");
  }
  if ([502, 503, 504, 530].includes(res.status)) throw offline(`HTTP ${res.status} from the tunnel`);
  const body = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.error ?? "unknown error"}`);
  return { text: (body.transcript ?? "").trim(), source: "home agent (yt-dlp on io)" };
}

type BrightDataSegment = Record<string, unknown>;
type BrightDataRecord = {
  title?: string;
  handle_name?: string;
  youtuber?: string;
  transcript?: string;
  formatted_transcript?: BrightDataSegment[] | string;
  error?: string;
  error_code?: string;
};

const BD_API = "https://api.brightdata.com/datasets/v3";

function bdHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.brightDataApiKey}`, "Content-Type": "application/json" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Seconds (or milliseconds, when the value is large) to [hh:mm:ss]. */
function stamp(value: unknown, isMs: boolean): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  const total = Math.floor(isMs ? n / 1000 : n);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `[${hh}:${mm}:${ss}] `;
}

/** Builds the transcript text from a Bright Data YouTube record. */
export function brightDataText(rec: BrightDataRecord, timestamps: boolean): string {
  let segments = rec.formatted_transcript;
  if (typeof segments === "string") {
    try {
      segments = JSON.parse(segments) as BrightDataSegment[];
    } catch {
      segments = undefined;
    }
  }
  if (timestamps && Array.isArray(segments) && segments.length > 0) {
    // Bright Data documents segment times in milliseconds; fall back to seconds
    // for fields that are not named *_ms and hold small values.
    const lines = segments.map((seg) => {
      const key = ["start_time", "start_ms", "start", "offset"].find((k) => seg[k] !== undefined);
      const raw = key ? seg[key] : undefined;
      const isMs = key === "start_ms" || key === "start_time" || Number(raw) > 100_000;
      const text = String(seg.text ?? seg.snippet ?? "").replace(/\s+/g, " ").trim();
      return text ? `${stamp(raw, isMs)}${text}` : "";
    });
    return lines.filter(Boolean).join("\n");
  }
  if (typeof rec.transcript === "string" && rec.transcript.trim()) return rec.transcript.trim();
  if (Array.isArray(segments)) {
    return segments
      .map((seg) => String(seg.text ?? "").trim())
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

async function bdJson(res: Response): Promise<unknown> {
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    // NDJSON: one record per line.
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }
}

/** Bright Data's YouTube scraper: runs on their proxy network, so it works with io off. */
async function fromBrightData({ url, language, timestamps }: FetchOpts): Promise<Fetched> {
  if (!config.brightDataApiKey) throw new Error("BRIGHTDATA_API_KEY is not configured");
  const deadline = Date.now() + config.brightDataTimeoutMs;
  const query = `dataset_id=${encodeURIComponent(config.brightDataDatasetId)}&format=json&include_errors=true`;
  let res = await fetch(`${BD_API}/scrape?${query}`, {
    method: "POST",
    headers: bdHeaders(),
    body: JSON.stringify({ input: [{ url, transcription_language: language }] }),
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });
  // A run longer than about a minute answers 202 with a snapshot to poll.
  if (res.status === 202) {
    const { snapshot_id: id } = (await res.json()) as { snapshot_id?: string };
    if (!id) throw new Error("Bright Data answered 202 without a snapshot_id");
    for (;;) {
      if (Date.now() > deadline) throw new Error(`Bright Data snapshot ${id} was not ready in time`);
      await sleep(config.brightDataPollMs);
      const prog = await fetch(`${BD_API}/progress/${id}`, { headers: bdHeaders(), signal: AbortSignal.timeout(15_000) });
      const { status } = (await prog.json().catch(() => ({}))) as { status?: string };
      if (status === "failed" || status === "canceled") throw new Error(`Bright Data snapshot ${id} ${status}`);
      if (status !== "ready") continue;
      res = await fetch(`${BD_API}/snapshot/${id}?format=json`, { headers: bdHeaders(), signal: AbortSignal.timeout(30_000) });
      if (res.status === 202 || res.status === 409) continue;
      break;
    }
  }
  if (res.status === 401) throw new Error("Bright Data rejected the API key (BRIGHTDATA_API_KEY)");
  if (!res.ok) throw new Error(`Bright Data HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await bdJson(res);
  const rec = (Array.isArray(data) ? data[0] : data) as BrightDataRecord | undefined;
  if (!rec) throw new Error("Bright Data returned no record for this video");
  if (rec.error) throw new Error(`Bright Data: ${rec.error}`);
  return {
    text: brightDataText(rec, timestamps),
    title: rec.title,
    channel: rec.handle_name ?? rec.youtuber,
    source: "Bright Data",
  };
}

const PROVIDERS: Record<string, (o: FetchOpts) => Promise<Fetched>> = {
  agent: fromAgent,
  brightdata: fromBrightData,
};

export async function fetchTranscript(opts: {
  url: string;
  language?: string;
  timestamps?: boolean;
}): Promise<Transcript> {
  const videoId = extractVideoId(opts.url);
  if (!videoId) throw new Error(`Could not find a YouTube video ID in "${opts.url}"`);
  const language = opts.language?.trim() || "en";
  const timestamps = Boolean(opts.timestamps);
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const fo: FetchOpts = { videoId, url, language, timestamps };

  const metaPromise = fetchMetadata(videoId);
  const failures: string[] = [];
  for (const name of config.transcriptProviders) {
    const provider = PROVIDERS[name];
    if (!provider) {
      failures.push(`${name}: unknown provider`);
      continue;
    }
    if (name === "brightdata" && !config.brightDataApiKey) continue;
    if (name === "agent" && !config.homeAgentUrl) continue;
    try {
      const got = await provider(fo);
      if (!got.text) throw new Error(`no captions returned for language "${language}"`);
      const meta = await metaPromise;
      return {
        videoId,
        url,
        title: meta.title || got.title || "",
        channel: meta.channel || got.channel || "",
        language,
        timestamps,
        text: got.text,
        source: got.source,
      };
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length === 0) {
    throw new AgentOfflineError(
      "No transcript source is configured. Set BRIGHTDATA_API_KEY and/or HOME_AGENT_URL on the MCP server.",
    );
  }
  throw new Error(`Could not get a transcript for ${url}. Tried, in order:\n- ${failures.join("\n- ")}`);
}

export function describeTranscript(t: Transcript): string {
  return [
    `Title: ${t.title || "(unknown)"}`,
    `Channel: ${t.channel || "(unknown)"}`,
    `URL: ${t.url}`,
    `Video ID: ${t.videoId}`,
    `Language: ${t.language}${t.timestamps ? " (with timestamps)" : ""}`,
    ...(t.source ? [`Transcript source: ${t.source}`] : []),
  ].join("\n");
}
