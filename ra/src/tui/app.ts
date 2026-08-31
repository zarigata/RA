// tui/app.ts — RA full-screen terminal UI (opencode-inspired).
// Startup splash with a gradient ASCII logo over a tiled background, unified
// fuzzy "/" palette (commands, agents, files, sessions, models, themes),
// right-click context menus, "?" shortcuts overlay, first-run onboarding,
// SGR mouse support, markdown rendering, and customization (~/.ra/tui.json).
// Non-TTY stdin falls back to the legacy readline interface.

import * as readline from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { APP_NAME } from "../../../anubis/src/tui.ts";
import { RA_VERSION } from "../../../anubis/src/version.ts";
import { getPalette, listPalettes, type ColorPalette } from "../../../anubis/src/ui.ts";
import { loadRaConfig, ensureRaDirs, applyProjectOverride, applyEnvOverrides } from "../../../anubis/src/config.ts";
import { ANUBIS_HOME } from "../paths.ts";
import { loadEnv } from "../../../anubis/src/env.ts";
import { loadSession, saveSession, appendMessage, formatReattach, getActiveSession, switchSession, listSessions } from "../server/session.ts";
import { RemoteClient } from "../server/remote.ts";
import { SubagentTree } from "./tree.ts";
import { PluginHost } from "../plugins/host.ts";
import { dispatchCommand, PALETTE_COMMANDS, loadCustomCommands, customCommandDirs } from "../commands/index.ts";
import { runOrchestratorTurn, runTaskAgent, onGlobalHook, setActiveSubagentTracker, getActiveSubagentTracker, setActiveStreamRenderer, abortActiveTurn } from "../agent.ts";
import { expandMentions } from "../tools/index.ts";
import { loadUsage, buildReport, formatCost } from "../../../anubis/src/cost.ts";
import { startLegacyTui, type TuiOptions } from "./legacy.ts";
import { highlightMatches } from "./fuzzy.ts";
import { searchPalette, groupRows, collectProjectFiles, type PaletteEntry, type PaletteRow } from "./palette.ts";
import { renderMarkdown, visibleWidth, truncateVisible } from "./markdown.ts";
import { decodeKeys, type Key } from "./keys.ts";
import { MOUSE_ENTER, MOUSE_EXIT, ALT_ENTER, ALT_EXIT, PASTE_ENTER, PASTE_EXIT, SYNC_BEGIN, SYNC_END, CURSOR_HIDE, CURSOR_SHOW, fg as hexFg, bg as hexBg } from "./mouse.ts";
import { renderSplashFrame, parseOscColorReply, luminance, OSC_TITLE, OSC_QUERY_BG } from "./splash.ts";
import { renderMenuOverlay, renderShortcutsOverlay, renderOnboardingOverlay, type MenuEntry } from "./overlays.ts";

export type { TuiOptions };

interface Prefs { theme?: string; mouse?: boolean; scrollSpeed?: number; onboarded?: boolean }
const TUI_PREFS = join(homedir(), ".ra", "tui.json");
function loadPrefs(): Prefs {
  try { return JSON.parse(readFileSync(TUI_PREFS, "utf-8")) as Prefs; } catch { return {}; }
}
function savePrefs(p: Prefs): void {
  try { writeFileSync(TUI_PREFS, JSON.stringify(p, null, 2) + "\n"); } catch { /* read-only home */ }
}

type Segment = { kind: "user" | "assistant" | "info" | "activity"; text: string };
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TIPS = [
  "press / to search EVERYTHING — commands, files, agents, models, themes",
  "right-click anywhere for the context menu",
  "? shows every shortcut",
  "agent:ptah <task> delegates straight to the coder agent",
  "@src/app.ts attaches a file to your prompt",
  "/theme re-skins RA instantly — it stays after restart",
  "/moa asks several agents and synthesizes one answer",
];

export async function startTui(opts: TuiOptions): Promise<void> {
  ensureRaDirs();
  loadEnv(ANUBIS_HOME);
  const activeSession = getActiveSession();
  if (activeSession && !opts.remoteUrl) opts.cwd = activeSession.cwd;
  if (!process.stdin.isTTY || process.env.RA_LEGACY_TUI === "1") return startLegacyTui(opts);
  await startFullscreen(opts);
}

