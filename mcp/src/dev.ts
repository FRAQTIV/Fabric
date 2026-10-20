import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { POST } from "../api/mcp.js";

const port = Number(process.env.PORT ?? 3000);

// Emulates the vercel.json rewrite: /mcp/:token -> /api/mcp?token=:token
function emulateRewrite(url: URL): URL {
  const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
  if (!m) return url;
  url.pathname = "/api/mcp";
  url.searchParams.set("token", m[1]);
  return url;
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = emulateRewrite(new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`));
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? Buffer.concat(await req.toArray()) : undefined;
  return new Request(url, { method: req.method, headers, body });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return void res.end();
  Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
}

createServer(async (req, res) => {
  try {
    await send(res, await POST(await toRequest(req)));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("dev server error");
  }
}).listen(port, () => {
  console.log(`fabric-mcp dev server on http://localhost:${port}/mcp/<token>`);
});
