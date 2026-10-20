import { createServer } from "node:http";

// Stand-in for `fabric --serve` on the home machine, for local testing only.
const port = Number(process.env.PORT ?? 8080);
const apiKey = process.env.MOCK_API_KEY ?? "";

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/youtube/transcript") {
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (apiKey && req.headers["x-api-key"] !== apiKey) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Invalid API Key" }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed: { url?: string; timestamps?: boolean } = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid request" }));
      return;
    }
    if (!parsed.url) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "url is required" }));
      return;
    }
    const id = new URL(parsed.url).searchParams.get("v") ?? "unknown";
    const transcript = parsed.timestamps
      ? "[00:00:01] This is a mock transcript line one.\n[00:00:05] Mock line two."
      : "This is a mock transcript line one. Mock line two.";
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ transcript, title: id }));
  });
}).listen(port, () => console.log(`mock home agent on http://localhost:${port}/youtube/transcript`));
