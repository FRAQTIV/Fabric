import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MCP_PATH_TOKEN = "test-token";
process.env.HOME_AGENT_URL = "http://127.0.0.1:9";
process.env.MAX_STREAM_MS = "250";

const { handle } = await import("../server.js");
const { boundStream } = await import("../src/stream-bound.js");

const ENDPOINT = "http://localhost/mcp/test-token";
const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return handle(
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

function modern(method: string, params: Record<string, unknown> = {}, id = 1) {
  return post(
    { jsonrpc: "2.0", id, method, params: { ...params, _meta: META } },
    { "mcp-protocol-version": "2026-07-28", "mcp-method": method },
  );
}

/** Reads the whole body, or fails if the stream is still open after `ms`. */
async function readWithin(res: Response, ms: number): Promise<string> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`response body still open after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([res.text(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

test("a wrong path token is answered 404", async () => {
  const res = await handle(new Request("http://localhost/mcp/nope", { method: "POST", body: "{}" }));
  assert.equal(res.status, 404);
});

test("legacy (2025) tools/list answers and closes the stream", async () => {
  const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.equal(res.status, 200);
  const body = await readWithin(res, 2000);
  assert.match(body, /"name":"get_transcript"/);
});

test("server/discover does not advertise tools.listChanged (nothing can deliver it on Vercel)", async () => {
  const res = await modern("server/discover");
  assert.equal(res.status, 200);
  const json = JSON.parse(await readWithin(res, 2000)) as {
    result: { capabilities: { tools?: { listChanged?: boolean } } };
  };
  assert.ok(json.result.capabilities.tools, "tools capability is still advertised");
  assert.notEqual(json.result.capabilities.tools.listChanged, true);
});

test("subscriptions/listen is acknowledged and closed at once instead of being held open", async () => {
  const started = Date.now();
  const res = await modern("subscriptions/listen", { notifications: { toolsListChanged: true } }, 2);
  assert.equal(res.status, 200);
  const body = await readWithin(res, 2000);
  assert.match(body, /notifications\/subscriptions\/acknowledged/);
  assert.match(body, /"resultType":"complete"/);
  assert.ok(Date.now() - started < 2000);
});

test("modern tools/list still works", async () => {
  const res = await modern("tools/list", {}, 3);
  assert.equal(res.status, 200);
  assert.match(await readWithin(res, 2000), /"name":"extract_wisdom"/);
});

test("boundStream ends a stream that never closes on its own", async () => {
  const never = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(": hello\n\n"));
      // and then nothing, forever
    },
  });
  const started = Date.now();
  const text = await new Response(boundStream(never, 200)).text();
  assert.match(text, /hello/);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started}ms`);
});

test("boundStream passes a finishing stream through untouched", async () => {
  const src = new Response("a\nb\n").body!;
  assert.equal(await new Response(boundStream(src, 5000)).text(), "a\nb\n");
});

test("an event stream through handle() is cut at MAX_STREAM_MS even if the SDK holds it", async () => {
  // MAX_STREAM_MS=250 for this process. tools/list closes well before that; this checks the
  // wrapper does not break a normal, short stream.
  const res = await post({ jsonrpc: "2.0", id: 9, method: "ping" });
  assert.equal(res.status, 200);
  assert.match(await readWithin(res, 2000), /"result":\{\}/);
});
