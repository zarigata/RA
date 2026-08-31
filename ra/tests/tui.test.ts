import { describe, expect, test } from "bun:test";
import { fuzzyMatch, fuzzyFilter, highlightMatches } from "../src/tui/fuzzy.ts";
import { decodeMouse, hexToRgb } from "../src/tui/mouse.ts";
import { decodeKeys } from "../src/tui/keys.ts";
import { renderMarkdown, visibleWidth, truncateVisible } from "../src/tui/markdown.ts";
import { paletteItems, searchPalette, groupRows } from "../src/tui/palette.ts";

describe("fuzzy matcher", () => {
  test("matches subsequence with boundary preference", () => {
    const hit = fuzzyMatch("the", "theme:desert");
    expect(hit.matched).toBe(true);
    const miss = fuzzyMatch("xyz", "theme:desert");
    expect(miss.matched).toBe(false);
  });

  test("ranks prefix matches above scattered ones", () => {
    const items = [
      { text: "/quick", value: 1 },
      { text: "agent:ptah", value: 2 },
    ];
    const ranked = fuzzyFilter("qu", items as never);
    expect(ranked[0].item.text).toBe("/quick");
  });

  test("highlights matched indices", () => {
    const out = highlightMatches("theme", [0, 1], "<", ">");
    expect(out).toBe("<th>eme");
  });

  test("empty query matches everything in order", () => {
    const items = [{ text: "a", value: 1 }, { text: "b", value: 2 }];
    expect(fuzzyFilter("", items as never)).toHaveLength(2);
  });
});

describe("mouse decoding", () => {
  test("decodes SGR press, release, wheel, motion", () => {
    expect(decodeMouse("<0;12;40M")).toMatchObject({ kind: "press", button: "left", x: 12, y: 40 });
    expect(decodeMouse("<0;12;40m")).toMatchObject({ kind: "release", button: "left" });
    expect(decodeMouse("<64;5;5M")).toMatchObject({ kind: "wheel-up" });
    expect(decodeMouse("<65;5;5M")).toMatchObject({ kind: "wheel-down" });
    expect(decodeMouse("<32;5;5M")).toMatchObject({ kind: "motion", button: "left" });
    expect(decodeMouse("<35;5;5M")).toMatchObject({ kind: "motion", button: "none" });
  });

  test("rejects non-mouse bodies", () => {
    expect(decodeMouse("1;2R")).toBeNull();
  });

  test("hex to rgb", () => {
    expect(hexToRgb("#ff8800")).toEqual([255, 136, 0]);
    expect(hexToRgb("#0f0")).toEqual([0, 255, 0]);
  });
});

describe("key decoding", () => {
  test("printable run becomes one text key", () => {
    expect(decodeKeys("/the")).toEqual({ keys: [{ type: "text", text: "/the" }], pending: "" });
  });

  test("enter, arrows, ctrl combos", () => {
    const r = decodeKeys("\rls");
    expect(r.keys[0]).toEqual({ type: "enter" });
    const nav = decodeKeys("\x1b[A\x1b[B\x10");
    expect(nav.keys).toEqual([{ type: "up" }, { type: "down" }, { type: "ctrl", name: "p" }]);
  });

  test("SGR mouse click reaches the app", () => {
    const r = decodeKeys("\x1b[<0;10;5M");
    expect(r.keys[0].type).toBe("mouse");
  });

  test("split escape sequence is held as pending", () => {
    const r = decodeKeys("\x1b");
    expect(r.pending).toBe("\x1b");
    const done = decodeKeys("[A", r.pending);
    expect(done.keys).toEqual([{ type: "up" }]);
  });

  test("bracketed paste", () => {
    const r = decodeKeys("\x1b[200~hello world\x1b[201~");
    expect(r.keys[0]).toEqual({ type: "paste", text: "hello world" });
  });
});

describe("markdown rendering", () => {
  const st = { accent: (s: string) => s, muted: (s: string) => s, strong: (s: string) => s, error: (s: string) => s };
  test("headings, bullets, code fences", () => {
    const lines = renderMarkdown("# Title\n- item one\n```python\nprint(1)\n```", st, 60);
    expect(lines[0]).toContain("Title");
    expect(lines.some((l) => l.includes("· item one"))).toBe(true);
    expect(lines.some((l) => l.includes("print(1)"))).toBe(true);
    expect(lines.some((l) => l.includes("╭─ python"))).toBe(true);
  });

  test("visible width ignores ansi and truncates", () => {
    const s = "\x1b[36mhello\x1b[0m world";
    expect(visibleWidth(s)).toBe(11);
    expect(visibleWidth(truncateVisible(s, 7))).toBeLessThanOrEqual(7);
  });
});

describe("unified palette", () => {
  const entries = paletteItems({
    commands: [
      { label: "/quick", detail: "plan + implement", command: "/quick" },
      { label: "/moa", command: "/moa" },
      { label: "/theme", command: "/theme" },
    ],
    agents: [{ name: "ptah", model: "deepseek" }],
    files: ["src/app.ts", "README.md"],
    sessions: [{ id: "abc", detail: "/tmp/x" }],
    models: ["deepseek-v4-pro:0813"],
    themes: [{ id: "pharaonic", name: "Pharaonic" }],
  });

  test("empty query groups by category order", () => {
    const rows = searchPalette("", entries, 40);
    const groups = groupRows(rows).filter((r) => r.kind === "header").map((r) => (r as { label: string }).label);
    expect(groups[0]).toBe("Commands");
  });

  test("slash-prefixed query finds everything (themes too)", () => {
    const rows = searchPalette("/the", entries, 40);
    const labels = rows.map((r) => r.entry.label);
    expect(labels).toContain("theme:pharaonic");
    expect(labels).toContain("/theme");
  });

  test("file search without slash", () => {
    const rows = searchPalette("app.ts", entries, 40);
    expect(rows[0].entry.label).toBe("src/app.ts");
    expect(rows[0].entry.action.type).toBe("insert");
  });

  test("actions carry runnable semantics", () => {
    const rows = searchPalette("agent:ptah", entries, 40);
    expect(rows[0].entry.action).toEqual({ type: "insert", text: "agent:ptah " });
  });
});
