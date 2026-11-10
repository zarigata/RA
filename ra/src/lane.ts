// src/lane.ts — assistant vs coding lane classification (plan step 2).
// The entrypoint routes every prompt through the coding pipeline; this lane
// classifier lets plain conversational/research asks take a cheap single-shot
// path (no repo scan, no planning, no subagents) while edit-intent asks keep
// the full pipeline. Reuses anubis detectIntent for verb cues.

import { detectIntent } from "../../anubis/src/intent.ts";
import type { AgentCapabilities } from "./permission.ts";
import { resolveCapabilities } from "./permission.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import { languageDirective } from "./i18n.ts";
import { loadRules, loadMemoryChain } from "./rules.ts";

export type Lane = "assistant" | "coding";
export type LaneMode = Lane | "auto";

/** Edit-intent verbs: any of these sends the request to the coding pipeline. */
// ponytail: fixed English verb list — misses paraphrases ("touch up foo.ts",
// "make the suite green") and other languages; upgrade path is a tiny
// model-assisted classifier on the small lane.
export const EDIT_INTENT_RE = /\b(create|write|make|build|implement|add|edit|modify|change|update|fix|refactor|rename|delete|remove|install|migrate|generate|scaffold)\b/i;

/** File-attachment pattern: a path/extension present means repo context matters. */
// ponytail: extension whitelist, not "any token with a dot" — avoids false
// coding classification of "what is example.com" (no listed extension).
const FILE_TOKEN_RE = /(?:[\w@.-]+[/\\])*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|php|c|cpp|h|cs|swift|kt|scala|sh|bash|zsh|sql|json|ya?ml|toml|ini|env|html|css|scss|vue|svelte|md|txt|csv)\b/i;

export interface LaneDecision {
  lane: Lane;
  /** Why — surfaced for tests and future /lane display. */
  reason: string;
}

/**
 * Classify a request as `assistant` (conversational/research, no edit intent)
 * or `coding`. Pure, no I/O. Edit-intent verbs always win (safe direction:
 * a misrouted question just costs the heavier pipeline, a misrouted edit in
 * the assistant lane would be write-gated).
 */
export function classifyLane(text: string): LaneDecision {
  const t = text.trim();
  if (!t) return { lane: "assistant", reason: "empty input" };
  if (EDIT_INTENT_RE.test(t)) {
    // "how do I fix X" asks for an explanation, not an edit: question intent
    // (+ debug/plan intent phrased as a question) outranks the bare verb
    // unless a file target is named.
    const intent = detectIntent(t);
    const questionShaped = /^(what|who|when|where|why|which|how|is|are|can|could|would|should|does|did|will|explain|tell me)\b/i.test(t);
    if ((intent === "question" || intent === "plan" || intent === "debug") && questionShaped && !FILE_TOKEN_RE.test(t)) {
      return { lane: "assistant", reason: "question about an edit verb, no file target" };
    }
    return { lane: "coding", reason: "edit-intent verb" };
  }
  if (FILE_TOKEN_RE.test(t) && /\b(failing|error|bug|broken|crash|trace|stack|test|tests|suite|compile|build|lint|typecheck|fail|fails|failing)\b/i.test(t)) {
    return { lane: "coding", reason: "file target + failure context" };
  }
  if (detectIntent(t) === "debug") {
    // Question-shaped debug asks ("why does this crash?") without a file
    // target are conversational — explain, don't fire the pipeline.
    if (/^(what|who|when|where|why|which|how|is|are|can|could|would|should|does|did|will|explain|tell me)\b/i.test(t) && !FILE_TOKEN_RE.test(t)) {
      return { lane: "assistant", reason: "question about a failure, no file target" };
    }
    return { lane: "coding", reason: "debug cues" };
  }
  return { lane: "assistant", reason: "no edit intent" };
}

/** Resolve the effective lane for a request: RA_LANE env (assistant|coding|auto,
 *  default auto) overrides the heuristic. Pure — reads env once per call. */
export function resolveLane(text: string, env: Record<string, string | undefined> = process.env): LaneDecision {
  const override = (env.RA_LANE ?? "auto").trim().toLowerCase();
  if (override === "assistant") return { lane: "assistant", reason: "RA_LANE=assistant" };
  if (override === "coding") return { lane: "coding", reason: "RA_LANE=coding" };
  return classifyLane(text);
}

/**
 * Capabilities for the assistant lane: read-only toolset (read, search,
 * outline, web). WRITE/EDIT/MULTIEDIT/BASH/DIAGNOSE/TEST are gated off —
 * if the model reaches for an edit verb mid-conversation, execToolBlock's
 * assertTool denies it with the standard permission error, and the routing
 * contract (edit intent ⇒ coding lane) means it should not arise.
 * resolveCapabilities' readOnly flag already excludes write/edit/multiedit/
 * todo/mcp; bash/diagnose/test/webfetch/websearch need explicit exclusion
 * (websearch must STAY — it is the assistant lane's core research tool).
 */
export function assistantCapabilities(config: RaConfig, parent?: AgentCapabilities): AgentCapabilities {
  // diagnose/test are bash-class in the permission engine, so denying bash
  // covers them; the keep-set filter below drops anything else not read-only.
  const readOnlyBase = resolveCapabilities(config, { edit: "deny", bash: "deny", mcp: "deny" }, undefined, [], parent);
  const keep = new Set(["read", "outline", "glob", "grep", "repomap", "webfetch", "websearch", "skill", "done"]);
  // ponytail: set-filter instead of a second permission grammar — the coding
  // pipeline's resolveCapabilities stays the single source of truth.
  const tools = new Set([...readOnlyBase.tools].filter((v) => keep.has(v)));
  return { ...readOnlyBase, tools };
}

/** Tool-grammar hint for the assistant lane (read-only verbs only). */
export const ASSISTANT_TOOLS = ["read", "outline", "glob", "grep", "repomap", "webfetch", "websearch", "skill"];

/**
 * Resolve the general/assistant-lane model (F5, Wave 3c). Priority mirrors
 * resolveRoleModel: `agent.general.model` (an explicit config pin or an env
 * override landed there by applyEnvOverrides) wins over the small-lane
 * default. Callers previously hardcoded `config.small_model ?? config.model`,
 * silently ignoring the forced model while reporting it elsewhere.
 */
export function resolveAssistantModel(config: { agent?: Record<string, { model?: string }>; small_model?: string; model: string }): string {
  return config.agent?.general?.model ?? config.small_model ?? config.model;
}

/** Assistant-lane system prompt (exported for the i18n directive test).
 *  Mirrors agent.ts loadProjectMemory — kept inline here to avoid the
 *  agent.ts ↔ lane.ts import cycle. */
export function assistantSystemPrompt(cwd: string): string {
  const parts: string[] = [];
  for (const m of loadMemoryChain(cwd)) parts.push(`Project memory (${m.name}):\n${m.body}`);
  for (const r of loadRules(cwd)) parts.push(`Rule (${r.name}${r.paths.length ? `, paths: ${r.paths.join(", ")}` : ""}):\n${r.body}`);
  const memory = parts.length ? `\n\n${parts.join("\n\n")}` : "";
  return `You are RA, a general-purpose assistant. Answer the user's question directly and concisely; this is a conversation, not a coding task. When source material helps (a file, a web page, search results), use the read-only tools below to ground the answer — otherwise answer from knowledge. Never claim to have read a file or page you did not fetch. Do not create, edit, or run anything.${languageDirective()}${memory}`;
}
