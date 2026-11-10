// tui/explorer.ts — the "walk around" split-pane explorer overlay (pure render,
// testable: state in → lines + hitboxes out, no I/O here; the app loads data).
// Left pane: clickable workspace file tree (dirs expand on click).
// Right pane: file preview + symbol outline · agent cards · sessions · web.
// Opened with Ctrl+E or /files via the palette; q/Esc closes; Tab switches the
// right-pane source. ASCII mode (RA_ASCII=1) degrades tree glyphs cleanly.

import { visibleWidth, truncateVisible } from "./markdown.ts";
import { outlineSymbols } from "../symbols.ts";
import type { CatalogEntry } from "../agents/catalog.ts";

export interface TreeNode {
  name: string;
  /** workspace-relative path; "" = the root itself */
  path: string;
  dir: boolean;
  children?: TreeNode[];
}

export interface AgentCard {
  role: string;
  category: string;
  description: string;
  scope: string;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export type RightPane =
  | { kind: "file"; path: string; content: string }
  | { kind: "agent"; card?: AgentCard }
  | { kind: "sessions"; list: Array<{ id: string; cwd: string; messages: number; current: boolean }> }
  | { kind: "web"; results: WebResult[]; query: string; fetched?: string; fetching?: boolean };

export interface ExplorerStyle {
  accent: (s: string) => string;
  strong: (s: string) => string;
  muted: (s: string) => string;
  bar: (s: string) => string;
}

const fit = (width: number, s: string) => {
  const v = visibleWidth(s);
  return v > width ? truncateVisible(s, width) : s + " ".repeat(width - v);
};

/** Hidden dirs never worth showing in the walk-around tree. */
const HIDDEN_DIRS = new Set(["node_modules", ".git", "dist", "build", ".turbo", "coverage", ".next", ".cache"]);
/** ponytail: fixed hidden lists instead of parsing .gitignore patterns —
 * `git ls-files --exclude-standard` (palette.ts collectProjectFiles) is the
 * honored ignore path; these only guard the raw dir walk. Upgrade path:
 * parse .gitignore or `git check-ignore` per entry. */
const IGNORED_FILE_RE = /\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|eot|zip|tar|gz|xz|7z|mp4|mp3|mov|dylib|so|dll|exe|class|pyc|wasm|node|lock)$|^package-lock\./i;

/** Build the workspace tree (sync walk with caps; expand lazily via children=[]).
 *  ponytail: caps (depth 8 / 2000 entries) instead of streaming — giant repos
 *  get "…" per dir. Upgrade path: readdir-on-expand like an IDE sidebar. */
export function buildTree(cwd: string, opts: { maxDepth?: number; maxEntries?: number; fs?: typeof import("node:fs") } = {}): TreeNode {
  const fs = opts.fs ?? require("node:fs") as typeof import("node:fs");
  const maxDepth = opts.maxDepth ?? 8;
  const maxEntries = opts.maxEntries ?? 2000;
  let count = 0;
  const walk = (dir: string, depth: number): TreeNode[] => {
    if (depth > maxDepth || count >= maxEntries) return [];
    let names: string[];
    try { names = fs.readdirSync(dir ? `${cwd}/${dir}` : cwd); } catch { return []; }
    const out: TreeNode[] = [];
    for (const name of names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
      if (count >= maxEntries) { out.push({ name: "...", path: "", dir: false }); break; }
      if (name.startsWith(".") || HIDDEN_DIRS.has(name)) continue;
      const path = dir ? `${dir}/${name}` : name;
      let isDir = false;
      try { isDir = fs.statSync(`${cwd}/${path}`).isDirectory(); } catch { continue; }
      count++;
      if (!isDir && IGNORED_FILE_RE.test(name)) continue;
      // eager one-pass walk within the caps — expand/collapse is pure Set state
      out.push(isDir ? { name, path, dir: true, children: walk(path, depth + 1) } : { name, path, dir: false });
    }
    return [...out.filter((n) => n.dir), ...out.filter((n) => !n.dir)];
  };
  return { name: ".", path: "", dir: true, children: walk("", 0) };
}

/** Toggle one dir path in the expanded set (pure). */
export function toggleDir(expanded: Set<string>, path: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** Flatten the tree into visible rows honoring the expanded set (pure). */
export function flattenTree(root: TreeNode, expanded: Set<string>): Array<TreeNode & { depth: number }> {
  const out: Array<TreeNode & { depth: number }> = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.dir && expanded.has(n.path) && n.children) walk(n.children, depth + 1);
    }
  };
  walk(root.children ?? [], 0);
  return out;
}

export interface TabSpec { id: RightPane["kind"]; label: string }

