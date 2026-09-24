// tui/chrome.ts — terminal chrome primitives for RA.
// Pure helpers keep glyph selection and responsive labels testable outside a TTY.

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
}): string {
  const { width, app, version, profile, glyphs } = opts;
  const state = opts.busy ? ` ${glyphs.busy} ${opts.status || "working"}` : "";
  if (width < 68) {
    return ` ${glyphs.brand} ${app} ${version} · ${profile}${state}`;
  }
  if (width < 108) {
    return ` ${glyphs.brand} ${app} ${version} · ${profile} · S:${shortModel(opts.smallModel, 16)} · B:${shortModel(opts.bigModel, 16)}${state}`;
  }
  return ` ${glyphs.brand} ${app} ${version}  ·  ${profile}  ·  small ${shortModel(opts.smallModel)}  ·  big ${shortModel(opts.bigModel)}${state}`;
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
