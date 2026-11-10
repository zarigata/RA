import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTree, flattenTree, toggleDir, renderExplorer, renderRightPane, parseWebResults,
  EXPLORER_TABS, type TreeNode, type RightPane,
} from "../src/tui/explorer.ts";
import { buildStatusLine, getTuiGlyphs } from "../src/tui/chrome.ts";

const st = { accent: (s: string) => s, strong: (s: string) => s, muted: (s: string) => s, bar: (s: string) => s };

let fixture = "";
beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "ra-explorer-"));
  mkdirSync(join(fixture, "src"));
  mkdirSync(join(fixture, "src", "deep"));
  mkdirSync(join(fixture, "node_modules")); // must stay hidden
  mkdirSync(join(fixture, ".git")); // must stay hidden
  writeFileSync(join(fixture, "README.md"), "# hi\n");
  writeFileSync(join(fixture, "src", "app.ts"), "export function main() {\n  return 1;\n}\nconst x = 2;\n");
  writeFileSync(join(fixture, "src", "deep", "util.ts"), "export function util() {}\n");
  writeFileSync(join(fixture, "logo.png"), "binary"); // ignored by extension
});

describe("explorer tree", () => {
  test("buildTree walks caps-hidden dirs, hides dotfiles/node_modules/binaries", () => {
    const root = buildTree(fixture);
    const paths = flattenTree(root, new Set()).map((r) => r.path);
    expect(paths).toContain("src");
    expect(paths).toContain("README.md");
    expect(paths).not.toContain("node_modules");
    expect(paths).not.toContain(".git");
    expect(paths).not.toContain("logo.png");
    // collapsed root shows only top level
    expect(paths).not.toContain("src/app.ts");
  });

  test("toggleDir + flattenTree expand dirs on demand", () => {
    const root = buildTree(fixture);
    const expanded = toggleDir(new Set(), "src");
    const paths = flattenTree(root, expanded).map((r) => r.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("src/deep");
    expect(paths).not.toContain("src/deep/util.ts"); // deep still collapsed
    const collapsed = toggleDir(expanded, "src");
    expect(flattenTree(root, collapsed).map((r) => r.path)).not.toContain("src/app.ts");
  });

  test("caps stop the walk with an overflow marker", () => {
    const root = buildTree(fixture, { maxEntries: 1 });
    const rows = flattenTree(root, new Set());
    expect(rows.some((r) => r.name === "...")).toBe(true);
  });
});

describe("explorer render", () => {
  const root: TreeNode = {
    name: ".", path: "", dir: true,
    children: [
      { name: "src", path: "src", dir: true, children: [{ name: "app.ts", path: "src/app.ts", dir: false }] },
      { name: "README.md", path: "README.md", dir: false },
    ],
  };
  const agents = [
    { role: "ptah", category: "core", description: "the coder agent", mode: "primary" as const, scope: "builtin" as const, path: "/x" },
    { role: "isis", category: "research", description: "research agent", mode: "subagent" as const, scope: "builtin" as const, path: "/y" },
  ];

  test("split panes render: tree left, file preview + symbols right, clickable hitboxes", () => {
    const frame = renderExplorer({
      screenW: 100, screenH: 12, root, expanded: new Set(["src"]), selectedPath: "src/app.ts",
      right: { kind: "file", path: "src/app.ts", content: "export function main() {\n  return 1;\n}\nconst x = 2;\n" },
      agents, ascii: false, style: st,
    });
    expect(frame.lines).toHaveLength(12);
    const joined = frame.lines.join("\n");
    expect(joined).toContain("src");
    expect(joined).toContain("src/app.ts");
    expect(joined).toContain("main"); // symbol outline
    expect(joined).toContain("2 symbols"); // outline count line (main + x)
    // click mapping: tree rows carry left hits, right rows carry entries
    const leftHits = [...frame.leftHit.values()];
    expect(leftHits).toContain("src");
    expect(leftHits).toContain("src/app.ts");
    expect(leftHits).toContain("README.md");
    expect(frame.leftW).toBeGreaterThanOrEqual(24);
    // tabs present and ordered
    expect(frame.tabHits.map((t) => t.tab)).toEqual(["file", "agent", "sessions", "web"]);
    expect(EXPLORER_TABS.map((t) => t.id)).toEqual(["file", "agent", "sessions", "web"]);
  });

  test("agent catalog + agent card panes", () => {
    const catalog = renderRightPane({ kind: "agent" }, agents, 60, st);
    const joined = catalog.map((l) => l.text).join("\n");
    expect(joined).toContain("ptah · core");
    expect(joined).toContain("the coder agent");
    // clicking entry 0 maps to the first agent's card
    const card = renderRightPane({ kind: "agent", card: { role: agents[0]!.role, category: agents[0]!.category, description: agents[0]!.description, scope: agents[0]!.scope } }, agents, 60, st);
    const cardJoined = card.map((l) => l.text).join("\n");
    expect(cardJoined).toContain("agent:ptah");
    expect(cardJoined).toContain("agent:ptah <task>");
  });

  test("sessions pane marks the current session", () => {
    const lines = renderRightPane({ kind: "sessions", list: [
      { id: "/tmp/a", cwd: "/tmp/a", messages: 3, current: false },
      { id: "/tmp/b", cwd: "/tmp/b", messages: 9, current: true },
    ] }, [], 60, st);
    const joined = lines.map((l) => l.text).join("\n");
    expect(joined).toContain("9 msg");
    expect(joined).toContain("▶"); // current marker
  });

  test("web pane renders results and fetched text", () => {
    const results = renderRightPane({ kind: "web", results: parseWebResults("websearch (brave): q\n1. Example\n   https://example.com\n   Some snippet"), query: "q" }, [], 60, st);
    const joined = results.map((l) => l.text).join("\n");
    expect(joined).toContain("https://example.com");
    expect(joined).toContain("Some snippet");
    const fetched = renderRightPane({ kind: "web", results: [], query: "q", fetched: "PAGE BODY" }, [], 60, st);
    expect(fetched.map((l) => l.text).join("\n")).toContain("PAGE BODY");
  });

  test("parseWebResults maps numbered tool output to clickable entries", () => {
    const raw = [
      "websearch (tavily): bun docs",
      "1. Bun Docs",
      "   https://bun.sh/docs",
      "   fast runtime",
      "2. GitHub",
      "   https://github.com",
      "   code hosting",
    ].join("\n");
    expect(parseWebResults(raw)).toEqual([
      { title: "Bun Docs", url: "https://bun.sh/docs", snippet: "fast runtime" },
      { title: "GitHub", url: "https://github.com", snippet: "code hosting" },
    ]);
  });

  test("ASCII fallback degrades tree glyphs and dividers to plain ASCII", () => {
    const frame = renderExplorer({
      screenW: 100, screenH: 10, root, expanded: new Set(), selectedPath: "README.md",
      right: { kind: "file", path: "README.md", content: "# hi\n" }, agents, ascii: true, style: st,
    });
    const joined = frame.lines.join("\n");
    expect(joined).not.toMatch(/[^\x00-\x7F]/); // pure ASCII
    expect(joined).toContain("+ src"); // collapsed dir glyph
    expect(joined).toContain("|"); // divider
    const unicode = renderExplorer({
      screenW: 100, screenH: 10, root, expanded: new Set(), selectedPath: "README.md",
      right: { kind: "file", path: "README.md", content: "# hi\n" }, agents, ascii: false, style: st,
    });
    expect(unicode.lines.join("\n")).toContain("▸ src");
  });
});

describe("lane indicator in the status line", () => {
  test("mode segment appears after theme; ASCII sep holds", () => {
    const glyphs = getTuiGlyphs(false);
    const withMode = buildStatusLine({ width: 100, cwd: "~/RA", branch: "main", theme: "pharaonic", lane: "small@lan → big@cloud", mode: "assistant", glyphs });
    expect(withMode).toContain("lane:assistant");
    expect(withMode).toContain("small@lan → big@cloud");
    const none = buildStatusLine({ width: 100, cwd: "~/RA", theme: "pharaonic", glyphs });
    expect(none).not.toContain("lane:");
    const ascii = buildStatusLine({ width: 100, cwd: "~/RA", theme: "pharaonic", mode: "coding", glyphs: getTuiGlyphs(true) });
    expect(ascii).toContain("lane:coding");
    expect(ascii).not.toMatch(/[^\x00-\x7F]/);
  });
});

// keep fixture cleanup best-effort
afterAll(() => { try { rmSync(fixture, { recursive: true, force: true }); } catch { /* tmp */ } });
