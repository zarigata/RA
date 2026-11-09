import { describe, expect, test } from "bun:test";
import { fuzzyMatch, fuzzyFilter, highlightMatches } from "../src/tui/fuzzy.ts";
import { decodeMouse, hexToRgb } from "../src/tui/mouse.ts";
import { decodeKeys } from "../src/tui/keys.ts";
import { renderMarkdown, visibleWidth, truncateVisible } from "../src/tui/markdown.ts";
import { paletteItems, searchPalette, groupRows } from "../src/tui/palette.ts";
import { buildHeader, buildInputLabel, footerHints, getTuiGlyphs, useAsciiGlyphs, workspaceLabel } from "../src/tui/chrome.ts";

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
    expect(visibleWidth("𓂀 RA")).toBe(4);
    expect(truncateVisible("𓂀 RA terminal", 6)).toBe("𓂀 RA…");
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


describe("responsive TUI chrome", () => {
  test("uses Egyptian Unicode chrome by default and portable ASCII on demand", () => {
    expect(useAsciiGlyphs({ TERM: "xterm-256color" })).toBe(false);
    expect(useAsciiGlyphs({ RA_ASCII: "1" })).toBe(true);
    expect(useAsciiGlyphs({ TERM: "dumb" })).toBe(true);
    expect(getTuiGlyphs(false).brand).toBe("𓂀");
    expect(getTuiGlyphs(true).brand).toBe("RA");
  });

  test("header collapses cleanly on narrow terminals", () => {
    const glyphs = getTuiGlyphs(false);
    const narrow = buildHeader({
      width: 56,
      app: "RA",
      version: "1.0.0-ra.77",
      profile: "default",
      smallModel: "provider/very-long-small-model-name",
      bigModel: "provider/very-long-big-model-name",
      glyphs,
    });
    expect(narrow).toContain("𓂀 RA");
    expect(narrow).not.toContain("small ");
    expect(narrow).not.toContain("big ");

    const wide = buildHeader({
      width: 140,
      app: "RA",
      version: "1.0.0-ra.77",
      profile: "default",
      smallModel: "provider/small-model",
      bigModel: "provider/big-model",
      busy: true,
      status: "orchestrating…",
      glyphs,
    });
    expect(wide).toContain("small small-model");
    expect(wide).toContain("big big-model");
    expect(wide).toContain("orchestrating");
  });

  test("input/footer/workspace labels stay consistent", () => {
    const glyphs = getTuiGlyphs(false);
    expect(buildInputLabel({ app: "RA", glyphs })).toContain("/ search");
    expect(buildInputLabel({ app: "RA", busy: true, status: "working", spinner: "⠋", glyphs })).toContain("working");
    expect(footerHints(true).find(([k]) => k === "esc")?.[1]).toBe("cancel");
    expect(workspaceLabel({ cwd: "~/RA", branch: "main", theme: "pharaonic", glyphs })).toContain("⑂ main");
  });

  test("header carries lane/cost/context at wide widths", () => {
    const glyphs = getTuiGlyphs(false);
    const wide = buildHeader({
      width: 120, app: "RA", version: "1.0.0-ra.78", profile: "default",
      smallModel: "ollama-lan/qwen3:4b", bigModel: "ollama-cloud/glm-5.2",
      lane: "small@lan → big@cloud", costUsd: 0.042, contextPct: 42, glyphs,
    });
    expect(wide).toContain("small qwen3:4b");
    expect(wide).toContain("big glm-5.2");
    expect(wide).toContain("small@lan → big@cloud");
    expect(wide).toContain("$0.04");
    expect(wide).toContain("ctx 42%");
  });

  test("header: setupNeeded replaces the lane with the ra setup call-to-action", () => {
    const uni = buildHeader({
      width: 120, app: "RA", version: "1", profile: "default",
      smallModel: undefined, bigModel: undefined, lane: "small@lan", setupNeeded: true, glyphs: getTuiGlyphs(false),
    });
    expect(uni).toContain("▲ no model — run ra setup");
    expect(uni).not.toContain("small@lan");
    const ascii = buildHeader({
      width: 120, app: "RA", version: "1", profile: "default",
      smallModel: undefined, bigModel: undefined, lane: "small@lan", setupNeeded: true, glyphs: getTuiGlyphs(true),
    });
    // ASCII mode: warning comes from the ASCII glyph set, never the Unicode ▲
    expect(ascii).toContain("! no model");
    expect(ascii).not.toContain("▲");
  });

  test("header drops cost/context when absent and keeps medium widths lane-free on crowding", () => {
    const glyphs = getTuiGlyphs(false);
    const wide = buildHeader({ width: 120, app: "RA", version: "1", profile: "default", smallModel: "a/qwen3:4b", bigModel: "b/glm-5.2", glyphs });
    expect(wide).not.toContain("$");
    expect(wide).not.toContain("ctx");
    const mid = buildHeader({ width: 80, app: "RA", version: "1.0.0-ra.78", profile: "default", smallModel: "ollama-lan/qwen3:4b", bigModel: "ollama-cloud/glm-5.2", lane: "small@lan → big@cloud", glyphs });
    expect(mid).toContain("S:qwen3:4b");
    expect(mid).toContain("small@lan");
  });

  test("header never exceeds the terminal width", () => {
    const glyphs = getTuiGlyphs(false);
    for (const width of [60, 80, 120]) {
      const h = buildHeader({
        width, app: "RA", version: "1.0.0-ra.78", profile: "default",
        smallModel: "ollama-lan/qwen3-coder-30b-a3b-instruct", bigModel: "ollama-cloud/deepseek-v4-pro",
        lane: "small@192.168.1.50 · big@cloud", costUsd: 12.345, contextPct: 97, busy: true, status: "orchestrating", glyphs,
      });
      expect(visibleWidth(h)).toBeLessThanOrEqual(width);
    }
  });

  test("header shows a single status glyph on narrow terminals", () => {
    const glyphs = getTuiGlyphs(false);
    const setupNeeded = buildHeader({ width: 60, app: "RA", version: "1", profile: "default", setupNeeded: true, glyphs });
    expect(setupNeeded).toContain("▲");
    expect(setupNeeded).not.toContain("S:");
    const busy = buildHeader({ width: 60, app: "RA", version: "1", profile: "default", busy: true, status: "working", glyphs });
    expect(busy).toContain("◉ working");
  });

  test("status line truncates to width and carries lane", () => {
    const { buildStatusLine } = require("../src/tui/chrome.ts");
    const glyphs = getTuiGlyphs(false);
    const line = buildStatusLine({ width: 60, cwd: "~/very/long/path/to/some/project", branch: "feat/cli-style-setup", theme: "pharaonic", lane: "small@lan → big@cloud", glyphs });
    expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    const roomy = buildStatusLine({ width: 100, cwd: "~/RA", branch: "main", theme: "pharaonic", lane: "small@lan → big@cloud", glyphs });
    expect(roomy).toContain("⑂ main");
    expect(roomy).toContain("small@lan → big@cloud");
    const ascii = buildStatusLine({ width: 100, cwd: "~/RA", branch: "main", theme: "pharaonic", lane: "small@lan", glyphs: getTuiGlyphs(true) });
    expect(ascii).toContain("git main");
    expect(ascii).not.toMatch(/[^\x00-\x7F]/);
  });

  test("spinnerFrame cycles Unicode braille and portable ASCII", () => {
    const { spinnerFrame } = require("../src/tui/chrome.ts");
    expect(spinnerFrame(0)).toBe("⠋");
    expect(spinnerFrame(1)).toBe("⠙");
    expect(spinnerFrame(10)).toBe("⠋"); // wraps
    expect(spinnerFrame(0, true)).toBe("|");
    expect(spinnerFrame(1, true)).toBe("/");
    expect(spinnerFrame(2, true)).toBe("-");
    expect(spinnerFrame(3, true)).toBe("\\");
    expect(spinnerFrame(-1, true)).toBe("\\"); // negative frames wrap safely
    for (let i = 0; i < 8; i++) expect(["|", "/", "-", "\\"].includes(spinnerFrame(i, true))).toBe(true);
  });

  test("status prefixes are consistent per mode", () => {
    const { statusPrefix } = require("../src/tui/chrome.ts");
    expect(statusPrefix("ok").glyph).toBe("✓");
    expect(statusPrefix("warn").glyph).toBe("▲");
    expect(statusPrefix("error").glyph).toBe("✗");
    expect(statusPrefix("info").glyph).toBe("·");
    expect(statusPrefix("busy").glyph).toBe("◉");
    expect(statusPrefix("ok", true).glyph).toBe("+");
    expect(statusPrefix("error", true).glyph).toBe("x");
    expect(statusPrefix("warn", true).glyph).toBe("!");
    expect(statusPrefix("busy", true).glyph).toBe("*");
    expect(statusPrefix("info", true).glyph).toBe("-");
  });

  test("ASCII splash avoids Unicode brand art", () => {
    const { renderSplashFrame, ASCII_LOGO } = require("../src/tui/splash.ts");
    const lines = renderSplashFrame({ width: 60, height: 20, accent: "#fbbf24", accent2: "#22c55e", muted: "#888888", version: "1", ascii: true });
    const joined = lines.join("\n");
    expect(joined).toContain(ASCII_LOGO[0].trim());
    expect(joined).not.toContain("████");
    expect(joined).not.toContain("░");
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

  test("lane line renders under the version, next command hidden on narrow terminals", () => {
    const { renderSplashFrame } = require("../src/tui/splash.ts");
    const wide = renderSplashFrame({ width: 80, height: 24, accent: "#fbbf24", accent2: "#22c55e", muted: "#888888", version: "1", lane: "small@lan → big@cloud", nextCommand: "ra again --quick --verify" });
    expect(wide.join("\n")).toContain("small@lan → big@cloud");
    expect(wide.join("\n")).toContain("ra again --quick --verify");
    const narrow = renderSplashFrame({ width: 60, height: 24, accent: "#fbbf24", accent2: "#22c55e", muted: "#888888", version: "1", lane: "small@lan → big@cloud", nextCommand: "ra again --quick --verify" });
    expect(narrow.join("\n")).toContain("small@lan → big@cloud");
    expect(narrow.join("\n")).not.toContain("ra again");
  });

  test("setup call-to-action appears when no lane exists", () => {
    const { renderSplashFrame } = require("../src/tui/splash.ts");
    const lines = renderSplashFrame({ width: 80, height: 24, accent: "#fbbf24", accent2: "#22c55e", muted: "#888888", version: "1", setupNeeded: true, nextCommand: "ra setup" });
    const joined = lines.join("\n");
    expect(joined).toContain("no model yet — run ra setup after this screen");
    expect(joined).toContain("ra setup");
  });

  test("ASCII splash keeps the lane line but never the Unicode logo/tiles", () => {
    const { renderSplashFrame } = require("../src/tui/splash.ts");
    const lines = renderSplashFrame({ width: 80, height: 24, accent: "#fbbf24", accent2: "#22c55e", muted: "#888888", version: "1", ascii: true, lane: "small@local", nextCommand: "ra setup" });
    const joined = lines.join("\n");
    expect(joined).toContain("small@local");
    expect(joined).toContain("ra setup");
    expect(joined).not.toContain("████");
    expect(joined).not.toContain("░");
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
    const step0 = renderOnboardingOverlay({ screenW: 90, screenH: 30, style: st, step: 1, themes: [{ id: "obsidian", name: "Obsidian" }, { id: "nord", name: "Nord" }], selectedTheme: 0, version: "1" });
    expect(step0.themeHit.size).toBe(2);
    expect(step0.lines.join("\n")).toContain("Step 2/3 — pick a look");
    const step1 = renderOnboardingOverlay({ screenW: 90, screenH: 30, style: st, step: 2, themes: [], selectedTheme: 0, version: "1" });
    expect(step1.actionHit.size).toBe(3);
    expect(step1.lines.join("\n")).toContain("Step 3/3 — what do you want to do first");
  });

  test("setup overlay renders scanning, ask-lan and picking states with hitboxes", () => {
    const { renderSetupOverlay } = require("../src/tui/overlays.ts");
    const scanning = renderSetupOverlay({ screenW: 90, screenH: 30, style: st, phase: "scanning-local", scanLines: ["  ⠋ localhost:11434 Ollama …"], found: [], selected: 0, version: "1" });
    const scanJoined = scanning.lines.join("\n");
    expect(scanJoined).toContain("Step 1/3");
    expect(scanJoined).toContain("localhost:11434");
    const askLan = renderSetupOverlay({ screenW: 90, screenH: 30, style: st, phase: "ask-lan", found: [], selected: 0, version: "1" });
    expect(askLan.hit.get([...askLan.hit.keys()].sort((a, b) => a - b)[0])).toBe("lan:yes");
    expect(askLan.lines.join("\n")).toContain("Scan my local network");
    const pick = renderSetupOverlay({ screenW: 90, screenH: 30, style: st, phase: "pick", found: [{ host: "127.0.0.1", port: 11434, name: "Ollama", models: ["qwen3:4b"], ms: 8 }], small: "ollama-lan/qwen3:4b", selected: 0, version: "1" });
    const pickJoined = pick.lines.join("\n");
    expect(pickJoined).toContain("small  ollama-lan/qwen3:4b");
    expect(pickJoined).toContain("big    unset (local-only)");
    expect([...pick.hit.values()]).toContain("finish");
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

describe("splash renderer", () => {
  test("tiny terminals clip the logo instead of crashing", async () => {
    const { renderSplashFrame } = await import("../src/tui/splash.ts");
    // Found by the one-liner install PTY test: H < logo height made
    // lines[rowIndex] undefined and killed startup.
    for (const [w, h] of [[0, 0], [1, 1], [12, 3], [20, 5], [40, 10], [80, 24]] as const) {
      const lines = renderSplashFrame({ width: w, height: h, accent: "#c89b4b", accent2: "#734b9e", muted: "#888", version: "test" });
      expect(lines.length).toBe(h);
    }
  });
});
