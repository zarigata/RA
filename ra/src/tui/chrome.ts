// tui/chrome.ts — terminal chrome primitives for RA.
// Pure helpers keep glyph selection and responsive labels testable outside a TTY.

import { truncateVisible } from "./markdown.ts";
import type { StatusKind } from "../../../anubis/src/ui.ts";

export interface TuiGlyphs {
  brand: string;
  user: string;
  assistant: string;
  warning: string;
  info: string;
  streaming: string;
  busy: string;
  idle: string;
  branch: string;
  prompt: string;
}

export const UNICODE_GLYPHS: TuiGlyphs = {
  brand: "𓂀",
  user: "›",
  assistant: "◆",
  warning: "▲",
  info: "·",
  streaming: "▌",
  busy: "◉",
  idle: "○",
  branch: "⑂",
  prompt: "╼",
};

export const ASCII_GLYPHS: TuiGlyphs = {
  brand: "RA",
  user: ">",
  assistant: "*",
  warning: "!",
  info: "-",
  streaming: "|",
  busy: "*",
  idle: "o",
  branch: "git",
  prompt: ">",
};

/**
 * Force ASCII chrome with RA_ASCII=1. TERM=dumb also opts into the portable
 * set so logs/basic consoles do not receive ambiguous-width Unicode glyphs.
 */
export function useAsciiGlyphs(env: Record<string, string | undefined> = process.env): boolean {
  return env.RA_ASCII === "1" || env.RA_ASCII === "true" || env.TERM === "dumb";
}

export function getTuiGlyphs(ascii = false): TuiGlyphs {
  return ascii ? ASCII_GLYPHS : UNICODE_GLYPHS;
}

export function shortModel(model?: string, max = 24): string {
  if (!model) return "?";
  const bare = model.includes("/") ? model.split("/").pop()! : model;
  return bare.length > max ? bare.slice(0, Math.max(1, max - 1)) + "…" : bare;
}

/** Context pressure 0–100 from the live context ledger; undefined when idle/unknown. */
export function contextPctFromLive(live: { windowTokens: number; usedTokens: number } | null | undefined): number | undefined {
  return live && live.windowTokens > 0 ? Math.min(100, Math.round((live.usedTokens / live.windowTokens) * 100)) : undefined;
}

export function buildHeader(opts: {
  width: number;
  app: string;
  version: string;
  profile: string;
  smallModel?: string;
  bigModel?: string;
  busy?: boolean;
  status?: string;
  glyphs: TuiGlyphs;
  /** Lane summary, e.g. "small@lan · big@cloud". */
  lane?: string;
  /** Session cost in USD; omitted when unavailable. */
  costUsd?: number;
  /** Context pressure 0–100 from the agent token ledger (runs only). */
  contextPct?: number;
  /** True when no usable model lane exists yet (warns "run ra setup"). */
  setupNeeded?: boolean;
}): string {
  const { width, app, version, profile, glyphs } = opts;
  const state = opts.busy ? ` ${glyphs.busy} ${opts.status || "working"}` : "";
  if (width < 68) {
    // Brand + version + profile only, plus a single status glyph.
    const flag = opts.setupNeeded && !opts.busy ? ` ${glyphs.warning}` : "";
    return ` ${glyphs.brand} ${app} ${version} · ${profile}${flag}${state}`;
  }
  const lane = opts.setupNeeded
    ? `${glyphs.warning} no model — run ra setup`
    : opts.lane;
  if (width < 108) {
    const head = ` ${glyphs.brand} ${app} ${version} · ${profile} · S:${shortModel(opts.smallModel, 16)} · B:${shortModel(opts.bigModel, 16)}`;
    const laneSeg = lane ? ` · ${truncateVisible(lane, 24)}` : "";
    return truncateVisible(`${head}${laneSeg}${state}`, width);
  }
  const parts = [`small ${shortModel(opts.smallModel)}`, `big ${shortModel(opts.bigModel)}`];
  if (lane) parts.push(truncateVisible(lane, 40));
  if (opts.costUsd != null && Number.isFinite(opts.costUsd)) parts.push(`$${opts.costUsd.toFixed(2)}`);
  if (opts.contextPct != null && Number.isFinite(opts.contextPct)) parts.push(`ctx ${Math.round(opts.contextPct)}%`);
  return truncateVisible(` ${glyphs.brand} ${app} ${version}  ·  ${profile}  ·  ${parts.join("  ·  ")}${state}`, width);
}