async function startFullscreen(opts: TuiOptions): Promise<void> {
  const config = applyEnvOverrides(applyProjectOverride(loadRaConfig(ANUBIS_HOME), opts.cwd));
  const remote = opts.remoteUrl ? new RemoteClient({ url: opts.remoteUrl }) : null;
  const remoteOk = remote ? await remote.health() : false;
  const session = remoteOk ? await remote.loadSession(opts.cwd) : loadSession(opts.cwd);
  const subagentTree = new SubagentTree();
  setActiveSubagentTracker(subagentTree);
  const plugins = new PluginHost();
  await plugins.load(config.plugin ?? []);
  onGlobalHook("agent.turn.start", (input) => { void plugins.emit("agent.turn.start", input, {}); });
  onGlobalHook("agent.turn.end", (input) => { void plugins.emit("agent.turn.end", input, {}); });

  const stdin = process.stdin;
  const stdout = process.stdout;
  const prefs = loadPrefs();
  let onboarded = prefs.onboarded === true;
  let savedTheme = prefs.theme;
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(ALT_ENTER + CURSOR_HIDE + PASTE_ENTER + (prefs.mouse !== false ? MOUSE_ENTER : "") + OSC_TITLE(`RA — ${opts.cwd}`));

  // Detect the terminal background (OSC 11) so a light terminal gets a light
  // theme by default. Best effort with a short timeout.
  if (!savedTheme) {
    stdout.write(OSC_QUERY_BG);
    savedTheme = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => { stdin.removeListener("data", onBg); resolve(null); }, 500);
      const onBg = (chunk: string) => {
        const hexColor = parseOscColorReply(chunk);
        if (hexColor) {
          clearTimeout(timer);
          stdin.removeListener("data", onBg);
          resolve(luminance(hexColor) > 0.55 ? "papyrus" : "pharaonic");
        }
      };
      stdin.on("data", onBg);
    });
  }

  const themeId = { current: savedTheme ?? config.theme ?? "pharaonic" };
  let palette: ColorPalette = getPalette(themeId.current);
  let previewing = false;
  const scrollSpeed = Math.max(1, prefs.scrollSpeed ?? 3);
  const mdStyle = { accent: (s: string) => sty.accent(s), muted: (s: string) => sty.muted(s), strong: (s: string) => sty.strong(s), error: (s: string) => sty.err(s) };

  const sty = {
    accent: (s: string) => `${hexFg(palette.accent)}${s}\x1b[0m`,
    strong: (s: string) => `\x1b[1m${hexFg(palette.foreground)}${s}\x1b[0m`,
    muted: (s: string) => `\x1b[2m${hexFg(palette.muted)}${s}\x1b[0m`,
    ok: (s: string) => `${hexFg(palette.success)}${s}\x1b[0m`,
    warn: (s: string) => `${hexFg(palette.warning)}${s}\x1b[0m`,
    bar: (s: string) => `${hexBg(palette.accent)}${hexFg(palette.background)}${s}\x1b[0m`,
    chip: (s: string) => `\x1b[2m${hexFg(palette.muted)}${s}\x1b[0m`,
    user: (s: string) => `\x1b[1m${hexFg(palette.accent)}${s}\x1b[0m`,
  };

  // ---------- state ----------
  const segments: Segment[] = [];
  const editor = { text: "", cursor: 0 };
  let scrollOffset = 0;
  let busy = false;
  let statusText = "";
  let spinnerFrame = 0;
  let streaming: Segment | null = null;
  let streamedThisTurn = "";
  let paletteOpen = false;
  let paletteViaSlash = false;
  let paletteRows: PaletteRow[] = [];
  let paletteSelected = 0;
  let paletteScroll = 0;
  let projectFiles: string[] = [];
  let modelCatalog: string[] = [];
  let rowHitbox = new Map<number, number>();
  let modal:
    | null
    | { kind: "menu"; x: number; y: number; title: string; entries: MenuEntry[]; selected: number }
    | { kind: "shortcuts" }
    | { kind: "onboard"; step: 0 | 1; selected: number } = null;
  let menuHitbox = new Map<number, number>();
  let onboardHit = { theme: new Map<number, string>(), action: new Map<number, string>() };
  let tipIndex = 0;
  const ctx = {
    cwd: opts.cwd,
    get history() { return session.messages.slice(0, -1).slice(-8).map((m) => ({ role: m.role, content: m.content.slice(-3000) })); },
  };

  // ---------- output ----------
  const push = (kind: Segment["kind"], text: string) => { segments.push({ kind, text }); scrollOffset = 0; };
  const tip = () => {
    if (!onboarded || session.simpleMode) push("info", `TIP: ${TIPS[tipIndex++ % TIPS.length]}`);
  };
  const reply = (text: string) => {
    if (remoteOk) void remote!.appendMessage(session, "assistant", text);
    else appendMessage(session, "assistant", text);
    const norm = (s: string) => s.replace(/\s+/g, " ");
    const streamed = streamedThisTurn;
    streamedThisTurn = "";
    streaming = null;
    if (streamed.length > 40 && norm(text).includes(norm(streamed).slice(0, 200))) {
      push("info", "↳ streamed above");
    } else {
      push("assistant", text);
    }
    const report = buildReport(loadUsage());
    if (report.length) {
      const total = report.reduce((s, r) => s + r.cost, 0);
      const tokens = report.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
      const top = report.slice(0, 3).map((r) => `  ${r.model}: ${r.inputTokens + r.outputTokens} tok · ${formatCost(r.model, r.cost)}`).join("\n");
      push("info", `context ──\n${top}\n  TOTAL: ${tokens} tok · $${total.toFixed(4)}`);
    }
    if (subagentTree.hasTree) push("info", subagentTree.render());
    tip();
    statusText = "";
    scheduleRender();
  };

  // ---------- palette sources ----------
  const commandEntries = (): PaletteEntry[] => {
    const builtIn: PaletteEntry[] = PALETTE_COMMANDS.map((c) => ({
      label: c,
      category: "command",
      detail: c === "/palette" ? "open this palette" : c === "/quick" ? "plan + implement a task" : c === "/moa" ? "multiple agents, one synthesis" : undefined,
      action: { type: "command", command: c },
    }));
    let custom: PaletteEntry[] = [];
    try {
      custom = loadCustomCommands(customCommandDirs(opts.cwd)).map((cc) => ({
        label: `/${cc.name}`,
        category: "custom" as const,
        detail: (cc as { description?: string }).description ?? `custom command · agent: ${(cc as { agent?: string }).agent ?? "anubis"}`,
        action: { type: "command" as const, command: `/${cc.name}` },
      }));
    } catch { /* no custom dirs */ }
    return [...builtIn, ...custom];
  };
  const agentEntries = (): PaletteEntry[] => Object.entries(config.agent ?? {}).map(([name, a]) => ({
    label: `agent:${name}`,
    category: "agent" as const,
    detail: `delegate directly to ${name}${(a as { model?: string }).model ? ` · ${(a as { model?: string }).model}` : ""}`,
    action: { type: "insert" as const, text: `agent:${name} ` },
  }));
  const themeEntries = (): PaletteEntry[] => listPalettes().map((p) => ({
    label: `theme:${p.name.toLowerCase()}`,
    category: "theme" as const,
    detail: `${p.name} · accent ${p.accent}`,
    action: { type: "theme" as const, theme: p.name.toLowerCase() },
  }));
  const modelEntries = (): PaletteEntry[] => {
    const models = [...new Set([config.model, config.small_model, ...modelCatalog].filter(Boolean))] as string[];
    return models.flatMap((m) => [
      { label: `model:${m}`, category: "model" as const, detail: "use as implementation model", action: { type: "model" as const, slot: "big" as const, model: m } },
      { label: `model-small:${m}`, category: "model" as const, detail: "use as planning model", action: { type: "model" as const, slot: "small" as const, model: m } },
    ]);
  };
  const sessionEntries = (): PaletteEntry[] => {
    try {
      return listSessions().slice(0, 20).map((s) => ({
        label: `session:${(s as { id?: string }).id ?? (s as { cwd?: string }).cwd}`,
        category: "session" as const,
        detail: (s as { cwd?: string }).cwd ?? "",
        action: { type: "session" as const, id: String((s as { id?: string }).id ?? (s as { cwd?: string }).cwd) },
      }));
    } catch { return []; }
  };
  const allEntries = (): PaletteEntry[] => [
    ...commandEntries(),
    ...agentEntries(),
    ...themeEntries(),
    ...modelEntries(),
    ...sessionEntries(),
    ...projectFiles.map((f) => ({ label: f, category: "file" as const, detail: "insert @file reference", action: { type: "insert" as const, text: `@${f} ` } })),
    { label: "/exit", category: "command", detail: "quit RA", action: { type: "exit" as const } },
  ];
  const refreshPalette = () => {
    paletteRows = searchPalette(editor.text, allEntries(), 40);
    paletteSelected = Math.min(paletteSelected, Math.max(0, paletteRows.length - 1));
    paletteScroll = Math.min(paletteScroll, paletteSelected);
  };
  const setTheme = (id: string, persist: boolean) => {
    palette = getPalette(id);
    themeId.current = id;
    if (persist) savePrefs({ ...prefs, theme: id });
  };

  void collectProjectFiles(opts.cwd).then((f) => { projectFiles = f; if (paletteOpen) { refreshPalette(); scheduleRender(); } }).catch(() => {});
  void (async () => {
    try {
      const key = process.env.OLLAMA_API_KEY;
      if (!key) return;
      const res = await fetch("https://ollama.com/api/tags", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
      const j = await res.json() as { models?: Array<{ name: string }> };
      modelCatalog = (j.models ?? []).map((m) => m.name);
      if (paletteOpen) { refreshPalette(); scheduleRender(); }
    } catch { /* offline */ }
  })();

  // ---------- screen ----------
  let screenWidth = process.stdout.columns ?? 100;
  let screenHeight = process.stdout.rows ?? 30;
  const fit = (width: number, s: string) => { const v = visibleWidth(s); return v > width ? truncateVisible(s, width) : s + " ".repeat(width - v); };

  const gitBranch = (): string => {
    try {
      return execSync("git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD", { cwd: opts.cwd, timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { return ""; }
  };
  let branchCache = "";
  let branchAt = 0;
  const branch = (): string => {
    if (Date.now() - branchAt > 10_000) { branchCache = gitBranch(); branchAt = Date.now(); }
    return branchCache;
  };
  const short = (model?: string): string => {
    if (!model) return "?";
    const bare = model.includes("/") ? model.split("/").pop()! : model;
    return bare.length > 24 ? bare.slice(0, 23) + "…" : bare;
  };

  const renderViewportLines = (width: number): string[] => {
    const lines: string[] = [];
    for (const seg of segments) {
      if (seg.kind === "user") {
        lines.push("");
        lines.push(sty.user("  ▸ you"));
        for (const l of renderMarkdown(seg.text, mdStyle, width - 4)) lines.push(`    ${l}`);
      } else if (seg.kind === "assistant") {
        lines.push("");
        lines.push(sty.ok("  ◆ RA"));
        for (const l of renderMarkdown(seg.text, mdStyle, width - 4)) lines.push(`  ${l}`);
      } else if (seg.kind === "info") {
        lines.push("");
        for (const l of seg.text.split("\n")) lines.push(sty.muted(`  ${l}`));
      } else {
        lines.push(sty.warn(`  ⚠ ${seg.text}`));
      }
    }
    if (streaming) {
      lines.push("");
      lines.push(sty.ok("  ◆ RA"));
      for (const l of renderMarkdown(streaming.text + "▌", mdStyle, width - 4)) lines.push(`  ${l}`);
    }
    return lines;
  };

  const render = () => {
    const W = screenWidth, H = screenHeight;
    const out: string[] = [];

    const cwdShort = opts.cwd.replace(/^\/Users\/[^/]+/, "~");
    const busyTag = busy ? `  ● ${statusText || "busy"}` : "";
    const header = ` 𓃡 ${APP_NAME} ${RA_VERSION}  ·  ${config.profile ?? "default"}  ·  small ${short(config.small_model)} · big ${short(config.model)}${busyTag}`;
    out.push(sty.bar(fit(W, header)));

    if (paletteOpen) {
      const title = ` search everything — commands · agents · files · models · sessions · themes `;
      out.push(sty.accent(`╭${"─".repeat(Math.max(0, W - 2))}╮`));
      out.push(sty.accent("│") + fit(W - 2, sty.strong(title)) + sty.accent("│"));
      out.push(sty.accent(`├${"─".repeat(Math.max(0, W - 2))}┤`));
      const rows = groupRows(paletteRows);
      const maxRows = Math.max(3, H - 12);
      const start = Math.max(0, Math.min(paletteScroll, rows.length - maxRows));
      const visible = rows.slice(start, start + maxRows);
      rowHitbox = new Map();
      let idx = -1;
      for (const r of visible) {
        if (r.kind === "header") { out.push(sty.muted(fit(W, ` ${r.label.toUpperCase()}`))); continue; }
        idx++;
        const selected = idx === paletteSelected;
        const marker = selected ? sty.accent("▌") : " ";
        const label = highlightMatches(r.row.entry.label, r.row.indices, `\x1b[1m${hexFg(palette.foreground)}`, "\x1b[0m");
        const detail = r.row.entry.detail ? sty.muted(` — ${truncateVisible(r.row.entry.detail, Math.max(10, W - visibleWidth(r.row.entry.label) - 14))}`) : "";
        out.push(fit(W - 1, ` ${marker}${label}${detail}`));
        rowHitbox.set(out.length, idx);
      }
      if (!paletteRows.length) out.push(sty.muted(fit(W, "  no matches — keep typing")));
      out.push(sty.muted(fit(W, `  ↑↓ select · enter run · tab insert · esc close · mouse clickable (${paletteRows.length})`)));
      out.push(sty.accent(`╰${"─".repeat(Math.max(0, W - 2))}╯`));
    } else {
      const vLines = renderViewportLines(W);
      const maxVisible = Math.max(4, H - 6);
      const from = Math.max(0, vLines.length - maxVisible - scrollOffset);
      const visible = vLines.slice(from, from + maxVisible);
      for (let i = 0; i < maxVisible; i++) out.push(fit(W, visible[i] ?? ""));
      scrollOffset = Math.min(scrollOffset, Math.max(0, vLines.length - maxVisible));
    }

    const label = busy ? ` ⣿ ${SPINNER[spinnerFrame % SPINNER.length]} ${statusText || "working…"} ` : ` ${APP_NAME} › type / to search everything · ? for shortcuts `;
    const cursorAt = Math.min(editor.cursor, editor.text.length);
    const before = editor.text.slice(0, cursorAt);
    const at = editor.text.slice(cursorAt, cursorAt + 1) || " ";
    const after = editor.text.slice(cursorAt + 1);
    const inputLine = `${sty.accent(before)}${hexBg(palette.accent)}${hexFg(palette.background)}${at}\x1b[0m${sty.accent(after)}`;
    out.push(sty.accent(`╭${label}${"─".repeat(Math.max(0, W - visibleWidth(label) - 2))}╮`));
    out.push(sty.accent("│") + fit(W - 2, inputLine) + sty.accent("│"));
    out.push(sty.accent(`╰${"─".repeat(Math.max(0, W - 2))}╯`));

    const chips: Array<[string, string]> = [
      ["/", "everything"],
      ["ctrl+p", "palette"],
      ["?", "shortcuts"],
      ["esc", busy ? "cancel" : "close"],
      ["ctrl+d", "quit"],
    ];
    let chipLine = " ";
    for (const [k, v] of chips) chipLine += sty.bar(` ${k} `) + sty.chip(` ${v} `);
    const right = `${cwdShort}${branch() ? ` · ⑂ ${branch()}` : ""} · ${themeId.current}`;
    out.push(fit(Math.max(0, W - visibleWidth(right) - 1), chipLine) + sty.muted(right));

    // modals paint over the base frame
    if (modal?.kind === "menu") {
      const frame = renderMenuOverlay({
        base: out.slice(0, H - 1),
        screenW: W, screenH: H,
        x: modal.x, y: modal.y,
        title: modal.title,
        entries: modal.entries,
        selected: modal.selected,
        style: { accent: sty.accent, strong: sty.strong, muted: sty.muted, bar: sty.bar },
      });
      menuHitbox = frame.hitbox;
      out.length = 0;
      for (const l of frame.lines) out[l.y] = l.text;
      for (let i = 0; i < H; i++) out[i] ??= "";
    } else if (modal?.kind === "shortcuts") {
      const lines = renderShortcutsOverlay({ screenW: W, screenH: H, style: { accent: sty.accent, strong: sty.strong, muted: sty.muted, bar: sty.bar }, themeName: themeId.current });
      out.length = 0;
      out.push(...lines);
    } else if (modal?.kind === "onboard") {
      const frame = renderOnboardingOverlay({
        screenW: W, screenH: H,
        style: { accent: sty.accent, strong: sty.strong, muted: sty.muted, bar: sty.bar },
        step: modal.step,
        themes: listPalettes().map((p) => ({ id: p.name.toLowerCase(), name: p.name })),
        selectedTheme: modal.selected,
        version: RA_VERSION,
      });
      onboardHit = { theme: frame.themeHit, action: frame.actionHit };
      out.length = 0;
      out.push(...frame.lines);
    }

    while (out.length < H) out.push("");
    const frame = SYNC_BEGIN + "\x1b[H" + out.slice(0, H).map((l) => fit(W, l ?? "") + "\x1b[K").join("\n") + SYNC_END;
    process.stdout.write(frame);
  };

  let renderScheduled = false;
  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    setTimeout(() => { renderScheduled = false; try { render(); } catch { /* mid-resize */ } }, 24);
  };

  // ---------- history seeding ----------
  if (session.messages.length === 0) {
    push("info", [
      `Welcome to ${APP_NAME}.`,
      `  /                search EVERYTHING — commands · agents · files · models · themes`,
      `  /quick <task>    plan + implement`,
      `  /moa <task>      multiple agents, one synthesis`,
      `  agent:<name> …   delegate to one agent directly`,
      `  ?                all shortcuts`,
      `small: ${config.small_model} · code: ${config.model}`,
    ].join("\n"));
  } else {
    push("info", formatReattach(session) + "\n/history to review · /clear to reset");
  }

  // ---------- palette / modal actions ----------
  const openPalette = (query: string) => {
    modal = null;
    paletteOpen = true;
    paletteViaSlash = query.startsWith("/");
    editor.text = query;
    editor.cursor = editor.text.length;
    paletteSelected = 0;
    paletteScroll = 0;
    refreshPalette();
    scheduleRender();
  };
  const closePalette = () => {
    paletteOpen = false;
    if (previewing) { previewing = false; setTheme(themeId.current, false); }
    if (paletteViaSlash && editor.text.startsWith("/")) { editor.text = ""; editor.cursor = 0; }
    paletteViaSlash = false;
    scheduleRender();
  };
  const insertAtCursor = (t: string) => editor.text.slice(0, editor.cursor) + t + editor.text.slice(editor.cursor);

  const quit = () => {
    saveSession(session);
    stdout.write(MOUSE_EXIT + PASTE_EXIT + CURSOR_SHOW + ALT_EXIT);
    stdin.setRawMode(false);
    setActiveSubagentTracker(null);
    setActiveStreamRenderer(null);
    process.exit(0);
  };

  const runAction = (a: Record<string, unknown>) => {
    const type = a.type as string;
    if (type === "exit") { quit(); return; }
    if (type === "command") { void submit(String(a.command)); return; }
    if (type === "insert") { editor.text = insertAtCursor(String(a.text)); editor.cursor += String(a.text).length; scheduleRender(); return; }
    if (type === "theme") { setTheme(String(a.theme), true); push("info", `theme → ${String(a.theme)} (saved)`); scheduleRender(); return; }
    if (type === "model") {
      if (a.slot === "small") config.small_model = String(a.model); else config.model = String(a.model);
      push("info", `${String(a.slot)} model → ${String(a.model)} (this session)`);
      scheduleRender();
      return;
    }
    if (type === "session") {
      try {
        switchSession(String(a.id));
        push("info", `session pointer → ${String(a.id)}. Restart ra to open it.`);
      } catch (e) { push("activity", `session switch failed: ${String(e)}`); }
      scheduleRender();
    }
  };

  const mainMenuEntries = (): MenuEntry[] => [
    { label: "Search everything", detail: "commands · files · agents · models · themes", run: { type: "palette" } },
    { label: "Themes", detail: `${listPalettes().length} looks, live preview`, submenu: themeEntries().map((e) => ({ label: e.label, detail: e.detail, run: e.action as unknown as Record<string, unknown> })) },
    { label: "Models", submenu: modelEntries().slice(0, 20).map((e) => ({ label: e.label, detail: e.detail, run: e.action as unknown as Record<string, unknown> })) },
    { label: "Agents", submenu: agentEntries().map((e) => ({ label: e.label, detail: e.detail, run: e.action as unknown as Record<string, unknown> })) },
    { separator: true, label: "" },
    { label: "Shortcuts", detail: "?", run: { type: "shortcuts" } },
    { label: "Clear screen", run: { type: "clearscreen" } },
    ...(busy ? [{ label: "Cancel task", detail: statusText, run: { type: "cancel" } }] : []),
    { label: "Quit RA", run: { type: "exit" } },
  ];

  const activateMenuEntry = (e: MenuEntry) => {
    if (e.submenu) {
      modal = { kind: "menu", x: (screenWidth / 2) | 0, y: 4, title: e.label, entries: e.submenu, selected: 0 };
      scheduleRender();
      return;
    }
    modal = null;
    const run = e.run ?? {};
    if (run.type === "palette") { openPalette(""); return; }
    if (run.type === "shortcuts") { modal = { kind: "shortcuts" }; scheduleRender(); return; }
    if (run.type === "clearscreen") { segments.length = 0; scheduleRender(); return; }
    if (run.type === "cancel") { if (abortActiveTurn()) statusText = "cancelling…"; scheduleRender(); return; }
    runAction(run);
  };

  // ---------- submit ----------
  const submit = async (raw: string) => {
    const input = raw.trim();
    editor.text = ""; editor.cursor = 0; scrollOffset = 0;
    if (!input) return;
    if (input === "/exit" || input === "exit" || input === "/quit") { quit(); return; }
    if (input === "/palette") { openPalette(""); return; }
    if (input === "/themes" || input === "/theme") { openPalette("theme:"); return; }
    if (input === "/shortcuts" || input === "?") { modal = { kind: "shortcuts" }; scheduleRender(); return; }
    push("user", input);
    render();
    if (remoteOk) void remote!.appendMessage(session, "user", input);
    else appendMessage(session, "user", input);
    busy = true;
    try {
      const agentM = /^agent:([a-z0-9_-]+)\s*([\s\S]*)$/i.exec(input);
      if (agentM) {
        const role = agentM[1].toLowerCase();
        statusText = `${role} working…`;
        scheduleRender();
        const result = await runTaskAgent(role, agentM[2].trim() || `Introduce yourself as the ${role} agent in one short paragraph.`, config, { cwd: opts.cwd, filesWritten: [] }, loadEnv(ANUBIS_HOME));
        streamedThisTurn = "";
        reply(result.output);
      } else if (input.startsWith("/")) {
        const handled = await dispatchCommand(input, { config, session, plugins, ctx, reply });
        if (handled) saveSession(session);
        else push("activity", `unknown command ${input} — press / to search`);
      } else {
        const enhanced = await plugins.appendPrompt(input);
        const withFiles = expandMentions(enhanced, opts.cwd);
        statusText = "orchestrating…";
        scheduleRender();
        const out = await runOrchestratorTurn(withFiles, config, ctx);
        streamedThisTurn = "";
        reply(out);
      }
    } catch (e) {
      streamedThisTurn = "";
      streaming = null;
      reply(`Error: ${String(e)}`);
    } finally {
      busy = false;
      statusText = "";
      tip();
      scheduleRender();
      saveSession(session);
    }
  };

  // ---------- streaming ----------
  let streamTimer: ReturnType<typeof setTimeout> | null = null;
  setActiveStreamRenderer((tok) => {
    streamedThisTurn += tok;
    if (!streaming) streaming = { kind: "assistant", text: tok };
    else streaming.text += tok;
    if (!statusText) statusText = "responding…";
    if (!streamTimer) streamTimer = setTimeout(() => { streamTimer = null; render(); }, 40);
  });
  const spinnerTimer = setInterval(() => {
    if (!busy) return;
    spinnerFrame++;
    render();
  }, 140);

  // ---------- terminal ----------
  stdout.on("resize", () => { screenWidth = stdout.columns ?? screenWidth; screenHeight = stdout.rows ?? screenHeight; render(); });
  const cleanup = () => {
    clearInterval(spinnerTimer);
    stdout.write(MOUSE_EXIT + PASTE_EXIT + CURSOR_SHOW + ALT_EXIT);
    stdin.setRawMode(false);
    setActiveSubagentTracker(null);
    setActiveStreamRenderer(null);
    saveSession(session);
  };
  process.on("exit", cleanup);

  const closeMenu = () => { if (modal?.kind === "menu") modal = null; scheduleRender(); };

  // ---------- keys ----------
  let pending = "";
  stdin.on("data", (chunk: string) => {
    const { keys, pending: rest } = decodeKeys(chunk.toString("utf-8"), pending);
    pending = rest;
    for (const key of keys) handleKey(key);
  });

  function handleKey(k: Key): void {
    switch (k.type) {
      case "osc":
        return;
      case "f":
        if (k.n === 1) { modal = modal?.kind === "shortcuts" ? null : { kind: "shortcuts" }; scheduleRender(); }
        return;
      case "mouse": {
        const ev = k.event;
        if (ev.kind === "wheel-up" || ev.kind === "wheel-down") {
          const dir = ev.kind === "wheel-up" ? -1 : 1;
          if (modal?.kind === "menu") {
            const n = modal.entries.filter((e) => !e.separator).length;
            modal.selected = Math.max(0, Math.min(n - 1, modal.selected + dir));
          } else if (!paletteOpen) {
            scrollOffset = Math.max(0, scrollOffset + dir * scrollSpeed * 3);
          }
          render();
          return;
        }
        if (ev.kind === "press" && ev.button === "right") {
          modal = { kind: "menu", x: ev.x, y: ev.y, title: "RA", entries: mainMenuEntries(), selected: 0 };
          render();
          return;
        }
        if (ev.kind !== "press" || ev.button !== "left") return;
        if (modal?.kind === "menu") {
          const hit = menuHitbox.get(ev.y);
          if (hit === undefined) { closeMenu(); return; }
          const actionable = modal.entries.filter((e) => !e.separator);
          const entry = actionable[hit];
          if (entry) activateMenuEntry(entry);
          return;
        }
        if (modal?.kind === "shortcuts") { modal = null; scheduleRender(); return; }
        if (modal?.kind === "onboard") {
          const themeHit = onboardHit.theme.get(ev.y);
          if (themeHit !== undefined && modal.step === 0) {
            setTheme(themeHit, true);
            modal = { kind: "onboard", step: 1, selected: 0 };
            scheduleRender();
            return;
          }
          const actionPrefix = onboardHit.action.get(ev.y);
          if (actionPrefix !== undefined && modal.step === 1) {
            finishOnboarding();
            if (actionPrefix) void submit(actionPrefix + "make a tiny colorful index.html that prints hello from RA");
            return;
          }
          finishOnboarding();
          return;
        }
        if (paletteOpen) {
          const hit = rowHitbox.get(ev.y);
          if (hit !== undefined) { activateRow(hit); return; }
          if (ev.y === 1) { modal = { kind: "menu", x: ev.x, y: ev.y, title: "RA", entries: mainMenuEntries(), selected: 0 }; render(); return; }
          if (ev.y < screenHeight - 3) closePalette();
          return;
        }
        if (ev.y === 1) { modal = { kind: "menu", x: ev.x, y: ev.y, title: "RA", entries: mainMenuEntries(), selected: 0 }; render(); return; }
        if (ev.y >= screenHeight - 1) { openPalette("theme:"); return; }
        return;
      }
      case "ctrl":
        if (k.name === "d") { quit(); return; }
        if (k.name === "c") {
          if (modal) { modal = null; scheduleRender(); return; }
          if (busy) { if (abortActiveTurn()) statusText = "cancelling…"; }
          else { editor.text = ""; editor.cursor = 0; }
          scheduleRender();
          return;
        }
        if (k.name === "p") {
          if (modal) { modal = null; scheduleRender(); return; }
          if (paletteOpen) closePalette(); else openPalette("");
          return;
        }
        if (k.name === "l") { segments.length = 0; scheduleRender(); return; }
        if (k.name === "u") { editor.text = ""; editor.cursor = 0; scheduleRender(); return; }
        return;
      case "escape":
        if (modal) { if (modal.kind !== "onboard") modal = null; scheduleRender(); return; }
        if (paletteOpen) { closePalette(); return; }
        if (busy) { if (abortActiveTurn()) statusText = "cancelling…"; scheduleRender(); return; }
        editor.text = ""; editor.cursor = 0; scheduleRender();
        return;
      case "f":
        if (k.n === 1) { modal = modal?.kind === "shortcuts" ? null : { kind: "shortcuts" }; scheduleRender(); }
        return;
      case "enter":
        if (modal?.kind === "menu") {
          const actionable = modal.entries.filter((e) => !e.separator);
          const entry = actionable[modal.selected];
          if (entry) activateMenuEntry(entry);
          return;
        }
        if (modal?.kind === "onboard") {
          if (modal.step === 0) {
            const themes = listPalettes().map((p) => p.name.toLowerCase());
            setTheme(themes[modal.selected] ?? themeId.current, true);
            modal = { kind: "onboard", step: 1, selected: 0 };
          } else {
            const prefixes = ["/quick ", "/moa ", ""];
            const prefix = prefixes[modal.selected] ?? "";
            finishOnboarding();
            if (prefix) void submit(prefix + "make a tiny colorful index.html that prints hello from RA");
            return;
          }
          scheduleRender();
          return;
        }
        if (paletteOpen) { activateRow(paletteSelected); return; }
        { const t = editor.text; editor.text = ""; editor.cursor = 0; void submit(t); }
        return;
      case "tab": {
        if (!paletteOpen || !paletteRows[paletteSelected]) return;
        const label = paletteRows[paletteSelected].entry.label;
        if (/^(agent:|\/)/.test(label)) {
          editor.text = label + " ";
          editor.cursor = editor.text.length;
          refreshPalette();
        } else {
          editor.text = insertAtCursor(label);
          editor.cursor += label.length;
          closePalette();
          return;
        }
        render();
        return;
      }
      case "shifttab":
        if (paletteOpen) { paletteSelected = Math.max(0, paletteSelected - 1); paletteScroll = Math.min(paletteScroll, paletteSelected); render(); }
        return;
      case "up":
        if (modal?.kind === "menu") {
          const n = modal.entries.filter((e) => !e.separator).length;
          modal.selected = (modal.selected - 1 + n) % n;
          render();
          return;
        }
        if (modal?.kind === "onboard") { modal.selected = Math.max(0, modal.selected - 1); render(); return; }
        if (paletteOpen) { paletteSelected = Math.max(0, paletteSelected - 1); if (paletteSelected < paletteScroll) paletteScroll = paletteSelected; livePreview(); render(); return; }
        scrollOffset += 3; render(); return;
      case "down":
        if (modal?.kind === "menu") {
          const n = modal.entries.filter((e) => !e.separator).length;
          modal.selected = (modal.selected + 1) % n;
          render();
          return;
        }
        if (modal?.kind === "onboard") {
          const max = modal.step === 0 ? Math.min(8, listPalettes().length) : 3;
          modal.selected = Math.min(max - 1, modal.selected + 1);
          render();
          return;
        }
        if (paletteOpen) {
          paletteSelected = Math.min(paletteRows.length - 1, paletteSelected + 1);
          if (paletteSelected >= paletteScroll + 12) paletteScroll = paletteSelected - 11;
          livePreview();
          render();
          return;
        }
        scrollOffset = Math.max(0, scrollOffset - 3); render(); return;
      case "pgup": scrollOffset += screenHeight - 6; render(); return;
      case "pgdn": scrollOffset = Math.max(0, scrollOffset - (screenHeight - 6)); render(); return;
      case "home": editor.cursor = 0; render(); return;
      case "end": editor.cursor = editor.text.length; render(); return;
      case "left": editor.cursor = Math.max(0, editor.cursor - 1); render(); return;
      case "right": editor.cursor = Math.min(editor.text.length, editor.cursor + 1); render(); return;
      case "backspace":
        if (editor.cursor > 0) { editor.text = editor.text.slice(0, editor.cursor - 1) + editor.text.slice(editor.cursor); editor.cursor--; }
        if (paletteOpen) refreshPalette();
        render();
        return;
      case "delete":
        editor.text = editor.text.slice(0, editor.cursor) + editor.text.slice(editor.cursor + 1);
        if (paletteOpen) refreshPalette();
        render();
        return;
      case "paste": {
        const t = k.text.replace(/\n+/g, " ");
        editor.text = insertAtCursor(t);
        editor.cursor += t.length;
        if (paletteOpen) refreshPalette();
        render();
        return;
      }
      case "text":
        if (k.text === "?" && !editor.text && !paletteOpen && !modal) { modal = { kind: "shortcuts" }; scheduleRender(); return; }
        if (modal) {
          if (modal.kind === "onboard" && k.text === "/") {
            // The user is asking for the palette — skip the wizard entirely.
            finishOnboarding();
            openPalette("/");
            return;
          }
          if (modal.kind === "onboard" && modal.step === 0) {
            const themes = listPalettes().map((p) => p.name.toLowerCase());
            setTheme(themes[modal.selected] ?? themeId.current, true);
            modal = { kind: "onboard", step: 1, selected: 0 };
            scheduleRender();
            return;
          }
          modal = null;
          if (!onboarded) { onboarded = true; savePrefs({ ...prefs, onboarded: true, theme: themeId.current }); }
          scheduleRender();
          return;
        }
        editor.text = insertAtCursor(k.text);
        editor.cursor += k.text.length;
        if (!paletteOpen && editor.text.startsWith("/") && !editor.text.includes(" ")) { paletteViaSlash = true; paletteOpen = true; }
        if (paletteOpen) refreshPalette();
        render();
        return;
    }
  }

  /** Live theme preview: moving over theme rows re-paints without persisting. */
  const livePreview = () => {
    const row = paletteRows[paletteSelected];
    if (row?.entry.category === "theme" && row.entry.action.type === "theme") {
      previewing = true;
      setTheme(String((row.entry.action as { theme: string }).theme), false);
    } else if (previewing) {
      previewing = false;
      setTheme(themeId.current, false);
    }
  };

  const finishOnboarding = () => {
    onboarded = true;
    savePrefs({ ...prefs, onboarded: true, theme: themeId.current });
    modal = null;
    push("info", "You're set. Press / any time to search everything.");
    scheduleRender();
  };

  const activateRow = (idx: number) => {
    const row = paletteRows[idx];
    if (!row) return;
    const a = row.entry.action;
    closePalette();
    runAction(a as unknown as Record<string, unknown>);
  };

  render();
  process.on("SIGINT", () => { if (busy) abortActiveTurn(); else quit(); });

  // splash: gradient logo over a tiled background, any key skips
  const drawSplash = () => {
    const lines = renderSplashFrame({
      width: screenWidth,
      height: screenHeight,
      accent: palette.accent,
      accent2: palette.success,
      muted: palette.muted,
      version: RA_VERSION,
    });
    process.stdout.write(SYNC_BEGIN + "\x1b[H" + lines.map((l) => fit(screenWidth, l ?? "") + "\x1b[K").join("\n") + SYNC_END);
  };
  if (!process.env.RA_NO_SPLASH) {
    try { drawSplash(); } catch (e) { stdout.write(`\r\nsplash error: ${String(e)}\r\n`); }
    void (async () => {
      const skipped = await Promise.race([
        new Promise<null>((r) => setTimeout(() => r(null), 1600)),
        new Promise<string | null>((r) => {
          const onData = (chunk: string) => { stdin.removeListener("data", onData); r(chunk); };
          stdin.on("data", onData);
        }),
      ]);
      stdin.removeAllListeners("data");
      wireKeys();
      if (skipped === null) drawSplash(); // one final paint before the app takes over
      render();
      if (!onboarded) {
        modal = { kind: "onboard", step: 0, selected: Math.max(0, listPalettes().findIndex((p) => p.name.toLowerCase() === themeId.current)) };
        render();
      }
    })();
  } else {
    wireKeys();
    render();
    if (!onboarded) {
      modal = { kind: "onboard", step: 0, selected: Math.max(0, listPalettes().findIndex((p) => p.name.toLowerCase() === themeId.current)) };
      render();
    }
  }

  function wireKeys(): void {
    stdin.on("data", (chunk: string) => {
      const { keys, pending: rest } = decodeKeys(chunk.toString("utf-8"), pending);
      pending = rest;
      for (const key of keys) handleKey(key);
    });
  }
}
