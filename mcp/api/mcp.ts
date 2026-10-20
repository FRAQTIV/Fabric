import { timingSafeEqual } from "node:crypto";
import { config } from "../src/config.js";
import { createHandler } from "../src/server.js";

const mcp = createHandler();

function tokenMatches(supplied: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(config.pathToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function guarded(request: Request): Promise<Response> {
  if (config.pathToken) {
    const supplied = new URL(request.url).searchParams.get("token") ?? "";
    if (!tokenMatches(supplied)) return new Response("Not found", { status: 404 });
  }
  return mcp(request);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