export const EXPLORER_TABS: TabSpec[] = [
  { id: "file", label: "file" },
  { id: "agent", label: "agents" },
  { id: "sessions", label: "sessions" },
  { id: "web", label: "web" },
  // TODO(explorer): plugin-store tab — the plugins agent owns ra/src/plugins/stores.ts;
  // add { id: "plugins", label: "store" } here once that module lands.
];

export interface ExplorerFrame {
  lines: string[];
  /** screen y → tree row path (left pane clicks). */
  leftHit: Map<number, string>;
  /** screen y → right-pane entry index (agent/session/web row clicks). */
  rightHit: Map<number, number>;
  /** column where the right pane starts (clicks left of it = tree). */
  leftW: number;
  /** title-row tab column ranges: [from, to) on row 0. */
  tabHits: Array<{ from: number; to: number; tab: RightPane["kind"] }>;
}

/** Right-pane render: lines out, each tagged with a clickable entry index. */
interface RightLine { text: string; entry?: number }

export function renderRightPane(right: RightPane, agents: CatalogEntry[], width: number, st: ExplorerStyle, ascii = false): RightLine[] {
  const out: RightLine[] = [];
  const w = Math.max(10, width);
  const curGlyph = ascii ? ">" : "▶";
  const dot = ascii ? "-" : "·";
  const section = ascii ? "-- content --" : "── content ──";
  const fetchedHead = ascii ? "-- fetched page (text) - click another result to switch --" : "── fetched page (text) · click another result to switch ──";
  if (right.kind === "file") {
    if (!right.path) {
      out.push({ text: st.muted("click a file on the left to preview it") });
      out.push({ text: st.muted(`symbol outline ${dot} ${agents.length} agents ${dot} sessions ${dot} /web search in the tabs above`) });
      return out;
    }
    const lines = right.content.split("\n");
    const symbols = outlineSymbols(right.content).slice(0, 40);
    out.push({ text: st.strong(truncateVisible(right.path, w)) });
    out.push({ text: st.muted(`${lines.length} lines ${dot} ${symbols.length} symbols`) });
    out.push({ text: "" });
    for (const s of symbols) out.push({ text: st.muted(`  ${s.line}: ${s.kind} ${s.name}`) });
    out.push({ text: "" });
    out.push({ text: st.muted(section) });
    for (const l of lines.slice(0, 400)) out.push({ text: truncateVisible(l, w) });
    return out;
  }
  if (right.kind === "agent") {
    if (right.card) {
      const c = right.card;
      out.push({ text: st.strong(`agent:${c.role}`) });
      out.push({ text: st.muted(`${c.category} ${dot} ${c.scope}`) });
      out.push({ text: "" });
      for (const l of wrap(c.description || "(no description)", w - 4)) out.push({ text: `  ${l}` });
      out.push({ text: "" });
      out.push({ text: st.muted(`delegate: agent:${c.role} <task> in the prompt`) });
      out.push({ text: st.muted("esc/back: back to the catalog") });
      return out;
    }
    out.push({ text: st.muted(ascii ? "agent catalog - click one for its card" : "agent catalog — click one for its card") });
    out.push({ text: "" });
    agents.slice(0, 300).forEach((a, i) => {
      out.push({ text: `${st.strong(a.role)}${st.muted(` ${dot} ${a.category}`)}`, entry: i });
      out.push({ text: st.muted(`  ${truncateVisible(a.description || "(no description)", w - 4)}`), entry: i });
    });
    return out;
  }
  if (right.kind === "sessions") {
    out.push({ text: st.muted(ascii ? "sessions - click to switch (restart ra to reopen)" : "sessions — click to switch (restart ra to reopen)") });
    out.push({ text: "" });
    right.list.slice(0, 100).forEach((s, i) => {
      const mark = s.current ? st.accent(curGlyph) : "  ";
      out.push({ text: `${mark}${st.strong(truncateVisible(s.id, w - 20))}`, entry: i });
      out.push({ text: st.muted(`  ${truncateVisible(s.cwd, w - 6)} ${dot} ${s.messages} msg`), entry: i });
    });
    if (!right.list.length) out.push({ text: st.muted("  (no saved sessions)") });
    return out;
  }
  // web
  out.push({ text: st.muted(right.query ? `web: ${truncateVisible(right.query, w - 6)}` : "type /web <query> in the prompt to search") });
  out.push({ text: "" });
  if (right.fetching) { out.push({ text: st.muted(ascii ? "fetching..." : "fetching…") }); return out; }
  if (right.fetched != null) {
    out.push({ text: st.muted(fetchedHead) });
    for (const l of right.fetched.split("\n").slice(0, 400)) out.push({ text: truncateVisible(l, w) });
    return out;
  }
  right.results.slice(0, 50).forEach((r, i) => {
    out.push({ text: st.strong(truncateVisible(r.title || r.url, w)), entry: i });
    out.push({ text: st.muted(`  ${truncateVisible(r.url, w - 2)}`), entry: i });
    out.push({ text: st.muted(`  ${truncateVisible(r.snippet, w - 4)}`), entry: i });
    out.push({ text: "" });
  });
  if (!right.results.length && right.query) out.push({ text: st.muted("  (no results)") });
  return out;
}

