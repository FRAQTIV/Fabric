import type { PatternMeta } from "./patterns.js";

/**
 * Intents a research request can carry. Each intent has trigger words and the
 * patterns that serve it, best first. Pattern names that are not in the live
 * index are dropped at ranking time, so a renamed pattern only loses its boost.
 */
type Intent = { name: string; triggers: RegExp; patterns: string[] };

const INTENTS: Intent[] = [
  {
    name: "summary",
    triggers: /\b(summar\w*|tl;?dr|overview|gist|recap|short version|brief(ly)?|key points?)\b/i,
    patterns: ["youtube_summary", "summarize", "create_5_sentence_summary", "create_micro_summary", "extract_core_message"],
  },
  {
    name: "core ideas and lessons",
    triggers: /\b(wisdom|lessons?|insights?|ideas?|takeaways?|learn(ings?)?|what (did|does) (he|she|they) (say|think))\b/i,
    patterns: ["extract_wisdom", "extract_insights", "extract_ideas", "extract_main_idea", "extract_alpha"],
  },
  {
    name: "research and sources",
    triggers: /\b(research|sources?|references?|cit(e|ations?)|books?|papers?|studies|study|reading list|mentioned)\b/i,
    patterns: ["extract_references", "extract_book_recommendations", "extract_insights", "analyze_claims", "extract_questions"],
  },
  {
    name: "verify claims",
    triggers: /\b(fact[- ]?check\w*|claims?|true|accura\w+|verify|evidence|bias\w*|misinformation|credib\w+|fallac\w+|bs|bullshit|trust(worthy)?)\b/i,
    patterns: ["analyze_claims", "extract_extraordinary_claims", "find_logical_fallacies", "check_falsifiability", "extract_controversial_ideas"],
  },
  {
    name: "predictions and outlook",
    triggers: /\b(predict\w*|forecast\w*|future|outlook|trends?|where .* going|next \d+ years)\b/i,
    patterns: ["extract_predictions", "analyze_tech_impact", "extract_alpha"],
  },
  {
    name: "actions and recommendations",
    triggers: /\b(actions?|actionable|to-?dos?|recommend\w*|advice|steps?|apply|implement|what should (i|we))\b/i,
    patterns: ["extract_recommendations", "extract_instructions", "create_golden_rules", "provide_guidance"],
  },
  {
    name: "how-to and instructions",
    triggers: /\b(how[- ]to|tutorial|instructions?|guide|walk ?through|recipe|setup|set up)\b/i,
    patterns: ["extract_instructions", "create_diy", "extract_recipe", "summarize_lecture"],
  },
  {
    name: "business and strategy",
    triggers: /\b(business|startup|market\w*|strateg\w*|invest\w*|monetiz\w*|revenue|compan(y|ies)|founder|vc|venture|opportunit\w+|competit\w+|sales)\b/i,
    patterns: ["extract_business_ideas", "analyze_monetization_opportunities", "extract_primary_problem", "extract_primary_solution", "analyze_risk", "extract_alpha"],
  },
  {
    name: "quotes",
    triggers: /\b(quotes?|quotations?|said|verbatim|soundbites?)\b/i,
    patterns: ["extract_all_quotes", "extract_wisdom_with_attribution", "create_aphorisms"],
  },
  {
    name: "people and attribution",
    triggers: /\b(who said|speakers?|guests?|interview\w*|panel|attribut\w+)\b/i,
    patterns: ["extract_wisdom_with_attribution", "analyze_interviewer_techniques", "extract_characters"],
  },
  {
    name: "debate and arguments",
    triggers: /\b(debate|argument\w*|disagree\w*|both sides|pros? and cons?|controvers\w+|compare|versus|vs\.?)\b/i,
    patterns: ["analyze_debate", "summarize_debate", "compare_and_contrast", "extract_controversial_ideas"],
  },
  {
    name: "study and teaching",
    triggers: /\b(study|notes?|flash ?cards?|quiz|teach|explain|lecture|course|class|exam|terms?|jargon)\b/i,
    patterns: ["summarize_lecture", "to_flashcards", "create_quiz", "explain_terms", "create_reading_plan"],
  },
  {
    name: "structure and visuals",
    triggers: /\b(chapters?|outline|timeline|diagram|mind ?map|visual\w*|map it|structure)\b/i,
    patterns: ["create_video_chapters", "create_recursive_outline", "create_markmap_visualization", "create_mermaid_visualization"],
  },
  {
    name: "worth watching",
    triggers: /\b(worth (it|watching|my time)|rate|rating|score|quality|skip)\b/i,
    patterns: ["label_and_rate", "rate_content", "get_wow_per_minute", "rate_value"],
  },
  {
    name: "products and sponsors",
    triggers: /\b(products?|tools?|sponsors?|affiliate|gear|software|apps?)\b/i,
    patterns: ["extract_video_commerce_entities", "extract_product_features", "extract_sponsors", "extract_references"],
  },
  {
    name: "meetings and calls",
    triggers: /\b(meeting|minutes|call|earnings|board|standup)\b/i,
    patterns: ["summarize_meeting", "transcribe_minutes", "concall_summary", "summarize_board_meeting"],
  },
  {
    name: "security",
    triggers: /\b(security|threat|cyber|vulnerab\w*|attack|malware|incident)\b/i,
    patterns: ["create_cyber_summary", "analyze_threat_report", "analyze_threat_report_trends", "create_threat_scenarios"],
  },
  {
    name: "writing output",
    triggers: /\b(newsletter|blog|post|tweet|thread|essay|article|write[- ]?up|linkedin)\b/i,
    patterns: ["create_newsletter_entry", "write_micro_essay", "tweet", "write_essay"],
  },
];

