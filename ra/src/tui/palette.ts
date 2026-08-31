// tui/palette.ts — the unified "/ everything" palette (pure, testable).
// One searchable space: commands, custom commands, agents, project files,
// sessions, models, and themes. Every item carries an action the app executes.

import { fuzzyFilter, type FuzzyItem } from "./fuzzy.ts";

export type PaletteAction =
  | { type: "command"; command: string }
  | { type: "insert"; text: string }
  | { type: "theme"; theme: string }
  | { type: "model"; slot: "big" | "small"; model: string }
  | { type: "session"; id: string }
  | { type: "exit" };

export interface PaletteEntry {
  label: string;
  category: "command" | "custom" | "agent" | "file" | "session" | "model" | "theme";
  detail?: string;
  action: PaletteAction;
}

export interface PaletteRow {
  entry: PaletteEntry;
  indices: number[];
}

/** Build the item list in source-priority order (commands first). */
export function paletteItems(sources: {
  commands: Array<{ label: string; detail?: string; command: string }>;
  agents: Array<{ name: string; model?: string }>;
  files: string[];
  sessions: Array<{ id: string; detail?: string }>;
  models: string[];
  themes: Array<{ id: string; name: string }>;
}): PaletteEntry[] {
  const items: PaletteEntry[] = [];
  for (const c of sources.commands) {
    items.push({ label: c.label, category: "command", detail: c.detail, action: { type: "command", command: c.command } });
  }
  for (const a of sources.agents) {
    items.push({
      label: `agent:${a.name}`,
      category: "agent",
      detail: a.model ? `delegate a task to ${a.name} (${a.model})` : `delegate a task to ${a.name}`,
      action: { type: "insert", text: `agent:${a.name} ` },
    });
  }
  for (const f of sources.files) {
    items.push({ label: f, category: "file", detail: "insert file reference", action: { type: "insert", text: `@${f} ` } });
  }
  for (const s of sources.sessions) {
    items.push({ label: `session:${s.id}`, category: "session", detail: s.detail ?? "switch session", action: { type: "session", id: s.id } });
  }
  for (const m of sources.models) {
    const slot = /glm|gpt-oss|flash|5\.2|kimi|qwen|deepseek|gemma|minimax|nemotron/i.test(m) && /small/i.test(m) ? "small" : undefined;
    items.push({ label: `model:${m}`, category: "model", detail: "use as implementation model (big)", action: { type: "model", slot: (slot as "big" | "small" | undefined) ?? "big", model: m } });
    items.push({ label: `model-small:${m}`, category: "model", detail: "use as planning model (small)", action: { type: "model", slot: "small", model: m } });
  }
  for (const t of sources.themes) {
    items.push({ label: `theme:${t.id}`, category: "theme", detail: t.name, action: { type: "theme", theme: t.id } });
  }
  items.push({ label: "/exit", category: "command", detail: "quit RA", action: { type: "exit" } });
  return items;
}

/**
 * Filter entries. When the query starts with "/", it is stripped so commands
 * match naturally ("/the" finds theme:…). Otherwise everything is searched.
 * Empty queries keep source order grouped by category.
 */
export function searchPalette(query: string, entries: PaletteEntry[], limit = 40): PaletteRow[] {
  const q = query.startsWith("/") ? query.slice(1) : query;
  if (!q.trim()) {
    const categoryOrder = ["command", "custom", "agent", "file", "session", "model", "theme"] as const;
    const rows: PaletteRow[] = [];
    for (const cat of categoryOrder) {
      for (const e of entries) if (e.category === cat && rows.length < limit) rows.push({ entry: e, indices: [] });
    }
    return rows;
  }
  const items: FuzzyItem<PaletteEntry>[] = entries.map((e) => ({
    text: e.label,
    value: e,
    category: e.category,
    detail: e.detail,
  }));
  const hits = fuzzyFilter(q.trim(), items, limit);
  return hits.map((h) => ({ entry: h.item.value, indices: h.indices }));
}

const GROUP_LABEL: Record<PaletteEntry["category"], string> = {
  command: "Commands",
  custom: "Custom commands",
  agent: "Agents",
  file: "Project files",
  session: "Sessions",
  model: "Models",
  theme: "Themes",
};

/** Insert a dim group header row whenever the category changes (pure). */
export function groupRows(rows: PaletteRow[]): Array<{ kind: "header"; label: string } | { kind: "row"; row: PaletteRow }> {
  const out: Array<{ kind: "header"; label: string } | { kind: "row"; row: PaletteRow }> = [];
  let last = "";
  for (const row of rows) {
    if (row.entry.category !== last) {
      last = row.entry.category;
      out.push({ kind: "header", label: GROUP_LABEL[last] });
    }
    out.push({ kind: "row", row });
  }
  return out;
}

/** List project files for the palette: git ls-files when inside a repo, else a shallow walk. */
export async function collectProjectFiles(cwd: string, limit = 400): Promise<string[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd, timeout: 4000, maxBuffer: 4_000_000 });
    const files = stdout.split("\n").filter(Boolean).filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|lock)$|(^|\/)package-lock\./i.test(f));
    if (files.length) return files.slice(0, limit);
  } catch { /* not a git repo */ }
  // Shallow walk (depth 2) as a fallback so the palette still has files.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 2) return;
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e.startsWith(".") || e === "node_modules") continue;
      const p = path.join(dir, e);
      let st: import("node:fs").Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else out.push(path.relative(cwd, p));
      if (out.length >= limit) return;
    }
  };
  walk(cwd, 0);
  return out;
}
