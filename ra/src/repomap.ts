// repomap.ts — the REPOMAP tool (ra.76): a token-budgeted, ranked overview
// of the repository: files with their top symbols, weighted by symbol count
// and git recency. Gives big-repo context without reading every file.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { outlineSymbols } from "./symbols.ts";

const SOURCE_RE = /\.(ts|tsx|js|jsx|py|go|rs|rb|java|c|h|cpp)$/;

export interface RepoMapEntry {
  path: string;
  symbols: string[];
  score: number;
}

function gitFiles(cwd: string, limit = 600): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd, timeout: 4000, maxBuffer: 4_000_000, encoding: "utf-8" });
    return out.split("\n").filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}

function fileMtime(cwd: string, path: string): number {
  try { return statSync(join(cwd, path)).mtimeMs; } catch { return 0; }
}

/**
 * Pure: rank entries and render within a character budget. Recency is
 * normalized 0..1 across the set; symbol count adds weight; shorter paths
 * get a small bonus (they tend to be load-bearing).
 */
export function buildRepoMap(entries: RepoMapEntry[], budgetChars = 6000): string {
  if (!entries.length) return "(no source files found)";
  const mtimes = entries.map((e) => e.score);
  const maxMtime = Math.max(...mtimes, 1);
  const ranked = [...entries].sort((a, b) => {
    const ra = a.score / maxMtime + Math.min(a.symbols.length, 12) * 0.08 + (1 / (a.path.split("/").length || 1));
    const rb = b.score / maxMtime + Math.min(b.symbols.length, 12) * 0.08 + (1 / (b.path.split("/").length || 1));
    return rb - ra;
  });
  const lines: string[] = ["repo map (ranked by recency + symbols):"];
  let used = 0;
  let shown = 0;
  for (const e of ranked) {
    const line = `  ${e.path}${e.symbols.length ? ` — ${e.symbols.slice(0, 4).join(", ")}` : ""}`;
    if (used + line.length > budgetChars) {
      lines.push(`  … +${ranked.length - shown} more files (READ/GREP the ones you need)`);
      break;
    }
    lines.push(line);
    used += line.length;
    shown++;
  }
  return lines.join("\n");
}

/** Collect symbols for tracked source files (caps work for big repos). */
export function collectRepoEntries(cwd: string, maxFiles = 250): RepoMapEntry[] {
  const files = gitFiles(cwd).filter((f) => SOURCE_RE.test(f));
  const entries: RepoMapEntry[] = [];
  for (const f of files.slice(0, maxFiles)) {
    let symbols: string[] = [];
    try {
      const src = readFileSync(join(cwd, f), "utf-8");
      symbols = outlineSymbols(src)
        .filter((s) => s.kind !== "import")
        .map((s) => s.name)
        .filter(Boolean);
    } catch { /* unreadable/binary */ }
    entries.push({ path: relative(cwd, join(cwd, f)) || f, symbols, score: fileMtime(cwd, f) });
  }
  return entries;
}

export function toolRepoMap(ctx: { cwd: string }, budgetChars = 6000): string {
  return buildRepoMap(collectRepoEntries(ctx.cwd), budgetChars);
}
