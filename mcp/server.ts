import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config as settings } from "./src/config.js";
import { createHandler } from "./src/mcp.js";
import { isNodeRequest, sendWebResponse, toWebRequest } from "./src/node-adapter.js";

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

export async function handle(request: Request): Promise<Response> {
  if (settings.pathToken && !tokenMatches(suppliedToken(new URL(request.url)))) {
    return new Response("Not found", { status: 404 });
  }
  return mcp(request);
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
