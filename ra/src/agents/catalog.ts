// agents/catalog.ts — the RA agent-library registry (ra.76 "Agent Legion").
// An agent is a Markdown file with YAML frontmatter. Scopes, closest wins:
//   project  <cwd>/.ra/agents/<role>.md
//   user     ~/.ra/agents/<role>.md
//   builtin  anubis/.anubis/agents/<role>.md   (the shipped 76-agent library)
// Hidden agents (mode: hidden) never show in palettes or TASK hints but stay
// programmatically invocable (title / summary / compaction).

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AGENTS_DIR } from "../paths.ts";

export type AgentScope = "project" | "user" | "builtin";
export type AgentMode = "primary" | "subagent" | "hidden" | "all";

export interface CatalogEntry {
  role: string;
  category: string;
  description: string;
  mode: AgentMode;
  scope: AgentScope;
  path: string;
}

export interface ParsedFrontmatter {
  description: string;
  category?: string;
  mode: AgentMode;
}

const ROLE_RE = /^[a-z][a-z0-9_-]{0,63}$/i;
/** Rough token estimate (~4 chars/token) used to budget the TASK hint. */
export const estTokens = (text: string): number => Math.ceil(text.length / 4);

export function agentScopeDirs(cwd = process.cwd()): Array<{ scope: AgentScope; dir: string }> {
  return [
    { scope: "project", dir: join(cwd, ".ra", "agents") },
    { scope: "user", dir: join(homedir(), ".ra", "agents") },
    { scope: "builtin", dir: AGENTS_DIR },
  ];
}

/** Parse the frontmatter fields the catalog cares about. Pure. */
export function parseAgentFrontmatter(raw: string): ParsedFrontmatter {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return { description: "", mode: "subagent" };
  const body = fm[1];
  const desc = body.match(/^description:[ \t]*(.+)$/m)?.[1]?.trim() ?? "";
  const category = body.match(/^category:[ \t]*(.+)$/m)?.[1]?.trim();
  const rawMode = body.match(/^mode:[ \t]*(\w+)$/m)?.[1]?.trim().toLowerCase();
  const mode: AgentMode =
    rawMode === "primary" || rawMode === "hidden" || rawMode === "all" || rawMode === "subagent"
      ? (rawMode as AgentMode)
      : "subagent";
  return { description: desc, category, mode };
}

/** Resolve the winning file for a role across scopes (project > user > builtin). */
export function resolveAgentFile(role: string, cwd = process.cwd()): string | null {
  if (!ROLE_RE.test(role)) return null;
  for (const { dir } of agentScopeDirs(cwd)) {
    const p = join(dir, `${role}.md`);
    if (existsSync(p)) return p;
  }
  return null;
}

const cache = new Map<string, CatalogEntry[]>();

/** Drop the memoized catalog (tests / after scaffolding new agents). */
export function refreshCatalog(): void {
  cache.clear();
}

/** Full catalog, deterministic order: category groups, then role name. */
export function listCatalog(cwd = process.cwd()): CatalogEntry[] {
  const key = cwd;
  const hit = cache.get(key);
  if (hit) return hit;
  const byRole = new Map<string, CatalogEntry>();
  for (const { scope, dir } of agentScopeDirs(cwd)) {
    let files: string[] = [];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const role = f.slice(0, -3);
      if (!ROLE_RE.test(role)) continue;
      if (byRole.has(role)) continue; // closer scope already won
      const path = join(dir, f);
      let parsed: ParsedFrontmatter = { description: "", mode: "subagent" };
      try { parsed = parseAgentFrontmatter(readFileSync(path, "utf-8")); } catch { /* unreadable */ }
      byRole.set(role, {
        role,
        category: parsed.category ?? (scope === "builtin" ? "core" : "custom"),
        description: parsed.description,
        mode: parsed.mode,
        scope,
        path,
      });
    }
  }
  const entries = [...byRole.values()].sort((a, b) =>
    a.category === b.category ? a.role.localeCompare(b.role) : a.category.localeCompare(b.category),
  );
  cache.set(key, entries);
  return entries;
}

/** Catalog minus hidden system agents — what users and models may pick. */
export function visibleCatalog(cwd = process.cwd()): CatalogEntry[] {
  return listCatalog(cwd).filter((e) => e.mode !== "hidden");
}

export function findAgent(role: string, cwd = process.cwd()): CatalogEntry | null {
  return listCatalog(cwd).find((e) => e.role === role) ?? null;
}

/**
 * Compact agent directory for the TASK tool hint, grouped by category.
 * Hard token budget (default 1200) — beyond it, categories collapse to a count
 * so 76 agents can never blow up the system prompt (Claude Code lesson).
 */
export function taskCatalogHint(cwd = process.cwd(), budgetTokens = 1200): string {
  const groups = new Map<string, string[]>();
  for (const e of visibleCatalog(cwd)) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category)!.push(e.role);
  }
  const lines: string[] = [];
  let used = 0;
  const order = [...groups.entries()].sort((a, b) => (a[0] === "core" ? -1 : b[0] === "core" ? 1 : a[0].localeCompare(b[0])));
  for (const [category, roles] of order) {
    const line = `${category}: ${roles.join(", ")}`;
    if (used + estTokens(line) > budgetTokens) {
      lines.push(`${category}: …${roles.length} agents (see /agents)`);
      continue;
    }
    lines.push(line);
    used += estTokens(line);
  }
  return lines.join("\n");
}

/** Human-readable grouped listing for `ra agents` and the /agents command. */
export function formatCatalog(cwd = process.cwd()): string {
  const entries = visibleCatalog(cwd);
  const groups = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category)!.push(e);
  }
  const out: string[] = [`RA agents — ${entries.length} visible (+${listCatalog(cwd).length - entries.length} hidden system)`];
  for (const [category, list] of [...groups.entries()].sort((a, b) => (a[0] === "core" ? -1 : b[0] === "core" ? 1 : a[0].localeCompare(b[0])))) {
    out.push("", `${category} (${list.length})`);
    for (const e of list) {
      const scope = e.scope === "builtin" ? "" : ` · ${e.scope}`;
      out.push(`  ${e.role}${scope} — ${e.description}`);
    }
  }
  return out.join("\n");
}

/** Scaffold a new agent file (project scope by default, `--user` for global). */
export function scaffoldAgent(
  role: string,
  opts: { cwd?: string; user?: boolean; description?: string } = {},
): { path: string } {
  if (!ROLE_RE.test(role)) throw new Error(`Invalid agent name: ${role}`);
  const cwd = opts.cwd ?? process.cwd();
  const dir = opts.user ? join(homedir(), ".ra", "agents") : join(cwd, ".ra", "agents");
  const path = join(dir, `${role}.md`);
  if (existsSync(path)) throw new Error(`Agent already exists: ${path}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `---
description: ${opts.description ?? `Custom agent ${role}.`}
category: custom
mode: subagent
temperature: 0.2
steps: 8
permission:
  edit: ask
  bash: ask
---

You are the ${role}.

Define this agent's behavior here. Keep the description short and
trigger-oriented so the orchestrator knows when to delegate to you.
`);
  refreshCatalog();
  return { path };
}
