// rules.ts — instruction loading: imported Cline rules (.ra/rules/) with
// optional `paths:` glob gating + AGENTS.md/RA.md memory-chain resolution.
// Pure FS reads; injected by loadProjectMemory (agent.ts) so rules land where
// project memory already lands.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";

/** Max bytes per memory file (Codex convention: 32 KiB cap). */
export const MEMORY_CAP = 32 * 1024;

/** Shell-style glob → RegExp (`* ** ? [abc] {a,b}` per the Cline spec). */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i += 2; if (glob[i] === "/") i++; continue; }
      re += "[^/]*"; i++; continue;
    }
    if (c === "?") { re += "[^/]"; i++; continue; }
    if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end > i) { re += `(?:${glob.slice(i + 1, end).split(",").map((alt) => alt.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("|")})`; i = end + 1; continue; }
    }
    if (c === "[") {
      const end = glob.indexOf("]", i);
      if (end > i) { re += glob.slice(i, end + 1).replace(/\\/g, "\\\\"); i = end + 1; continue; }
    }
    re += /[.+^${}()|[\]\\$]/.test(c!) ? `\\${c}` : c!;
    i++;
  }
  return new RegExp(`^${re}$`);
}

/** Does a relative file path match any of the `paths:` globs? */
export function matchesPaths(rel: string, globs: string[]): boolean {
  for (const g of globs) {
    try {
      if (globToRegExp(g).test(rel)) return true;
      // `src/**` should also match `src/foo/bar` and the dir itself.
      const base = g.replace(/\/\*+$/, "");
      if (base !== g && (rel === base || rel.startsWith(`${base}/`))) return true;
    } catch { /* malformed glob → fail open (rule inactive on this glob) */ }
  }
  return false;
}

/** Parse `paths: [glob…]` frontmatter (JSON-ish or YAML-ish list). Fail-open: absent → []. */
export function parseRulePaths(raw: string): string[] {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const inline = fm[1].match(/^paths:\s*\[([^\]]*)\]/m);
  if (inline) return inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const block = fm[1].match(/^paths:\s*$/m);
  if (block) {
    const lines = fm[1].split("\n");
    const start = lines.findIndex((l) => /^paths:\s*$/.test(l));
    const out: string[] = [];
    for (const l of lines.slice(start + 1)) {
      const m = l.match(/^\s*-\s*(.+)$/);
      if (!m) break;
      out.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
    if (out.length) return out;
  }
  const bare = fm[1].match(/^paths:\s*(.+)$/m);
  return bare ? [bare[1].trim().replace(/^["']|["']$/g, "")] : [];
}

export interface LoadedRule {
  name: string;
  body: string;
  paths: string[];
}

/**
 * Load rule files from `.ra/rules/` dirs (project cwd up to root, then
 * ~/.ra/rules — same walk as skills). `touchedFiles` (relative paths) gates
 * `paths:`-conditional rules; rules without frontmatter are always on.
 */
export function loadRules(cwd = process.cwd(), touchedFiles: string[] = []): LoadedRule[] {
  const dirs: string[] = [];
  let cur = resolve(cwd);
  for (let depth = 0; depth < 8; depth++) {
    dirs.push(join(cur, ".ra", "rules"));
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  dirs.push(join(homedir(), ".ra", "rules"));
  const out: LoadedRule[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
    for (const f of files) {
      if (seen.has(f)) continue;
      seen.add(f);
      const p = join(dir, f);
      try {
        const raw = readFileSync(p, "utf-8");
        const paths = parseRulePaths(raw);
        // Conditional rule: only when a touched file matches (or the caller
        // passed no file list — startup context gets the always-on set only;
        // callers that want opt-in-everywhere pass ["*"]).
        if (paths.length && !touchedFiles.some((t) => matchesPaths(t, paths))) continue;
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
        if (body) out.push({ name: f.slice(0, -3), body, paths });
      } catch { /* unreadable rule — skip */ }
    }
  }
  return out;
}

/**
 * AGENTS.md / RA.md memory chain: one file per directory level, cwd up to
 * root, plus global ~/.ra/AGENTS.md and ~/.agents/AGENTS.md. Root first,
 * nested after (Codex convention). Each file capped at 32 KiB.
 */
export function loadMemoryChain(cwd = process.cwd()): Array<{ name: string; body: string }> {
  // Collect the chain cwd → root, then emit root-first.
  const chain: Array<{ name: string; body: string }> = [];
  let cur = resolve(cwd);
  const levels: string[] = [];
  for (let depth = 0; depth < 16; depth++) {
    levels.unshift(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const level of levels) {
    for (const name of ["AGENTS.md", "RA.md"]) {
      const p = join(level, name);
      if (!existsSync(p)) continue;
      try {
        let body = readFileSync(p, "utf-8");
        if (body.length > MEMORY_CAP) body = `${body.slice(0, MEMORY_CAP)}\n… (truncated at 32 KiB)`;
        const rel = level === resolve(cwd) ? name : `${level.split("/").pop()}/${name}`;
        if (body.trim()) chain.push({ name: rel, body: body.trim() });
      } catch { /* unreadable */ }
      break; // one memory file per level, first-found wins
    }
  }
  // Global memory applies before project memory.
  for (const p of [join(homedir(), ".ra", "AGENTS.md"), join(homedir(), ".agents", "AGENTS.md")]) {
    try {
      if (!existsSync(p)) continue;
      let body = readFileSync(p, "utf-8");
      if (body.length > MEMORY_CAP) body = `${body.slice(0, MEMORY_CAP)}\n… (truncated at 32 KiB)`;
      if (body.trim()) chain.unshift({ name: `~/${p.split("/").slice(-2).join("/")}`, body: body.trim() });
    } catch { /* unreadable */ }
  }
  return chain;
}
