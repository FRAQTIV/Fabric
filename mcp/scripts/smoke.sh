#!/usr/bin/env bash
# Exercises the MCP server over plain HTTP (JSON-RPC), no client library needed.
# Usage: scripts/smoke.sh [base_url]   (default http://localhost:3000/mcp/$MCP_PATH_TOKEN)
set -euo pipefail

BASE="${1:-http://localhost:3000/mcp/${MCP_PATH_TOKEN:-dev}}"

# Posts one JSON-RPC message and prints the first JSON payload (plain JSON or SSE `data:` line).
rpc() {
  curl -sS -X POST "$BASE" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'MCP-Protocol-Version: 2025-06-18' \
    -d "$1" | awk '/^data: /{sub(/^data: /,""); print; exit} /^\{/{print; exit}'
}

first_lines() { sed -n "1,${1}p"; }

echo "== initialize"
rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | jq -c '.result.serverInfo // .error'

echo "== tools/list"
rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq -r '.result.tools[].name // .error'

echo "== health"
rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"health","arguments":{}}}' | jq -r '.result.content[0].text // .error'

echo "== list_patterns wisdom"
rpc '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_patterns","arguments":{"query":"wisdom"}}}' | jq -r '.result.content[0].text // .error'

echo "== get_pattern extract_wisdom (first 3 lines)"
rpc '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_pattern","arguments":{"name":"extract_wisdom"}}}' | jq -r '.result.content[0].text // .error' | first_lines 3

echo "== get_pattern bogus (expect error)"
rpc '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_pattern","arguments":{"name":"no_such_pattern"}}}' | jq -r '.result.content[0].text // .error'

echo "== get_transcript"
rpc '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_transcript","arguments":{"url":"https://youtu.be/URCUAj1bt28","timestamps":true}}}' | jq -r '.result.content[0].text // .error'

echo "== extract_wisdom (first 6 lines)"
rpc '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"extract_wisdom","arguments":{"url":"https://youtu.be/URCUAj1bt28"}}}' | jq -r '.result.content[0].text // .error' | first_lines 6

echo "== wrong token -> expect 404"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "${BASE%/*}/not-the-token" -H 'Content-Type: application/json' -d '{}'
