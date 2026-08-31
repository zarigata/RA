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

describe("splash art", () => {
  test("logo renders gradient rows over tiled background", () => {
    const { renderSplashFrame, LOGO } = require("../src/tui/splash.ts");
    const lines = renderSplashFrame({ width: 80, height: 24, accent: "#fbbf24", accent2: "#22c55e", muted: "#888888", version: "1.0.0-ra.73" });
    expect(lines).toHaveLength(24);
    const joined = lines.join("\n");
    for (const row of LOGO) expect(joined).toContain(row.trim().slice(0, 6));
    expect(joined).toContain("R E L I C");
    expect(joined).toContain("press any key");
  });

  test("OSC color reply parsing and luminance", () => {
    const { parseOscColorReply, luminance } = require("../src/tui/splash.ts");
    const reply = "\x1b]11;rgb:1c1c/1c1c/1c1c\x07";
    expect(parseOscColorReply(reply)).toBe("#1c1c1c");
    expect(luminance("#000000")).toBeLessThan(0.1);
    expect(luminance("#ffffff")).toBeGreaterThan(0.9);
  });
});

describe("menu overlays", () => {
  const st = { accent: (s: string) => s, strong: (s: string) => s, muted: (s: string) => s, bar: (s: string) => s };
  test("menu paints a clamped box with click hitboxes", () => {
    const { renderMenuOverlay } = require("../src/tui/overlays.ts");
    const base = Array.from({ length: 20 }, () => "");
    const frame = renderMenuOverlay({ base, screenW: 80, screenH: 20, x: 200, y: 2, title: "RA", entries: [{ label: "Themes", submenu: [] }, { label: "Quit", run: { type: "exit" } }], selected: 0, style: st });
    const hitRows = [...frame.hitbox.keys()];
    expect(hitRows.length).toBe(2);
    expect(Math.max(...hitRows)).toBeLessThan(20);
    const rowText = frame.lines.find((l: { y: number }) => l.y === hitRows[0])?.text ?? "";
    expect(rowText).toContain("Themes");
  });

  test("shortcuts overlay lists keybinds", () => {
    const { renderShortcutsOverlay } = require("../src/tui/overlays.ts");
    const lines = renderShortcutsOverlay({ screenW: 90, screenH: 30, style: st, themeName: "obsidian" });
    const joined = lines.join("\n");
    expect(joined).toContain("search everything");
    expect(joined).toContain("right-click");
    expect(joined).toContain("obsidian");
  });

  test("onboarding wizard has clickable theme and action steps", () => {
    const { renderOnboardingOverlay } = require("../src/tui/overlays.ts");
    const step0 = renderOnboardingOverlay({ screenW: 90, screenH: 30, style: st, step: 0, themes: [{ id: "obsidian", name: "Obsidian" }, { id: "nord", name: "Nord" }], selectedTheme: 0, version: "1" });
    expect(step0.themeHit.size).toBe(2);
    expect(step0.lines.join("\n")).toContain("pick a look");
    const step1 = renderOnboardingOverlay({ screenW: 90, screenH: 30, style: st, step: 1, themes: [], selectedTheme: 0, version: "1" });
    expect(step1.actionHit.size).toBe(3);
    expect(step1.lines.join("\n")).toContain("what do you want to do first");
  });
});

describe("cross-platform backend resolution", () => {
  const { resolveBackend } = require("../src/sandbox.ts");
  const base = { mode: "workspace-write" as const, consent: false, hasSeatbelt: false, bwrapPath: null as string | null };
  test("macOS uses Seatbelt, fails closed without it", () => {
    expect(resolveBackend({ ...base, platform: "darwin", hasSeatbelt: true }).backend).toBe("macOS Seatbelt");
    expect(resolveBackend({ ...base, platform: "darwin" }).backend).toBe("unavailable");
    expect(resolveBackend({ ...base, platform: "darwin", consent: true })).toMatchObject({ backend: "disabled", unsandboxed: true });
  });
  test("linux uses bubblewrap with the real path, requires consent when absent", () => {
    const r = resolveBackend({ ...base, platform: "linux", bwrapPath: "/usr/bin/bwrap" });
    expect(r.backend).toBe("Linux bubblewrap");
    expect(r.bwrapPath).toBe("/usr/bin/bwrap");
    expect(resolveBackend({ ...base, platform: "linux", bwrapPath: null }).backend).toBe("unavailable");
    expect(resolveBackend({ ...base, platform: "linux", bwrapPath: null, consent: true })).toMatchObject({ backend: "disabled", unsandboxed: true });
  });
  test("mode=off is always disabled; other platforms need consent", () => {
    expect(resolveBackend({ ...base, platform: "win32", mode: "off" })).toMatchObject({ backend: "disabled", unsandboxed: true });
    expect(resolveBackend({ ...base, platform: "win32" }).backend).toBe("unavailable");
    expect(resolveBackend({ ...base, platform: "sunos" }).backend).toBe("unavailable");
  });
});
