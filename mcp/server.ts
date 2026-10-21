import { timingSafeEqual } from "node:crypto";
import { config as settings } from "./src/config.js";
import { createHandler } from "./src/mcp.js";

// Vercel's Node runtime treats this file as the service's server entrypoint and
// routes every request of the service here (see /vercel.json rewrites).
export const config = { maxDuration: 120 };

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

export default async function handler(request: Request): Promise<Response> {
  if (settings.pathToken && !tokenMatches(suppliedToken(new URL(request.url)))) {
    return new Response("Not found", { status: 404 });
  }
  return mcp(request);
}
