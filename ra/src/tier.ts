// Task tier classifier — extends anubis intent

import { detectIntent, type Intent } from "../../anubis/src/intent.ts";

export type TaskTier = "meta" | "light" | "heavy" | "code";

export function classifyTier(text: string, slashCmd?: string): TaskTier {
  if (slashCmd === "plan" || slashCmd === "help" || slashCmd === "roles" || slashCmd === "cost") return "meta";
  if (slashCmd === "code" || slashCmd === "moa" || slashCmd === "pipeline") return "code";
  if (slashCmd === "review" || slashCmd === "critique" || slashCmd === "docs") return "light";

  const intent = detectIntent(text);
  const t = text.toLowerCase();
  if (/\b(architect|refactor entire|multi-file|migrate|rewrite)\b/.test(t)) return "heavy";
  if (intent === "code" || intent === "debug") return "code";
  if (intent === "plan") return "light";
  if (intent === "review" || intent === "docs" || intent === "question") return "meta";
  return "light";
}

export function tierModel(tier: TaskTier, tierModels?: Record<string, string>, fallback = "ollama-lan/qwen3.8:latest"): string {
  return tierModels?.[tier] ?? fallback;
}

export { detectIntent, enhancePrompt } from "../../anubis/src/intent.ts";
export type { Intent };
