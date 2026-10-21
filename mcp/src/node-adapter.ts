import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export function isNodeRequest(input: unknown): input is IncomingMessage {
  const r = input as { headers?: unknown; socket?: unknown };
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.headers === "object" &&
    typeof (r.headers as { get?: unknown }).get !== "function" &&
    "socket" in r
  );
}

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? "http";
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${proto}://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? Buffer.concat(await req.toArray()) : undefined;
  return new Request(url, { method: req.method, headers, body });
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return void res.end();
  Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
}