/** Thin muted line under the header: cwd · ⑂ branch · theme · lane (pure). */
export function buildStatusLine(opts: {
  width: number;
  cwd: string;
  branch?: string;
  theme: string;
  lane?: string;
  /** assistant|coding lane (ra/src/lane.ts) — which pipeline handles the turn. */
  mode?: string;
  costUsd?: number;
  glyphs: TuiGlyphs;
}): string {
  const git = opts.branch ? ` · ${opts.glyphs.branch} ${opts.branch}` : "";
  const lane = opts.lane ? ` · ${opts.lane}` : "";
  const mode = opts.mode ? ` · lane:${opts.mode}` : "";
  const cost = opts.costUsd != null && Number.isFinite(opts.costUsd) ? ` · $${opts.costUsd.toFixed(4)}` : "";
  const sep = opts.glyphs === ASCII_GLYPHS ? "-" : "·";
  return " " + truncateVisible(`${opts.cwd}${git} ${sep} ${opts.theme}${lane}${mode}${cost}`.replace(/ · /g, ` ${sep} `), Math.max(0, opts.width - 2));
}

const ASCII_SPINNER = ["|", "/", "-", "\\"];

/** One spinner frame; ASCII mode cycles the portable set (pure). */
export function spinnerFrame(frame: number, ascii = false): string {
  const set = ascii ? ASCII_SPINNER : ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const i = ((frame % set.length) + set.length) % set.length;
  return set[i];
}

/** Standardised message prefixes: same meaning = same glyph + StatusKind colour. */
export function statusPrefix(kind: StatusKind, ascii = false): { glyph: string; kind: StatusKind } {
  const g = ascii
    ? { ok: "+", warn: ASCII_GLYPHS.warning, error: "x", info: ASCII_GLYPHS.info, busy: ASCII_GLYPHS.busy }[kind]
    : { ok: "✓", warn: "▲", error: "✗", info: "·", busy: "◉" }[kind];
  return { glyph: g, kind };
}

/** Prefix a message with its status glyph, applying the palette colour via `color` (pure). */
export function prefixLine(text: string, color: (s: string) => string, kind: StatusKind, ascii = false): string {
  const { glyph } = statusPrefix(kind, ascii);
  return `${color(glyph)} ${text}`;
}

export function buildInputLabel(opts: {
  app: string;
  busy?: boolean;
  status?: string;
  spinner?: string;
  glyphs: TuiGlyphs;
}): string {
  if (opts.busy) {
    const spin = opts.spinner ? ` ${opts.spinner}` : "";
    return ` ${opts.glyphs.busy}${spin} ${opts.status || "working…"} `;
  }
  return ` ${opts.glyphs.brand} ${opts.app} ${opts.glyphs.prompt} / search · ? shortcuts `;
}

export function footerHints(busy: boolean): Array<[string, string]> {
  return [
    ["/", "search"],
    ["ctrl+p", "palette"],
    ["ctrl+e", "explorer"],
    ["?", "keys"],
    ["esc", busy ? "cancel" : "close"],
    ["ctrl+d", "quit"],
  ];
}

export function workspaceLabel(opts: {
  cwd: string;
  branch?: string;
  theme: string;
  glyphs: TuiGlyphs;
}): string {
  const git = opts.branch ? ` · ${opts.glyphs.branch} ${opts.branch}` : "";
  return `${opts.cwd}${git} · ${opts.theme}`;
}
