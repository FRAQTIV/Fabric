#!/usr/bin/env bash
set -euo pipefail

INPUT=$(jq -R -s '.' <<< "$*")
RESPONSE=$(curl "$OPENAI_API_BASE_URL/chat/completions" \
  -s -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "{\"model\":\"gpt-5-mini\",\"messages\":[{\"role\":\"user\",\"content\":$INPUT}]}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ne 200 ]]; then
    echo "Error: HTTP $HTTP_CODE" >&2
    echo "$BODY" | jq -r '.error.message // "Unknown error"' >&2
    exit 1
fi

echo "$BODY" | jq -r '.choices[0].message.content'
