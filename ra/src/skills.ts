// skills.ts — the SKILL tool runtime (ra.76, PLAN.md Phase 1).
// Skills are agent-skills.io style SKILL.md files with name/description
// frontmatter. Sources (both optional): <cwd>/.agents/skills/ and
// ~/.ra/skills/. `SKILL list` shows them; `SKILL <name>` injects the body
// into the conversation so the current agent follows it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
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
 * (nearest wins on name conflicts), plus the user dir ~/.ra/skills.
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
  dirs.push({ source: "user", dir: join(homedir(), ".ra", "skills") });
  return dirs;
}

export function parseSkillFrontmatter(raw: string): { name?: string; description: string } {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return { description: "" };
  const name = fm[1].match(/^name:[ \t]*(.+)$/m)?.[1]?.trim();
  // Description may be a folded block scalar (`>` lines).
  const descLine = fm[1].split("\n");
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
