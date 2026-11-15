import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.HOME_AGENT_URL = "http://agent.test";
process.env.HOME_AGENT_API_KEY = "k";

const { recommendPatterns } = await import("../src/recommend.js");
const { fetchTranscript } = await import("../src/transcript.js");

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

test("the transcript comes from the home agent", async () => {
  const calls = stubFetch((url) => {
    if (url.startsWith("http://agent.test")) return Response.json({ transcript: "from io" });
    return new Response("unexpected", { status: 418 });
  });
  const t = await fetchTranscript({ url: "https://youtu.be/URCUAj1bt28" });
  assert.equal(t.text, "from io");
  assert.equal(t.title, "T");
  const agent = calls.find((c) => c.url.startsWith("http://agent.test"))!;
  assert.deepEqual(JSON.parse(agent.body!), {
    url: "https://www.youtube.com/watch?v=URCUAj1bt28",
    language: "en",
    timestamps: false,
  });
});

test("an agent error is reported as given", async () => {
  stubFetch(() => Response.json({ error: "boom" }, { status: 500 }));
  await assert.rejects(fetchTranscript({ url: "URCUAj1bt28" }), /HTTP 500\): boom/);
});

test("an unreachable agent is reported as offline", async () => {
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchTranscript({ url: "URCUAj1bt28" }), /home transcript agent is unreachable/);
});
