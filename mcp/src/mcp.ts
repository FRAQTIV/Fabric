import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { config } from "./config.js";
import { getPattern, listPatterns } from "./patterns.js";
import {
  describeTranscript,
  fetchTranscript,
  type Transcript,
} from "./transcript.js";

const VERSION = "0.1.0";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (err: unknown): ToolResult => ({
  content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
});

function composePatternInput(pattern: string, system: string, t: Transcript): string {
  return [
    `You are applying the Fabric pattern "${pattern}" to the INPUT below.`,
    "Follow the PATTERN instructions exactly and output only what the pattern asks for.",
    "",
    "===== PATTERN (system prompt) =====",
    system.trim(),
    "",
    "===== INPUT =====",
    describeTranscript(t),
    "",
    t.text,
  ].join("\n");
}

async function applyPattern(opts: {
  url: string;
  pattern: string;
  language?: string;
}): Promise<ToolResult> {
  const [system, transcript] = await Promise.all([
    getPattern(opts.pattern),
    fetchTranscript({ url: opts.url, language: opts.language }),
  ]);
  return ok(composePatternInput(opts.pattern, system, transcript));
}

const urlField = z
  .string()
  .min(1)
  .describe("YouTube video URL (youtube.com/watch?v=…, youtu.be/…, shorts, live) or a bare 11-character video ID");
const languageField = z
  .string()
  .optional()
  .describe('Caption language code, e.g. "en", "es", "de". Defaults to "en".');

export function createHandler() {
  return createMcpHandler(
    (server) => {
      server.registerTool(
        "get_transcript",
        {
          title: "Get YouTube transcript",
          description:
            "Fetch the full transcript (captions) of a YouTube video, plus its title and channel. " +
            "Transcripts come from yt-dlp running on the owner's home machine.",
          inputSchema: z.object({
            url: urlField,
            language: languageField,
            timestamps: z
              .boolean()
              .optional()
              .describe("Include [hh:mm:ss] timestamps on each line. Default false."),
          }),
        },
        async ({ url, language, timestamps }) => {
          try {
            const t = await fetchTranscript({ url, language, timestamps });
            return ok(`${describeTranscript(t)}\n\n${t.text}`);
          } catch (err) {
            return fail(err);
          }
        },
      );

      server.registerTool(
        "list_patterns",
        {
          title: "List Fabric patterns",
          description:
            "List the Fabric prompt patterns available (name, description, tags). " +
            "Optionally filter by a search term.",
          inputSchema: z.object({
            query: z
              .string()
              .optional()
              .describe('Filter by substring of name, description or tag, e.g. "summarize", "wisdom".'),
          }),
        },
        async ({ query }) => {
          try {
            const patterns = await listPatterns(query);
            if (patterns.length === 0) return ok(`No patterns match "${query ?? ""}".`);
            const lines = patterns.map(
              (p) => `- ${p.patternName} — ${p.description} [${p.tags.join(", ")}]`,
            );
            return ok(`${patterns.length} pattern(s):\n${lines.join("\n")}`);
          } catch (err) {
            return fail(err);
          }
        },
      );

      server.registerTool(
        "get_pattern",
        {
          title: "Get a Fabric pattern",
          description:
            "Return the system prompt (system.md) of a Fabric pattern so it can be applied to any text.",
          inputSchema: z.object({
            name: z.string().min(1).describe('Pattern name, e.g. "extract_wisdom", "summarize".'),
          }),
        },
        async ({ name }) => {
          try {
            return ok(await getPattern(name));
          } catch (err) {
            return fail(err);
          }
        },
      );

      server.registerTool(
        "apply_pattern",
        {
          title: "Apply a Fabric pattern to a YouTube video",
          description:
            "Fetch a YouTube video's transcript and bundle it with a Fabric pattern's instructions. " +
            "Apply the returned PATTERN to the returned INPUT and present the result to the user. " +
            "Use list_patterns to discover pattern names.",
          inputSchema: z.object({
            url: urlField,
            pattern: z
              .string()
              .min(1)
              .default("extract_wisdom")
              .describe('Fabric pattern name. Default "extract_wisdom".'),
            language: languageField,
          }),
        },
        async ({ url, pattern, language }) => {
          try {
            return await applyPattern({ url, pattern, language });
          } catch (err) {
            return fail(err);
          }
        },
      );

      server.registerTool(
        "extract_wisdom",
        {
          title: "Extract wisdom from a YouTube video",
          description:
            "Shortcut for apply_pattern with the extract_wisdom pattern: fetches the transcript and returns it " +
            "together with the extract_wisdom instructions (SUMMARY, IDEAS, INSIGHTS, QUOTES, HABITS, FACTS, " +
            "REFERENCES, ONE-SENTENCE TAKEAWAY, RECOMMENDATIONS). Apply the PATTERN to the INPUT and present the result.",
          inputSchema: z.object({ url: urlField, language: languageField }),
        },
        async ({ url, language }) => {
          try {
            return await applyPattern({ url, pattern: "extract_wisdom", language });
          } catch (err) {
            return fail(err);
          }
        },
      );

      server.registerTool(
        "health",
        {
          title: "Health check",
          description:
            "Report whether the pattern library and the home transcript agent are reachable.",
          inputSchema: z.object({}),
        },
        async () => {
          const lines: string[] = [`fabric-mcp ${VERSION}`];
          try {
            const n = (await listPatterns()).length;
            lines.push(`patterns: ok (${n} available from ${config.patternsBaseUrl})`);
          } catch (err) {
            lines.push(`patterns: FAILED (${err instanceof Error ? err.message : String(err)})`);
          }
          if (!config.homeAgentUrl) {
            lines.push("home agent: not configured (HOME_AGENT_URL is empty)");
          } else {
            try {
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              if (config.homeAgentApiKey) headers["X-API-Key"] = config.homeAgentApiKey;
              const res = await fetch(`${config.homeAgentUrl}/youtube/transcript`, {
                method: "POST",
                headers,
                body: "{}",
                signal: AbortSignal.timeout(10_000),
              });
              if (res.status === 400) lines.push("home agent: ok (reachable, API key accepted)");
              else if (res.status === 401) lines.push("home agent: reachable but API key rejected");
              else lines.push(`home agent: unexpected HTTP ${res.status} (tunnel up, fabric --serve probably down)`);
            } catch (err) {
              lines.push(`home agent: OFFLINE (${err instanceof Error ? err.message : String(err)})`);
            }
          }
          return ok(lines.join("\n"));
        },
      );
    },
    { serverInfo: { name: "fabric-mcp", version: VERSION } },
  );
}
