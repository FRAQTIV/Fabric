import { timingSafeEqual } from "node:crypto";
import { config } from "../src/config.js";
import { createHandler } from "../src/server.js";

const mcp = createHandler();

function tokenMatches(supplied: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(config.pathToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The token arrives as ?token= when the rewrite's destination query is passed through,
// or as the last segment of the public path (/mcp/<token>) when the function observes
// the original request URL, as Vercel services do.
function suppliedToken(url: URL): string {
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function guarded(request: Request): Promise<Response> {
  if (config.pathToken && !tokenMatches(suppliedToken(new URL(request.url)))) {
    return new Response("Not found", { status: 404 });
  }
  return mcp(request);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