export function renderExplorer(opts: {
  screenW: number;
  screenH: number;
  root: TreeNode;
  expanded: Set<string>;
  selectedPath?: string;
  right: RightPane;
  agents: CatalogEntry[];
  ascii: boolean;
  style: ExplorerStyle;
}): ExplorerFrame {
  const W = opts.screenW, H = opts.screenH;
  const st = opts.style;
  const leftHit = new Map<number, string>();
  const rightHit = new Map<number, number>();
  const lines: string[] = [];
  const g = opts.ascii
    ? { expanded: "- ", collapsed: "+ ", file: "  ", sel: ">", div: "|", cur: ">" }
    : { expanded: "▾ ", collapsed: "▸ ", file: "  ", sel: "▌", div: "│", cur: "▶" };

  const leftW = Math.max(24, Math.min(38, Math.floor(W / 3)));
  const bodyH = H - 1; // title row + body

  // ---------- title row with clickable tabs ----------
  const tabHits: ExplorerFrame["tabHits"] = [];
  const activeTab = EXPLORER_TABS.find((t) => t.id === opts.right.kind);
  let title = st.strong(` explorer `);
  const tabStartCol = leftW + 2;
  title += " ".repeat(Math.max(0, tabStartCol - visibleWidth(title)));
  let col = tabStartCol;
  for (const t of EXPLORER_TABS) {
    const label = ` ${t.label} `;
    const s = t.id === activeTab?.id ? st.bar(label) : st.muted(label);
    tabHits.push({ from: col, to: col + visibleWidth(label), tab: t.id });
    title += s;
    col += visibleWidth(label);
  }
  title += st.muted(opts.ascii ? "  q close - tab switch" : "  q close · tab switch");
  lines.push(fit(W, title));

  // ---------- body rows ----------
  const rows = flattenTree(opts.root, opts.expanded);
  // ponytail: single scroll window — tree scroll centers on the selected row
  // instead of an independent left scrollbar. Fine for ≤2000-entry trees.
  const selIdx = opts.selectedPath ? rows.findIndex((r) => r.path === opts.selectedPath) : -1;
  const leftScroll = selIdx >= 0 ? Math.max(0, Math.min(selIdx - (bodyH >> 1), rows.length - bodyH)) : 0;
  const visibleRows = rows.slice(leftScroll, leftScroll + bodyH);
  const rightLines = renderRightPane(opts.right, opts.agents, W - leftW - 3, st, opts.ascii);

  for (let y = 0; y < bodyH; y++) {
    const row = visibleRows[y];
    let left = "";
    if (row) {
      const glyph = row.dir ? (opts.expanded.has(row.path) ? g.expanded : g.collapsed) : g.file;
      const marker = row.path === opts.selectedPath ? st.accent(g.sel) : " ";
      const name = row.dir ? st.strong(row.name) : row.name;
      left = `${marker}${"  ".repeat(row.depth)}${glyph}${name}`;
      leftHit.set(y + 1, row.path);
    }
    const rl = rightLines[y];
    if (rl && rl.entry !== undefined) rightHit.set(y + 1, rl.entry);
    const pad = " ".repeat(Math.max(0, leftW - visibleWidth(left)));
    lines.push(fit(W, `${left}${pad}${st.accent(g.div)} ${rl ? rl.text : ""}`));
  }
  return { lines, leftHit, rightHit, leftW, tabHits };
}

/** Naive word wrap for card descriptions. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((cur + " " + word).trim().length > width) { if (cur) out.push(cur); cur = word; }
      else cur = cur ? `${cur} ${word}` : word;
    }
    out.push(cur);
  }
  return out.length ? out : [""];
}

/** Parse toolWebSearch output back into clickable results (pure). */
export function parseWebResults(raw: string): WebResult[] {
  const out: WebResult[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d+)\.\s+(.*)$/.exec(lines[i]!.trim());
    if (!m) continue;
    const url = lines[i + 1]?.trimStart().startsWith("http") ? lines[i + 1]!.trim() : "";
    const snippet = lines[i + 2] && !/^\d+\./.test(lines[i + 2]!.trim()) ? lines[i + 2]!.trim() : "";
    out.push({ title: m[2]!, url, snippet });
  }
  return out;
}
