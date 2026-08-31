// tui/keys.ts — raw terminal input decoding (pure decode, testable).
// Turns raw stdin bytes into structured keys: printable text, control
// combos, navigation, mouse events, and bracketed paste.

import { decodeMouse, type MouseEvent } from "./mouse.ts";

export type Key =
  | { type: "text"; text: string }
  | { type: "enter" }
  | { type: "tab" }
  | { type: "shifttab" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "up" }
  | { type: "down" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "pgup" }
  | { type: "pgdn" }
  | { type: "escape" }
  | { type: "ctrl"; name: string }
  | { type: "paste"; text: string }
  | { type: "mouse"; event: MouseEvent };

export interface DecodeResult {
  keys: Key[];
  /** bytes retained waiting for the rest of an escape sequence */
  pending: string;
}

const CTRL_NAMES: Record<string, string> = {
  "\x01": "a", "\x02": "b", "\x03": "c", "\x04": "d", "\x05": "e", "\x06": "f",
  "\x07": "g", "\x08": "h", "\x0b": "k", "\x0c": "l", "\x0e": "n", "\x0f": "o",
  "\x10": "p", "\x11": "q", "\x12": "r", "\x13": "s", "\x14": "t", "\x15": "u",
  "\x16": "v", "\x17": "w", "\x18": "x", "\x19": "y", "\x1a": "z",
};

/** Decode a chunk of raw input. Keep `pending` and prepend future chunks. */
export function decodeKeys(chunk: string, pending = ""): DecodeResult {
  const keys: Key[] = [];
  let buf = pending + chunk;
  let pasteBuffer: string[] | null = null;

  while (buf.length) {
    // Bracketed paste: \x1b[200~ ... \x1b[201~
    if (buf.startsWith("\x1b[200~")) {
      const end = buf.indexOf("\x1b[201~");
      if (end < 0) return { keys, pending: buf };
      keys.push({ type: "paste", text: buf.slice(6, end) });
      buf = buf.slice(end + 6);
      continue;
    }
    // SGR mouse: \x1b[<b;x;yM|m
    if (buf.startsWith("\x1b[<")) {
      const m = /^(\x1b\[<\d+;\d+;\d+[Mm])/.exec(buf);
      if (!m) return { keys, pending: buf };
      const ev = decodeMouse(m[1].slice(2));
      if (ev) keys.push({ type: "mouse", event: ev });
      buf = buf.slice(m[1].length);
      continue;
    }
    // CSI sequences
    if (buf.startsWith("\x1b[")) {
      const m = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(buf);
      if (!m) return { keys, pending: buf };
      const params = m[1];
      const fin = m[2];
      keys.push(...csiToKeys(params, fin));
      buf = buf.slice(m[0].length);
      continue;
    }
    // ESC alone (possibly a prefix of a longer sequence)
    if (buf.startsWith("\x1b")) {
      if (buf.length === 1) return { keys, pending: buf };
      // alt+key: \x1b followed by a printable
      const next = buf[1];
      if (next >= " " && next <= "~") {
        keys.push({ type: "text", text: next });
        buf = buf.slice(2);
        continue;
      }
      keys.push({ type: "escape" });
      buf = buf.slice(1);
      continue;
    }
    const ch = buf[0];
    if (ch === "\r" || ch === "\n") { keys.push({ type: "enter" }); buf = buf.slice(1); continue; }
    if (ch === "\t") { keys.push({ type: "tab" }); buf = buf.slice(1); continue; }
    if (ch === "\x7f" || ch === "\x08") { keys.push({ type: "backspace" }); buf = buf.slice(1); continue; }
    if (CTRL_NAMES[ch]) { keys.push({ type: "ctrl", name: CTRL_NAMES[ch] }); buf = buf.slice(1); continue; }
    if (ch < " ") { buf = buf.slice(1); continue; } // ignore other control bytes
    // Printable UTF-8 run: consume the whole grapheme-ish run at once.
    let run = "";
    let i = 0;
    while (i < buf.length && buf[i] >= " " && buf[i] !== "\x7f") { run += buf[i]; i++; }
    keys.push({ type: "text", text: run });
    buf = buf.slice(i);
  }
  void pasteBuffer;
  return { keys, pending: "" };
}

function csiToKeys(params: string, fin: string): Key[] {
  switch (fin) {
    case "A": return [{ type: "up" }];
    case "B": return [{ type: "down" }];
    case "C": return [{ type: "right" }];
    case "D": return [{ type: "left" }];
    case "H": return [{ type: "home" }];
    case "F": return [{ type: "end" }];
    case "Z": return [{ type: "shifttab" }];
    case "~": {
      const n = parseInt(params || "0", 10);
      if (n === 1 || n === 7) return [{ type: "home" }];
      if (n === 4 || n === 8) return [{ type: "end" }];
      if (n === 3) return [{ type: "delete" }];
      if (n === 5) return [{ type: "pgup" }];
      if (n === 6) return [{ type: "pgdn" }];
      return [];
    }
    default: return [];
  }
}
