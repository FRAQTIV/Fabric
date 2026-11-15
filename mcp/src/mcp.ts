import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { config } from "./config.js";
import { getPattern, listPatterns } from "./patterns.js";
import { recommendPatterns } from "./recommend.js";
import {
  describeTranscript,
  fetchTranscript,
  type Transcript,
} from "./transcript.js";

const VERSION = "0.2.1";

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

/** One transcript fetch, several patterns: the model runs each in turn. */
function composeMultiPatternInput(
  patterns: Array<{ name: string; system: string }>,
  t: Transcript,
  goal?: string,
): string {
  const out = [
    `You are applying ${patterns.length} Fabric patterns to the same INPUT: ${patterns.map((p) => p.name).join(", ")}.`,
    ...(goal ? [`The user's goal: ${goal}`] : []),
    "Run each PATTERN separately against the INPUT, in the order given, following its instructions exactly.",
    "Put each result under a heading with the pattern name. Do not merge or shorten the patterns' outputs.",
    "After the last one, add a short SYNTHESIS section that answers the user's goal using all the results,",
    "noting where the patterns agree or conflict.",
    "",
  ];
  patterns.forEach((p, i) => {
    out.push(`===== PATTERN ${i + 1} of ${patterns.length}: ${p.name} =====`, p.system.trim(), "");
  });
  out.push("===== INPUT =====", describeTranscript(t), "", t.text);
  return out.join("\n");
}

const urlField = z
  .string()
  .min(1)
  .describe("YouTube video URL (youtube.com/watch?v=…, youtu.be/…, shorts, live) or a bare 11-character video ID");
const languageField = z
  .string()
  .optional()
  .describe('Caption language code, e.g. "en", "es", "de". Defaults to "en".');

const INSTRUCTIONS = [
  "Fabric MCP: Fabric patterns (prompt templates) plus YouTube transcripts.",
  "Patterns are the value of this server. Do not default to extract_wisdom.",
  "For any request about a video (research, analysis, notes, summary, fact-checking and so on):",
  "1. Call recommend_patterns with the user's goal in their own words.",
  "2. Choose the 2-4 patterns that together best serve that goal, using the returned descriptions.",
  "   Pick one pattern only when the user names it or asks for something that narrow.",
  "3. Call apply_patterns once with the URL and the chosen patterns. It fetches the transcript once.",
  "4. Run every returned pattern against the transcript, then write the synthesis the response asks for.",
  "Tell the user which patterns you used and why, in one line.",
  "If a transcript fetch fails, report the error text as given.",
].join("\n");

export function createHandler() {
  return createMcpHandler(
    (server) => {
      server.registerTool(
        "get_transcript",
        {
          title: "Get YouTube transcript",
          description:
            "Fetch the full transcript (captions) of a YouTube video, plus its title and channel. " +
            "Transcripts come from yt-dlp on the owner's server. " +
            "To analyze a video, prefer recommend_patterns then apply_patterns.",
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
        "recommend_patterns",
        {
          title: "Recommend Fabric patterns for a goal",
          description:
            "Rank the Fabric patterns that best fit what the user wants from a video or text. " +
            "Pass the user's request in their own words. Returns the detected intents and a ranked " +
            "shortlist with descriptions and reasons. Choose 2-4 that together cover the goal, then call apply_patterns.",
          inputSchema: z.object({
            goal: z.string().min(1).describe('What the user wants, e.g. "research this talk for my AI investing thesis".'),
            limit: z.number().int().min(1).max(20).optional().describe("How many candidates to return. Default 8."),
          }),
        },
        async ({ goal, limit }) => {
          try {
            const { intents, recommendations } = recommendPatterns(goal, await listPatterns(), limit ?? 8);
            const lines = [
              `Goal: ${goal}`,
              `Detected intents: ${intents.length ? intents.join("; ") : "none specific (broad research set)"}`,
              "",
              "Candidates, best first:",
              ...recommendations.map(
                (r, i) => `${i + 1}. ${r.pattern} (score ${r.score}) — ${r.description} Why: ${r.why.join("; ")}.`,
              ),
              "",
              "Choose the 2-4 that together cover the goal without overlap, then call apply_patterns.",
              "If none fit, call list_patterns with a keyword.",
            ];
            return ok(lines.join("\n"));
          } catch (err) {
            return fail(err);
          }
        },
      );

      server.registerTool(
        "apply_patterns",
        {
          title: "Apply several Fabric patterns to a YouTube video",
          description:
            "Fetch a YouTube transcript once and bundle it with the instructions of several Fabric patterns. " +
            "Run each PATTERN on the INPUT, then write the SYNTHESIS the response asks for. " +
            "Choose the patterns with recommend_patterns.",
          inputSchema: z.object({
            url: urlField,
            patterns: z
              .array(z.string().min(1))
              .min(1)
              .max(6)
              .describe('Pattern names, e.g. ["youtube_summary", "analyze_claims", "extract_references"].'),
            goal: z.string().optional().describe("The user's goal, used to frame the synthesis."),
            language: languageField,
          }),
        },
        async ({ url, patterns, goal, language }) => {
          try {
            const names = [...new Set(patterns)];
            const [systems, transcript] = await Promise.all([
              Promise.all(names.map(async (name) => ({ name, system: await getPattern(name) }))),
              fetchTranscript({ url, language }),
            ]);
            return ok(composeMultiPatternInput(systems, transcript, goal));
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
              .describe("Fabric pattern name. Use recommend_patterns to choose; use apply_patterns for more than one."),
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
            "Use only when the user asks for extract_wisdom by name. For other requests use recommend_patterns " +
            "and apply_patterns. Shortcut for apply_pattern with extract_wisdom: fetches the transcript and returns it " +
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
    {
      serverInfo: { name: "fabric-mcp", version: VERSION },
      instructions: INSTRUCTIONS,
      // The tool list never changes at runtime and, on Vercel, every request runs in its own
      // invocation with its own in-memory event bus, so a list_changed notification could never
      // be delivered anyway. Advertising listChanged makes 2026-07-28 clients open a
      // subscriptions/listen stream that the SDK holds open until the platform kills the
      // function (modelcontextprotocol/typescript-sdk#2873). With it off, the SDK acknowledges
      // the listen request with an empty filter and closes the stream at once.
      capabilities: { tools: { listChanged: false } },
    },
  );
}
