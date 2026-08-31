// tui/mouse.ts — SGR mouse decoding and terminal mode control (pure decode, testable).
// Enables: alternate screen, bracketed paste, SGR mouse (click/drag/wheel).

export interface MouseEvent {
  kind: "press" | "release" | "motion" | "wheel-up" | "wheel-down";
  button: "left" | "middle" | "right" | "none";
  /** 1-based, matching SGR coordinates */
  x: number;
  y: number;
}

/**
 * Decode an SGR mouse sequence body like "<0;12;40M" (press) or "<0;12;40m"
 * (release). Returns null when the body is not a mouse sequence.
 */
export function decodeMouse(body: string): MouseEvent | null {
  const m = /^<(\d+);(\d+);(\d+)([Mm])$/.exec(body);
  if (!m) return null;
  const code = parseInt(m[1], 10);
  const x = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  const release = m[4] === "m";
  const kind = code >= 64 ? (code === 64 ? "wheel-up" : "wheel-down")
    : code & 32 ? "motion"
    : release ? "release" : "press";
  const button = code & 3;
  if (kind === "wheel-up" || kind === "wheel-down") {
    return { kind, button: "none", x, y };
  }
  return { kind, button: button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : "none", x, y };
}

export const MOUSE_ENTER = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
export const MOUSE_EXIT = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
export const ALT_ENTER = "\x1b[?1049h";
export const ALT_EXIT = "\x1b[?1049l";
export const PASTE_ENTER = "\x1b[?2004h";
export const PASTE_EXIT = "\x1b[?2004l";
export const SYNC_BEGIN = "\x1b[?2026h";
export const SYNC_END = "\x1b[?2026l";
export const CURSOR_SHOW = "\x1b[?25h";
export const CURSOR_HIDE = "\x1b[?25l";

/** Convert #rrggbb to an SGR truecolor foreground sequence (pure). */
export function fg(hex: string): string {
  const n = hexToRgb(hex);
  return `\x1b[38;2;${n[0]};${n[1]};${n[2]}m`;
}

export function bg(hex: string): string {
  const n = hexToRgb(hex);
  return `\x1b[48;2;${n[0]};${n[1]};${n[2]}m`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const v = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(v)) return [255, 255, 255];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
