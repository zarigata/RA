// src/resume.ts — adaptive low-context runs (ra.78).
// When a model's context runs low mid-task, the agent loop checkpoints a
// handoff packet (objective, progress, TODO state, next steps) and ends the
// run cleanly; runTaskAgent resumes a fresh, SHORTER run seeded with that
// packet. Objectives stay crystal clear across resumes even though each
// individual run is small — the local-first contract.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RA_GLOBAL } from "../../anubis/src/config.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import { contextPolicy, modelKind, modelMaxContext, usableContext } from "../../anubis/src/context-limits.ts";
import { escalationChain } from "../../anubis/src/routing.ts";
import { pickForJobLive } from "../../anubis/src/capability.ts";
import { jobForRole, type Job } from "../../anubis/src/profiles.ts";
import { isAirgapped } from "./airgap.ts";
import { formatTodos, listTodos, type TodoItem } from "./tools/index.ts";

/** Why a run ended early and handed off. */
export type HandoffReason = "low-context" | "context-overflow" | "step-limit";

export interface ContextStats {
  windowTokens: number;
  usedTokens: number;
  source: string;
  /** Automatic continuations used (across the whole task). */
  resumes: number;
  /** Mid-run compactions performed. */
  compactions: number;
  /** Context-pressure escalations to a bigger-window model. */
  escalations: number;
}

export interface HandoffInput {
  role: string;
  /** The original objective — restated verbatim in every continuation. */
  objective: string;
  reason: HandoffReason;
  continuation: number;
  model: string;
  windowTokens: number;
  usedTokens: number;
  filesWritten: string[];
  todos: TodoItem[];
  lastAssistant: string;
  /** Tail of the conversation (newest last), for the digest. */
  recent: Array<{ role: string; content: string }>;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+\n/g, "\n");

/**
 * Build the handoff packet: everything a fresh run needs to continue the
 * objective without replaying the transcript. This is the L0–L4 context
 * packet from the design pack — the raw transcript stays behind.
 */
export function buildHandoff(i: HandoffInput): string {
  const lines: string[] = [
    `# RA handoff — ${i.role} (continuation ${i.continuation})`,
    `Reason: ${i.reason} on ${i.model} — ~${i.usedTokens}/${i.windowTokens} context tokens used.`,
    "",
    "## Objective (unchanged)",
    i.objective.trim(),
    "",
    "## Files written or edited so far",
    i.filesWritten.length ? i.filesWritten.map((f) => `- ${f}`).join("\n") : "(none yet)",
    "",
    "## TODO state",
    i.todos.length ? formatTodos(i.todos) : "(no todos recorded)",
    "",
    "## Most recent assistant output",
    i.lastAssistant.trim() ? clip(i.lastAssistant, 2000) : "(none)",
    "",
    "## Recent exchanges (newest last)",
  ];
  const tail = i.recent.slice(-6);
  if (!tail.length) lines.push("(none)");
  tail.forEach((m, idx) => lines.push(`${idx + 1}. ${m.role}: ${clip(m.content, 400)}`));
  lines.push(
    "",
    "## Next steps",
    "Continue the objective above. Do NOT redo completed work; pick up exactly where the exchanges end.",
    "Finish the current sub-step, then return DONE with a summary when the objective is met.",
  );
  return lines.join("\n");
}

/** Persist a handoff under ~/.ra/handoffs/<project-slug>/ and return its path. */
export function saveHandoff(cwd: string, role: string, index: number, content: string): string {
  const slug = cwd.replace(/\//g, "_").replace(/^_|_$/g, "") || "default";
  const dir = join(RA_GLOBAL, "handoffs", slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${role}-${index}-${Date.now()}.md`);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** The task string for continuation run N: original objective + handoff. */
export function buildContinuationTask(objective: string, handoff: string, continuation: number, limit: number): string {
  return [
    `CONTINUATION ${continuation}/${limit} of an interrupted agent run — the previous run's context filled up. This is a fresh, shorter run seeded with its state.`,
    "",
    "Original objective (unchanged):",
    objective.trim(),
    "",
    "--- HANDOFF FROM PREVIOUS RUN ---",
    handoff,
    "--- END HANDOFF ---",
    "",
    "Continue the objective. Do NOT redo work already marked complete. Be economical with context: read only what the handoff does not already answer. Return DONE with a summary when the objective is met.",
  ].join("\n");
}

/**
 * Step budget per continuation — runs get shorter as context pressure rises:
 * base → 75% → 50% → 50%… (never below 2 so a run can always act + finish).
 */
export function resumeStepBudget(base: number, resumeIndex: number): number {
  const factor = [1, 0.75, 0.5, 0.5][Math.min(resumeIndex, 3)] ?? 0.5;
  return Math.max(2, Math.floor(base * factor));
}

/** The wrap-up notice injected when the ledger crosses the low watermark. */
export function lowContextNotice(remainingTokens: number): string {
  return [
    `[SYSTEM] Context is running low (~${remainingTokens} tokens of headroom left). Wrap up efficiently:`,
    "1. Restate your objective in one line so the continuation run inherits it.",
    "2. Update your TODO list (TODO add/done) to show exactly what is done and what remains.",
    "3. Finish only the current sub-step — do not start new exploratory reads or spawn subagents.",
    "This run will be checkpointed and continued in a fresh context carrying your summary.",
  ].join("\n");
}

/**
 * After `resume_limit` continuations still end resumable, pick a model with a
 * larger usable context to finish the job (the design pack's escalation
 * trigger: "required context exceeds the practical local-server budget").
 * Returns null when nothing bigger is reachable (airgap, no keys) — the
 * caller returns the partial result honestly instead.
 */
export async function pickContextEscalation(
  job: Job,
  config: RaConfig,
  env: Record<string, string>,
  currentModel: string,
  currentWindow: number,
): Promise<string | null> {
  if (isAirgapped(config, env)) return null;
  const candidates: string[] = [];
  try {
    const routing = await pickForJobLive(job, config, env);
    if (routing) candidates.push(routing.primary.model, ...routing.chain);
  } catch { /* mosaic unavailable — fall through to the chain candidates */ }
  for (const m of escalationChain(currentModel, config)) candidates.push(m);
  // The BIG lane is the natural escalation target when it is a cloud model.
  if (config.model && modelKind(config.model, config) === "cloud" && env.OLLAMA_API_KEY) candidates.push(config.model);

  const policy = contextPolicy(config);
  for (const cand of [...new Set(candidates)]) {
    if (cand === currentModel) continue;
    const max = modelMaxContext(cand, config);
    const usable = usableContext(max, cand, modelKind(cand, config), policy);
    if (usable.windowTokens > currentWindow) return cand;
  }
  return null;
}

/** Convenience: the project TODO state for handoff packets. */
export function todoState(cwd: string): TodoItem[] {
  try {
    return listTodos({ cwd });
  } catch {
    return [];
  }
}

/** Job lookup re-export so callers don't need profiles.ts just for this. */
export function jobFor(role: string, tier?: string): Job {
  return jobForRole(role, tier);
}
