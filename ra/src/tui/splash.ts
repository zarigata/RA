// tui/splash.ts — startup splash: big gradient ASCII logo over a tiled dim
// background pattern, plus terminal recoloring helpers (pure, testable).

export const LOGO: string[] = [
  "██████╗  █████╗ ",
  "██╔══██╗██╔══██╗",
  "██████╔╝███████║",
  "██╔══██╗██╔══██║",
  "██║  ██║██║  ██║",
  "╚═╝  ╚═╝╚═╝  ╚═╝",
];

export const TAGLINE = "R E L I C   A G E N T";

/** Interpolate two #rrggbb colors, t in [0,1] (pure). */
export function mixColor(a: string, b: string, t: number): [number, number, number] {
  const pa = hex(a), pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.min(1, Math.max(0, t))));
  return [c[0], c[1], c[2]];
}

function hex(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  const v = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(v)) return [255, 255, 255];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const rgbSeq = (c: [number, number, number]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;

const hexFg = (hexColor: string) => {
  const [r, g, b] = hex(hexColor);
  return `\x1b[38;2;${r};${g};${b}m`;
};

// Width-1 ASCII/box tiles only: every cell is exactly one terminal column.
const TILE = ["·", "/", ":", "\\", "-", "░", "|", "+"];

/**
 * Build the splash frame lines.
 * Layer 1: dim tiled pattern filling width×height.
 * Layer 2: gradient logo + tagline centered on top (composited by column).
 */
export function renderSplashFrame(opts: {
  width: number;
  height: number;
  accent: string;
  accent2: string;
  muted: string;
  version: string;
}): string[] {
  const { width: W, height: H, accent, accent2, muted } = opts;
  const dimFg = (hexColor: string, level: number) => {
    const [r, g, b] = hex(hexColor);
    const f = level / 20;
    return `\x1b[38;2;${Math.round(r * f)};${Math.round(g * f)};${Math.round(b * f)}m`;
  };
  const lines: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      row += TILE[(y * 7 + x * 5) % TILE.length];
    }
    lines.push(`\x1b[2m${dimFg(muted, 9 + ((y * 3) % 6))}${row}\x1b[0m`);
  }
  const composite = (rowIndex: number, text: string, style: (s: string) => string) => {
    if (rowIndex < 0 || rowIndex >= H) return;
    const tileRow = lines[rowIndex];
    const plain = tileRow.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    const left = Math.max(0, Math.floor((W - text.length) / 2));
    const head = plain.slice(0, left);
    const tail = plain.slice(left + text.length);
    lines[rowIndex] = head + style(text) + tail;
  };
  const logoH = LOGO.length + 3;
  const top = Math.max(0, Math.floor((H - logoH) / 2) - 1);
  for (let i = 0; i < LOGO.length; i++) {
    const t = i / Math.max(1, LOGO.length - 1);
    const color = rgbSeq(mixColor(accent, accent2, t));
    const text = LOGO[i];
    const rowIndex = top + i;
    const tileRow = lines[rowIndex];
    const plain = tileRow.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    const left = Math.max(0, Math.floor((W - text.length) / 2));
    const head = plain.slice(0, left);
    const tail = plain.slice(left + text.length);
    lines[rowIndex] = head + color + text + "\x1b[0m" + tail;
  }
  const tagText = TAGLINE;
  composite(top + LOGO.length + 1, tagText, (s) => `\x1b[1m${hexFg(muted)}${s}\x1b[0m`);
  const verText = `v${opts.version}  ·  press any key to begin`;
  composite(top + LOGO.length + 2, verText, (s) => `\x1b[2m${hexFg(muted)}${s}\x1b[0m`);
  return lines;
}

/** Parse an OSC 11 color-report reply like "\x1b]11;rgb:1c1c/1c1c/1c1c\x07" (pure). */
export function parseOscColorReply(chunk: string): string | null {
  const m = /\x1b\]1[01];rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})(\x07|\x1b\\)/.exec(chunk);
  if (!m) return null;
  const norm = (v: string) => {
    const n = parseInt(v, 16);
    const max = Math.pow(16, v.length) - 1;
    return Math.round((n / max) * 255);
  };
  return `#${[norm(m[1]), norm(m[2]), norm(m[3])].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance of #rrggbb (pure). */
export function luminance(hexColor: string): number {
  const [r, g, b] = hex(hexColor);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export const OSC_TITLE = (text: string) => `\x1b]0;${text}\x07`;
export const OSC_QUERY_BG = "\x1b]11;?\x07";
