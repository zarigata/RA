// src/profiles.ts — model capability profiles (ra.77 "Provider Mosaic").
// Every model RA can route to carries a strengths profile: 0–10 scores per
// job, curated 2026-09 from public benchmarks (see docs/PROVIDERS.md for the
// per-model receipts): SWE-bench Verified / SWE-bench Pro for code, Aider
// polyglot for edit-format coding, Humanity's Last Exam + GPQA for research
// and reasoning. Scores are comparative within RA's routing pool, not
// scientific constants — they exist so the capability router can pick the
// right specialist and so quota failover degrades gracefully.

export type Job = "code" | "research" | "reasoning" | "review" | "chat" | "docs";

export interface ModelProfile {
  /** Match against the full model id, case-insensitive substring. First match wins. */
  match: string[];
  scores: Record<Job, number>;
  note: string;
}

export const JOBS: Job[] = ["code", "research", "reasoning", "review", "chat", "docs"];

export const DEFAULT_PROFILE: ModelProfile = {
  match: [],
  scores: { code: 5, research: 5, reasoning: 5, review: 5, chat: 6, docs: 5 },
  note: "unprofiled model — treated as mid-tier for every job",
};

// Ordered: first matching profile wins, so specific ids precede families.
export const MODEL_PROFILES: ModelProfile[] = [
  {
    // OpenAI frontier (GPT-5.6 Sol 96.2% SWE-bench Verified 2026; GPT-5 88% Aider)
    match: ["gpt-5.6", "gpt-5.5", "gpt-5", "o3-pro", "o4-mini"],
    scores: { code: 10, research: 8.5, reasoning: 9.5, review: 9, chat: 9, docs: 8.5 },
    note: "frontier coder — best-in-class edits, strong reasoning",
  },
  {
    // Anthropic (Claude Fable 5 95% Verified; Opus 4.5 top-4 official; reviewer reputation)
    match: ["claude-fable", "fable", "claude-opus", "claude-sonnet", "claude-4", "claude-3"],
    scores: { code: 9.5, research: 8.5, reasoning: 9, review: 10, chat: 9, docs: 9 },
    note: "elite coder + the reviewer — careful diffs, great judgment",
  },
  {
    // Google (Gemini 3 Pro top-4 SWE-bench; HLE ~46%; long context)
    match: ["gemini-3", "gemini-2.5-pro", "gemini-pro"],
    scores: { code: 8.5, research: 10, reasoning: 9, review: 8, chat: 8.5, docs: 9 },
    note: "the researcher — deep understanding, long context, great synthesis",
  },
  {
    match: ["gemini-2.5-flash", "gemini-flash", "gemini-3-flash"],
    scores: { code: 6.5, research: 7.5, reasoning: 7, review: 6.5, chat: 8, docs: 7.5 },
    note: "fast research drafts and lookups",
  },
  {
    // DeepSeek V4 (80.6% Verified = top open-weight; HLE ~48% top open)
    match: ["deepseek-v4-pro", "deepseek-v4", "deepseek"],
    scores: { code: 9, research: 8.5, reasoning: 9, review: 8.5, chat: 8, docs: 8 },
    note: "best all-round open-weight — top open SWE-bench + HLE",
  },
  {
    // Z.ai GLM (GLM-5.2 62.1% SWE-bench Pro = best open on Pro; GLM-5.3 HLE 42.3)
    match: ["glm-5", "glm-4.6", "glm-4"],
    scores: { code: 8.5, research: 7.5, reasoning: 8, review: 8, chat: 8, docs: 8 },
    note: "strong open coder-agentic model, cheap — RA's default BIG",
  },
  {
    // Moonshot Kimi (K2.6 58.6% SWE-Pro; K2 Thinking HLE ~45%; K3 arena #1)
    match: ["kimi-k3", "kimi-k2", "kimi"],
    scores: { code: 8.5, research: 8, reasoning: 8, review: 8, chat: 7.5, docs: 7.5 },
    note: "open coding specialist with a strong thinking variant",
  },
  {
    // gpt-oss (120b ~62% Verified scaffolded — exceptional for local; 20b lighter)
    match: ["gpt-oss:120b", "gpt-oss-120b"],
    scores: { code: 7, research: 6.5, reasoning: 7, review: 7, chat: 7.5, docs: 7 },
    note: "the local workhorse — near-o3-mini coding on your own hardware",
  },
  {
    match: ["gpt-oss"],
    scores: { code: 6, research: 5.5, reasoning: 6, review: 6, chat: 7, docs: 6 },
    note: "fast small local model — planning/chat lane",
  },
  {
    // Qwen (Qwen3-235B 59.6% Aider; Qwen3.8 Max strong on SWE-Pro)
    match: ["qwen3.8", "qwen3", "qwen"],
    scores: { code: 7, research: 7, reasoning: 7, review: 7, chat: 7, docs: 7 },
    note: "solid open generalist",
  },
  {
    // MiniMax (M3 HLE 39) / Nemotron
    match: ["minimax"],
    scores: { code: 7, research: 7, reasoning: 7, review: 6.5, chat: 7, docs: 7 },
    note: "open reasoner",
  },
  {
    match: ["nemotron"],
    scores: { code: 6.5, research: 7, reasoning: 7, review: 6.5, chat: 7, docs: 6.5 },
    note: "open reasoner",
  },
  {
    match: ["mistral-large", "mistral"],
    scores: { code: 6.5, research: 6, reasoning: 6.5, review: 6.5, chat: 7.5, docs: 6.5 },
    note: "fast European generalist",
  },
  {
    // Grok (Grok-4 79.6% Aider)
    match: ["grok-4", "grok"],
    scores: { code: 8, research: 7.5, reasoning: 8, review: 7.5, chat: 8, docs: 7 },
    note: "strong closed coder-reasoner",
  },
  {
    // Gemma local
    match: ["gemma"],
    scores: { code: 5, research: 5, reasoning: 5.5, review: 5, chat: 6.5, docs: 5.5 },
    note: "light local fallback — chat first",
  },
  {
    match: ["llama"],
    scores: { code: 5.5, research: 5.5, reasoning: 6, review: 5.5, chat: 6.5, docs: 5.5 },
    note: "light local generalist",
  },
];

