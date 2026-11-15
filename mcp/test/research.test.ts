import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.HOME_AGENT_URL = "http://agent.test";
process.env.HOME_AGENT_API_KEY = "k";
process.env.BRIGHTDATA_API_KEY = "bd-test";
process.env.BRIGHTDATA_POLL_MS = "1";
process.env.TRANSCRIPT_PROVIDERS = "agent,brightdata";

const { recommendPatterns } = await import("../src/recommend.js");
const { fetchTranscript, brightDataText } = await import("../src/transcript.js");

const index = JSON.parse(
  readFileSync(new URL("../../scripts/pattern_descriptions/pattern_descriptions.json", import.meta.url), "utf8"),
).patterns;
const top = (goal: string, n = 5) => recommendPatterns(goal, index, n).recommendations.map((r) => r.pattern);

test("fact-checking puts analyze_claims first", () => {
  assert.equal(top("fact check what he claims about AI")[0], "analyze_claims");
});

test("a summary request leads with a summary pattern", () => {
  assert.match(top("give me a quick summary")[0], /summar/);
});

test("research on an investing thesis mixes sources, claims and business patterns", () => {
  const picks = top("research this talk for my AI investing thesis", 8);
  assert.ok(picks.includes("extract_references"), picks.join());
  assert.ok(picks.includes("analyze_claims"), picks.join());
  assert.ok(picks.some((p) => ["extract_business_ideas", "analyze_monetization_opportunities", "extract_alpha"].includes(p)), picks.join());
  assert.ok(picks.length > 1);
});

test("a vague request gets the broad research set, not extract_wisdom alone", () => {
  const picks = top("thoughts on this one?", 6);
  assert.ok(picks.length >= 4, picks.join());
  assert.ok(picks.includes("analyze_claims"));
});

test("code-only patterns are never recommended for a transcript", () => {
  assert.ok(!top("review the code shown", 20).includes("review_code"));
});

test("Bright Data records become plain or timestamped text", () => {
  const rec = {
    transcript: "hello world",
    formatted_transcript: [
      { start_time: 1000, end_time: 2000, duration: 1000, text: "hello" },
      { start_time: 3_661_000, end_time: 3_662_000, duration: 1000, text: "world" },
    ],
  };
  assert.equal(brightDataText(rec, false), "hello world");
  assert.equal(brightDataText(rec, true), "[00:00:01] hello\n[01:01:01] world");
});

type Call = { url: string; body?: string };

function stubFetch(handler: (url: string, init?: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, body: init?.body as string | undefined });
    if (url.startsWith("https://noembed.com")) return Response.json({ title: "T", author_name: "C" });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

test("io failing falls through to Bright Data", async () => {
  const calls = stubFetch((url) => {
    if (url.startsWith("http://agent.test")) return Response.json({ error: "YouTube rate limit exceeded" }, { status: 500 });
    if (url.includes("/datasets/v3/scrape")) return Response.json([{ title: "T", transcript: "from bright data" }]);
    return new Response("unexpected", { status: 418 });
  });
  const t = await fetchTranscript({ url: "https://youtu.be/URCUAj1bt28" });
  assert.equal(t.text, "from bright data");
  assert.equal(t.source, "Bright Data");
  const scrape = calls.find((c) => c.url.includes("/scrape"))!;
  assert.match(scrape.url, /dataset_id=gd_lk56epmy2i5g7lzu0k/);
  assert.deepEqual(JSON.parse(scrape.body!), {
    input: [{ url: "https://www.youtube.com/watch?v=URCUAj1bt28", transcription_language: "en" }],
  });
});

test("io working means Bright Data is never called", async () => {
  const calls = stubFetch((url) => {
    if (url.startsWith("http://agent.test")) return Response.json({ transcript: "from io" });
    return new Response("should not be called", { status: 500 });
  });
  const t = await fetchTranscript({ url: "URCUAj1bt28" });
  assert.equal(t.text, "from io");
  assert.ok(!calls.some((c) => c.url.includes("brightdata")));
});

test("a long Bright Data run is polled until the snapshot is ready", async () => {
  let polls = 0;
  stubFetch((url) => {
    if (url.startsWith("http://agent.test")) throw new TypeError("fetch failed");
    if (url.includes("/scrape")) return Response.json({ snapshot_id: "sd_1" }, { status: 202 });
    if (url.includes("/progress/sd_1")) return Response.json({ status: ++polls < 2 ? "running" : "ready" });
    if (url.includes("/snapshot/sd_1")) return Response.json([{ transcript: "polled" }]);
    return new Response("?", { status: 418 });
  });
  const t = await fetchTranscript({ url: "URCUAj1bt28" });
  assert.equal(t.text, "polled");
});

test("when every source fails, the error names each one", async () => {
  stubFetch((url) => {
    if (url.startsWith("http://agent.test")) return Response.json({ error: "boom" }, { status: 500 });
    return Response.json([{ error: "Video unavailable" }]);
  });
  await assert.rejects(fetchTranscript({ url: "URCUAj1bt28" }), (err: Error) => {
    assert.match(err.message, /agent: HTTP 500: boom/);
    assert.match(err.message, /brightdata: Bright Data: Video unavailable/);
    return true;
  });
});
