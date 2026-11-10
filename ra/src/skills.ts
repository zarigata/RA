// skills.ts — the SKILL tool runtime (ra.76, PLAN.md Phase 1).
// Skills are agent-skills.io style SKILL.md files with name/description
// frontmatter. Sources (both optional): <cwd>/.agents/skills/ and
// ~/.ra/skills/. `SKILL list` shows them; `SKILL <name>` injects the body
// into the conversation so the current agent follows it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
// ponytail: RA_PLUGIN_HOME seam shared with hook-shim — prod callers never set it.
const userHome = () => process.env.RA_PLUGIN_HOME ?? homedir();
import type { RaConfig } from "../../anubis/src/config.ts";

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  source: "project" | "user";
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Skill sources: every `.agents/skills` from cwd up to the repo/root
 * (nearest wins on name conflicts), plus the user-level neutral + compat
 * dirs (~/.ra/skills, ~/.agents/skills, ~/.claude/skills, ~/.codex/skills,
 * ~/.cursor/skills). Project dirs win over user dirs.
 */
export function skillDirs(cwd = process.cwd()): Array<{ source: SkillEntry["source"]; dir: string }> {
  const dirs: Array<{ source: SkillEntry["source"]; dir: string }> = [];
  let cur = resolve(cwd);
  for (let depth = 0; depth < 8; depth++) {
    dirs.push({ source: "project", dir: join(cur, ".agents", "skills") });
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // User-level dirs, RA's own first, then the neutral standard + compat dirs.
  const home = userHome();
  dirs.push(
    { source: "user", dir: join(home, ".ra", "skills") },
    { source: "user", dir: join(home, ".agents", "skills") },
    { source: "user", dir: join(home, ".claude", "skills") },
    { source: "user", dir: join(home, ".codex", "skills") },
    { source: "user", dir: join(home, ".cursor", "skills") },
  );
  return dirs;
}

export function parseSkillFrontmatter(raw: string): { name?: string; description: string } {
  // \r?\n: Windows-authored SKILL.md files (CRLF) must parse identically —
  // Wave 3a fix (was ^---\n only, which dropped the whole frontmatter).
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return { description: "" };
  const name = fm[1].match(/^name:[ \t]*(.+)$/m)?.[1]?.trim();
  // Description may be a folded block scalar (`>` lines).
  const descLine = fm[1].split(/\r?\n/);
  const descIdx = descLine.findIndex((l) => /^description:/.test(l));
  let description = "";
  if (descIdx >= 0) {
    const inline = descLine[descIdx].match(/^description:[ \t]*(.*)$/)?.[1]?.trim();
    if (inline && inline !== ">" && inline !== "|" && inline !== "") {
      description = inline;
    } else {
      const fold: string[] = [];
      for (const l of descLine.slice(descIdx + 1)) {
        if (!/^\s/.test(l) || /^\S/.test(l)) break;
        fold.push(l.trim());
      }
      description = fold.join(" ");
    }
  }
  return { name, description };
}

export function listSkills(cwd = process.cwd()): SkillEntry[] {
  const out = new Map<string, SkillEntry>();
  for (const { source, dir } of skillDirs(cwd)) {
    let entries: string[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const name of entries) {
      const p = join(dir, name, "SKILL.md");
      if (!existsSync(p) || out.has(name)) continue;
      let description = "";
      try { description = parseSkillFrontmatter(readFileSync(p, "utf-8")).description; } catch { /* unreadable */ }
      out.set(name, {
        name,
        description: description || "(no description)",
        path: p,
        source,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The SKILL.md body (after frontmatter), capped for injection. */
export function loadSkillBody(name: string, cwd = process.cwd(), maxChars = 8000): string | null {
  if (!NAME_RE.test(name)) return null;
  for (const { dir } of skillDirs(cwd)) {
    const p = join(dir, name, "SKILL.md");
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf-8");
    const body = raw.split(/^---\n[\s\S]*?\n---\n?/).slice(1).join("---").trim();
    const text = body || raw;
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (skill truncated)` : text;
  }
  return null;
}

/** The permission level for skills from config.permission.skill (default allow). */
export function skillPermission(config: RaConfig): "allow" | "ask" | "deny" {
  const rules = config.permission?.skill ?? {};
  return (rules["*"] ?? "allow") as "allow" | "ask" | "deny";
}

// ---- Strict SKILL.md spec (Codex / agent-skills.io portability) --------------------------

export interface SkillSpecFinding {
  skill: string;
  /** Extra frontmatter keys beyond the strict {name, description} set. */
  extraKeys?: string[];
  /** Spec violations (bad name, missing/too-long description). */
  problems: string[];
}

const STRICT_KEYS = new Set(["name", "description"]);
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parse every frontmatter key (top-level `key:` lines) in a SKILL.md. */
export function frontmatterKeys(raw: string): { keys: string[]; values: Record<string, string> } {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/); // \r?\n: CRLF files (Wave 3a)
  if (!fm) return { keys: [], values: {} };
  const keys: string[] = [];
  const values: Record<string, string> = {};
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    keys.push(m[1]!);
    values[m[1]!] = m[2]!.trim();
  }
  return { keys, values };
}

/**
 * Check one SKILL.md against the strict spec (Codex-strict subset):
 * name ≤64 chars kebab-case matching nothing else required; description
 * present and ≤1024 chars; no extra frontmatter keys (flagged, not fatal —
 * RA's superset reads them fine; they just don't round-trip to Codex).
 */
export function checkSkillStrict(name: string, raw: string): SkillSpecFinding {
  const problems: string[] = [];
  const { keys, values } = frontmatterKeys(raw);
  const extraKeys = keys.filter((k) => !STRICT_KEYS.has(k));
  const fmName = values.name;
  const effName = fmName || name;
  if (!fmName) problems.push("frontmatter `name` missing (dirname would be used on import)");
  else if (fmName.length > 64) problems.push(`name exceeds 64 chars (${fmName.length})`);
  else if (!KEBAB_RE.test(fmName)) problems.push(`name '${fmName}' is not kebab-case`);
  if (fmName && fmName !== name && !KEBAB_RE.test(name)) problems.push(`dirname '${name}' is not kebab-case`);
  const desc = parseSkillFrontmatter(raw).description;
  if (!desc) problems.push("description missing");
  else if (desc.length > 1024) problems.push(`description exceeds 1024 chars (${desc.length})`);
  return { skill: name, ...(extraKeys.length ? { extraKeys } : {}), problems };
}

/** Check every skill visible from `cwd` (project + user dirs) against the strict spec. */
export function checkSkillsStrict(cwd = process.cwd()): SkillSpecFinding[] {
  return listSkills(cwd).map((s) => {
    try { return checkSkillStrict(s.name, readFileSync(s.path, "utf-8")); }
    catch { return { skill: s.name, problems: ["unreadable"] }; }
  });
}


/** `SKILL list` / `SKILL <name>` dispatch (pure-ish; FS reads only). */
export function toolSkill(ctx: { cwd: string }, arg: string, config?: RaConfig): string {
  if (config && skillPermission(config) !== "allow") {
    return `Error: skill use is '${skillPermission(config)}' by config`;
  }
  const a = arg.trim();
  if (!a || a === "list") {
    const skills = listSkills(ctx.cwd);
    if (!skills.length) return "No skills found (.agents/skills/ or ~/.ra/skills/ with SKILL.md files).";
    return [`Skills (${skills.length}):`, ...skills.map((s) => `  ${s.name} [${s.source}] — ${s.description.slice(0, 100)}`)].join("\n");
  }
  const name = a.split(/\s+/)[0];
  const body = loadSkillBody(name, ctx.cwd);
  if (body === null) {
    const known = listSkills(ctx.cwd).map((s) => s.name);
    return `Error: skill '${name}' not found.${known.length ? ` Available: ${known.join(", ")}` : ""}`;
  }
  return `Skill '${name}' loaded. Follow it for the rest of this task:\n\n${body}`;
}
