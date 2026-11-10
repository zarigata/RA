// toml.ts — hand-rolled TOML subset parser for Codex config.toml (no new deps).
// Covers the shapes the Codex fixture/spec uses: `[section]` + `[a.b.c]`
// dotted headers, `key = value` with strings ("…" / '…'), numbers, booleans,
// and single-line arrays of scalars. Unknown constructs fail-closed: the
// offending KEY is skipped with a warning, never half-parsed; a malformed
// line never throws — parseToml always returns a usable object.
//
// ponytail: TOML subset — no multi-line arrays, no inline tables, no
// date/time literals. If Codex grows those shapes, swap in a real parser.

export interface TomlParseResult {
  value: Record<string, unknown>;
  warnings: string[];
}

function unquote(t: string): string | null {
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    const body = t.slice(1, -1);
    return t[0] === '"' ? body.replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n").replace(/\\t/g, "\t") : body;
  }
  return null;
}

/** Parse one scalar or single-line array; null = unsupported shape. */
function parseValue(t: string): unknown {
  const s = t.trim();
  const q = unquote(s);
  if (q !== null) return q;
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    const out: unknown[] = [];
    // quote-aware comma split
    let cur = "";
    let inQ: string | null = null;
    for (const ch of inner) {
      if (inQ) { cur += ch; if (ch === inQ) inQ = null; continue; }
      if (ch === '"' || ch === "'") { inQ = ch; cur += ch; continue; }
      if (ch === ",") { const v = parseValue(cur); if (v === null) return null; out.push(v); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) { const v = parseValue(cur); if (v === null) return null; out.push(v); }
    return out;
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return null; // dates, inline tables, multi-line arrays — out of subset
}

export function parseToml(src: string): TomlParseResult {
  const warnings: string[] = [];
  const root: Record<string, unknown> = {};
  let table: Record<string, unknown> = root;
  let section = "";
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, (m, p1) => (/["']/.test(rawLine.slice(0, rawLine.indexOf(m))) ? m : p1)).trim();
    if (!line) continue;
    const header = line.match(/^\[+\s*([^\]]+?)\s*\]+$/);
    if (header) {
      // dotted header [mcp_servers.name] → nested tables (created as needed)
      const parts = header[1]!.split(".").map((p) => unquote(p.trim().replace(/^"|"$/g, "").trim()) ?? p.trim());
      section = parts.join(".");
      let cur: Record<string, unknown> = root;
      for (const p of parts) {
        if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
        cur = cur[p] as Record<string, unknown>;
      }
      table = cur;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+|"([^"]+)")\s*=\s*(.+)$/);
    if (!kv) { warnings.push(`toml: unparseable line skipped: '${line.slice(0, 40)}'`); continue; }
    const key = (kv[2] ?? kv[1])!.trim();
    const value = parseValue(kv[3]!.trim());
    if (value === null) { warnings.push(`toml: unsupported value for '${section ? section + "." : ""}${key}' skipped`); continue; }
    table[key] = value;
  }
  return { value: root, warnings };
}

/** Get a nested table by dotted path (e.g. "mcp_servers.roblox-studio"). */
export function tomlGet(root: Record<string, unknown>, path: string): Record<string, unknown> | undefined {
  let cur: unknown = root;
  for (const p of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "object" && cur !== null && !Array.isArray(cur) ? cur as Record<string, unknown> : undefined;
}
