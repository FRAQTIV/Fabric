import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config as settings } from "./src/config.js";
import { createHandler } from "./src/mcp.js";
import { isNodeRequest, sendWebResponse, toWebRequest } from "./src/node-adapter.js";
import { boundStream } from "./src/stream-bound.js";

const mcp = createHandler();

function tokenMatches(supplied: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(settings.pathToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The public path is /mcp/<token>; the service observes the original request URL.
// A ?token= query is accepted too for local tooling.
function suppliedToken(url: URL): string {
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : "";
}

// The JSON-RPC method(s) in a request body, for the log line. The URL is never logged:
// it carries the access token.
async function methodsOf(request: Request): Promise<string> {
  if (request.method !== "POST" || !(request.headers.get("content-type") ?? "").includes("json")) {
    return "-";
  }
  try {
    const body = (await request.clone().json()) as unknown;
    const messages = Array.isArray(body) ? body : [body];
    return messages
      .map((m) =>
        m && typeof m === "object" && "method" in m ? String((m as { method: unknown }).method) : "response",
      )
      .join(",");
  } catch {
    return "?";
  }
}

export async function handle(request: Request): Promise<Response> {
  if (settings.pathToken && !tokenMatches(suppliedToken(new URL(request.url)))) {
    return new Response("Not found", { status: 404 });
  }
  const started = Date.now();
  const method = await methodsOf(request);
  const proto = request.headers.get("mcp-protocol-version") ?? "legacy";
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ mcp: event, method, proto, ms: Date.now() - started, ...extra }));

  const response = await mcp(request);
  log("response", { status: response.status });

  // An event stream has to end before the Vercel maxDuration kills the invocation.
  if (response.body && (response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const body = boundStream(response.body, settings.maxStreamMs, () =>
      log("stream-timeout", { maxStreamMs: settings.maxStreamMs }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  }
  return response;
}

// Vercel's Node runtime treats this file as the service entrypoint. The `{ fetch }` export is
// the Web-standard form; the IncomingMessage branch keeps it working if invoked Node-style.
export default {
  async fetch(input: Request | IncomingMessage, res?: ServerResponse): Promise<Response | void> {
    if (!isNodeRequest(input)) return handle(input as Request);
    const response = await handle(await toWebRequest(input));
    if (!res) return response;
    await sendWebResponse(res, response);
  },
};
