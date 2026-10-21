import { createServer } from "node:http";
import { handle } from "../server.js";
import { sendWebResponse, toWebRequest } from "./node-adapter.js";

const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  try {
    await sendWebResponse(res, await handle(await toWebRequest(req)));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("dev server error");
  }
}).listen(port, () => {
  console.log(`fabric-mcp dev server on http://localhost:${port}/mcp/<token>`);
});
