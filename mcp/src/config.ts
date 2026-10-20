export const config = {
  homeAgentUrl: (process.env.HOME_AGENT_URL ?? "").replace(/\/+$/, ""),
  homeAgentApiKey: process.env.HOME_AGENT_API_KEY ?? "",
  patternsBaseUrl: (
    process.env.PATTERNS_BASE_URL ??
    "https://raw.githubusercontent.com/FRAQTIV/Fabric/main"
  ).replace(/\/+$/, ""),
  pathToken: process.env.MCP_PATH_TOKEN ?? "",
  transcriptTimeoutMs: Number(process.env.TRANSCRIPT_TIMEOUT_MS ?? 100_000),
  patternCacheTtlMs: Number(process.env.PATTERN_CACHE_TTL_MS ?? 10 * 60_000),
};
