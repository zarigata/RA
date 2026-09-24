// tui/markdown.ts — terminal markdown rendering (pure, testable).
// Converts a subset of markdown into styled plain text lines.

export interface MdStyle {
  accent: (s: string) => string;
  muted: (s: string) => string;
  strong: (s: string) => string;
  error: (s: string) => string;
}

export const defaultMdStyle: MdStyle = {
  accent: (s) => `\x1b[36m${s}\x1b[0m`,
  muted: (s) => `\x1b[2m${s}\x1b[0m`,
  strong: (s) => `\x1b[1m${s}\x1b[0m`,
  error: (s) => `\x1b[31m${s}\x1b[0m`,
};

function inline(s: string, st: MdStyle): string {
  let out = s;
  out = out.replace(/`([^`]+)`/g, (_, c) => st.accent(c));
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => st.strong(c));
  out = out.replace(/(^|\s)\*([^*\n]+)\*/g, (_, pre, c) => pre + st.muted(c));
  return out;
}

/**
 * Render markdown to lines. Fenced code blocks become bordered dim boxes;
 * headings get an accent underline; lists use · bullets; blockquotes dim.
 */
export function renderMarkdown(md: string, st: MdStyle = defaultMdStyle, width = 100): string[] {
  const lines: string[] = [];
  const src = md.replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  let codeLang = "";
  let code: string[] = [];
  const flushCode = () => {
    if (!code.length && !inCode) return;
    const inner = code.slice(0, 40);
    lines.push(st.muted(`╭─${codeLang ? ` ${codeLang} ` : ""}${"─".repeat(Math.max(4, width - codeLang.length - 4))}`));
    for (const l of inner) {
      for (const chunk of wrap(l, width - 4)) lines.push(st.muted(`│ ${chunk}`));
    }
    if (code.length > inner.length) lines.push(st.muted(`│ … +${code.length - inner.length} lines`));
    lines.push(st.muted(`╰${"─".repeat(width - 2)}`));
    code = [];
    codeLang = "";
  };
  for (let idx = 0; idx < src.length; idx++) {
    const raw = src[idx];
    if (/^```/.test(raw.trim())) {
      if (inCode) { inCode = false; flushCode(); }
      else { inCode = true; codeLang = raw.trim().slice(3).trim(); }
      continue;
    }
    if (inCode) { code.push(raw); continue; }
    const line = raw.trimEnd();
    // GFM table: a | row whose next line is a |---|---| separator.
    if (line.includes("|") && idx + 1 < src.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(src[idx + 1]) && src[idx + 1].includes("-") && src[idx + 1].includes("|")) {
      const rows: string[] = [];
      let j = idx;
      while (j < src.length && src[j].includes("|") && src[j].trim()) { rows.push(src[j]); j++; }
      const table = renderTable(rows, st, width);
      if (table) {
        lines.push(...table);
        idx = j - 1;
        continue;
      }
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = inline(h[2], st);
      lines.push(level <= 2 ? st.strong(text) : st.accent(text));
      if (level <= 2) lines.push(st.muted("─".repeat(Math.min(width, text.length + 2))));
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) { lines.push(`  ${st.accent("·")} ${inline(line.replace(/^\s*[-*]\s+/, ""), st)}`); continue; }
    const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (num) { lines.push(`  ${st.accent(num[1] + ".")} ${inline(num[2], st)}`); continue; }
    if (/^\s*>\s?/.test(line)) { lines.push(st.muted(`│ ${inline(line.replace(/^\s*>\s?/, ""), st)}`)); continue; }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { lines.push(st.muted("─".repeat(Math.min(width, 40)))); continue; }
    if (!line.trim()) { lines.push(""); continue; }
    for (const chunk of wrap(inline(line, st), width)) lines.push(chunk);
  }
  if (inCode) flushCode();
  return lines;
}

/**
 * Render a markdown table row block: header, separator, and data rows with
 * aligned columns and a dim border (pure). Returns null when the lines are
 * not a GFM table.
 */
export function renderTable(rows: string[], st: MdStyle = defaultMdStyle, width: number): string[] | null {
  if (rows.length < 2) return null;
  const cells = rows.map((r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
  if (!cells.every((c) => c.length === cells[0].length && c.length > 0)) return null;
  if (!cells[1].every((c) => /^:?-{2,}:?$/.test(c))) return null;
  const body = [cells[0], ...cells.slice(2)];
  const cols = cells[0].length;
  const sizes = Array.from({ length: cols }, (_, i) => Math.min(28, Math.max(...body.map((r) => visibleWidth(r[i])))));
  const total = sizes.reduce((a, b) => a + b, 0) + (cols + 1) * 3 - 2;
  const scale = total > width ? width / total : 1;
  const w = sizes.map((s) => Math.max(3, Math.floor(s * scale)));
  const fmt = (r: string[], cell: (s: string) => string) => {
    const pad = (s: string, size: number) => {
      const v = visibleWidth(s);
      return v >= size ? truncateVisible(s, size) : s + " ".repeat(size - v);
    };
    return `│ ${r.map((c, i) => pad(cell(c), w[i])).join(" │ ")} │`;
  };
  const top = `┌${w.map((size) => "─".repeat(size + 2)).join("┬")}┐`;
  const mid = `├${w.map((size) => "─".repeat(size + 2)).join("┼")}┤`;
  const bot = `└${w.map((size) => "─".repeat(size + 2)).join("┴")}┘`;
  return [
    top,
    fmt(body[0], (s) => st.strong(s)),
    mid,
    ...body.slice(1).map((r) => fmt(r, (s) => s)),
    bot,
  ];
}

/** Word wrap aware of existing ANSI sequences (never splits inside one). */
export function wrap(s: string, width: number): string[] {
  if (width < 10) width = 10;
  const out: string[] = [];
  let line = "";
  let visible = 0;
  let i = 0;
  const tokens = s.split(/(\s+)/);
  for (const tok of tokens) {
    const vis = visibleWidth(tok);
    if (visible + vis > width && line.trim()) {
      out.push(line.trimEnd());
      line = ""; visible = 0;
      if (/^\s+$/.test(tok)) continue;
    }
    line += tok;
    visible += vis;
    i++;
  }
  if (line.trim()) out.push(line.trimEnd());
  return out.length ? out : [""];
}

/** Visible width, ignoring ANSI escape sequences (pure).
 * Counts Unicode code points instead of UTF-16 code units so Egyptian
 * hieroglyphs and other non-BMP symbols do not add phantom columns.
 */
export function visibleWidth(s: string): number {
  return Array.from(s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")).length;
}

/** Truncate to visible width without splitting a Unicode code point. */
export function truncateVisible(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < s.length) {
    const m = /^\x1b\[[0-9;?]*[a-zA-Z]/.exec(s.slice(i));
    if (m) { out += m[0]; i += m[0].length; continue; }
    if (visible >= width - 1) { out += "…"; break; }
    const cp = String.fromCodePoint(s.codePointAt(i)!);
    out += cp;
    visible++;
    i += cp.length;
  }
  return out;
}