/** Best-matching profile for a model id (provider-prefixed or bare). */
export function profileFor(model: string): ModelProfile {
  const id = model.toLowerCase();
  for (const p of MODEL_PROFILES) {
    if (p.match.some((m) => id.includes(m))) return p;
  }
  return DEFAULT_PROFILE;
}

/** Capability score for one job. */
export function scoreModel(model: string, job: Job): number {
  return profileFor(model).scores[job];
}

export interface RankedModel {
  model: string;
  score: number;
  note: string;
  local: boolean;
}

/**
 * Rank candidate models for a job. Local candidates get a configurable
 * bonus (default 2) so the default topology keeps cheap work on local
 * hardware — the "local assistant, cloud specialist" contract — while a
 * specialist cloud model still wins when it is clearly better for the job.
 * Candidates may be bare model ids (localness inferred from the id) or
 * `{model, local}` pairs (authoritative, from the provider registry).
 * Ties go to the local candidate. Pure: quota/key filtering happens upstream.
 */
export function rankForJob(
  models: Array<string | { model: string; local: boolean }>,
  job: Job,
  localBonus = 2,
): RankedModel[] {
  return models
    .map((entry) => {
      const model = typeof entry === "string" ? entry : entry.model;
      const local = typeof entry === "string" ? !/^(ollama-cloud|cloud)\//i.test(model) : entry.local;
      const p = profileFor(model);
      return { model, score: p.scores[job] + (local ? localBonus : 0), note: p.note, local };
    })
    .sort((a, b) => b.score - a.score || (a.local === b.local ? a.model.localeCompare(b.model) : a.local ? -1 : 1));
}

/** Map a RA agent role + tier onto a routing job. */
export function jobForRole(role: string, tier?: string): Job {
  if (role === "ptah" || tier === "code") return "code";
  if (role === "isis") return "research";
  if (role === "maat" || role === "sekhmet" || role === "code-reviewer" || role === "security-reviewer") return "review";
  if (role === "seshat" || role === "docs-writer") return "docs";
  if (role === "thoth" || tier === "heavy" || tier === "meta") return "reasoning";
  return "chat";
}

/** One-line capability summary for /providers and `ra providers`. */
export function formatProfile(model: string): string {
  const p = profileFor(model);
  const top = JOBS.filter((j) => p.scores[j] >= Math.max(...JOBS.map((x) => p.scores[x])) - 0.5);
  return `${model} — ${top.join("/")}: ${p.note}`;
}