/** A broad research request with no narrower intent gets this balanced set. */
const DEFAULT_SET = ["youtube_summary", "extract_wisdom", "extract_insights", "analyze_claims", "extract_references", "extract_recommendations"];

/** Patterns that need code, logs or other input a video transcript does not give. */
const NOT_FOR_TRANSCRIPTS = /^(t_|chinese_|create_coding|create_git|summarize_git|summarize_pull|write_pull|review_code|explain_code|coding_master|generate_code|analyze_logs|analyze_malware|analyze_email_headers|analyze_terraform|write_semgrep|write_nuclei|create_sigma|sanitize_|convert_to_markdown|clean_text|fix_typos|export_data|official_pattern|create_pattern|improve_prompt|suggest_|raw_query|extract_videoid|extract_latest_video|judge_|rate_ai_|create_logo|create_art_prompt|find_female)/;

const STOP = new Set(
  "a an and are as at be but by do does for from get give how i in into is it its me my of on or our please show so that the their them this to us video want was we what when which who why will with you your youtube transcript talk podcast clip".split(" "),
);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export type Recommendation = {
  pattern: string;
  description: string;
  tags: string[];
  score: number;
  why: string[];
};

/**
 * Ranks patterns for a goal. Intent matches carry most of the weight (a pattern
 * listed earlier for an intent scores higher); word overlap with the pattern's
 * name, description and tags adds to it. With no intent matched, the balanced
 * research set leads.
 */
export function recommendPatterns(
  goal: string,
  index: PatternMeta[],
  limit = 8,
): { intents: string[]; recommendations: Recommendation[] } {
  const byName = new Map(index.map((p) => [p.patternName, p]));
  const scores = new Map<string, { score: number; why: string[] }>();
  const bump = (name: string, by: number, why: string) => {
    if (!byName.has(name) || NOT_FOR_TRANSCRIPTS.test(name)) return;
    const s = scores.get(name) ?? { score: 0, why: [] };
    s.score += by;
    if (!s.why.includes(why)) s.why.push(why);
    scores.set(name, s);
  };

  const intents = INTENTS.filter((i) => i.triggers.test(goal));
  for (const intent of intents) {
    intent.patterns.forEach((name, rank) => bump(name, 10 - rank * 1.5, `fits "${intent.name}"`));
  }
  if (intents.length === 0) {
    DEFAULT_SET.forEach((name, rank) => bump(name, 8 - rank, "broad research default"));
  }

  const goalWords = new Set(words(goal));
  if (goalWords.size > 0) {
    for (const p of index) {
      const hay = new Set([...words(p.patternName.replace(/_/g, " ")), ...words(p.description), ...p.tags.flatMap(words)]);
      const hits = [...goalWords].filter((w) => [...hay].some((h) => h === w || (w.length > 4 && h.startsWith(w.slice(0, 5)))));
      if (hits.length > 0) bump(p.patternName, hits.length * 2, `matches ${hits.map((h) => `"${h}"`).join(", ")}`);
    }
  }

  const recommendations = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(([name, s]) => {
      const meta = byName.get(name)!;
      return { pattern: name, description: meta.description, tags: meta.tags, score: Math.round(s.score * 10) / 10, why: s.why };
    });
  return { intents: intents.map((i) => i.name), recommendations };
}
