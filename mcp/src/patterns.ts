import { config } from "./config.js";

export type PatternMeta = {
  patternName: string;
  description: string;
  tags: string[];
};

const NAME_RE = /^[a-z0-9_-]+$/i;

type CacheEntry<T> = { value: T; expires: number };
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + config.patternCacheTtlMs });
  return value;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

export async function listPatterns(query?: string): Promise<PatternMeta[]> {
  const all = await cached("index", async () => {
    const raw = await fetchText(
      `${config.patternsBaseUrl}/web/static/data/pattern_descriptions.json`,
    );
    const parsed = JSON.parse(raw) as { patterns?: PatternMeta[] };
    if (!Array.isArray(parsed.patterns)) {
      throw new Error("pattern_descriptions.json has no `patterns` array");
    }
    return parsed.patterns;
  });
  if (!query) return all;
  const q = query.toLowerCase();
  return all.filter(
    (p) =>
      p.patternName.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export async function getPattern(name: string): Promise<string> {
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid pattern name "${name}" (letters, digits, _ and - only)`);
  }
  return cached(`pattern:${name}`, async () => {
    try {
      return await fetchText(`${config.patternsBaseUrl}/data/patterns/${name}/system.md`);
    } catch (err) {
      if (String(err).includes("404")) {
        throw new Error(`Unknown pattern "${name}". Use list_patterns to see what exists.`);
      }
      throw err;
    }
  });
}
