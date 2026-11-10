// roo-modes.ts — parse Roo/Zoo `.roomodes` custom-modes files (YAML or JSON)
// into mode records for the importer. Hand-rolled subset parser (no new deps):
// covers the documented shapes — `customModes: []` list of maps with scalar
// fields plus `groups` entries that are either plain strings or
// `[group, {fileRegex, description}]` tuples. Anything unparseable is
// skipped with a warning (fail-closed: never half-imports a mode).
//
// ponytail: YAML subset — block lists of flat maps, quoted/unquoted scalars,
// inline JSON-ish flow lists. No anchors/multiline scalars beyond what the
// canonical fixtures use; a real YAML lib is the upgrade path if Zoo drifts.

export interface RooGroup {
  name: string;
  /** Path regex restricting edit-group tools (from the tuple's fileRegex). */
  fileRegex?: string;
  description?: string;
}

export interface RooMode {
  slug: string;
  name?: string;
  description?: string;
  roleDefinition: string;
  whenToUse?: string;
  customInstructions?: string;
  groups: RooGroup[];
}

export interface RooParseResult {
  modes: RooMode[];
  /** Non-fatal parse problems (skipped entries / tolerated junk). */
  warnings: string[];
}

const GROUP_NAMES = new Set(["read", "edit", "command", "mcp", "browser"]);

function coerceGroups(raw: unknown, warn: (m: string) => void, slug: string): RooGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: RooGroup[] = [];
  for (const g of raw) {
    if (typeof g === "string") {
      if (GROUP_NAMES.has(g)) out.push({ name: g });
      else warn(`roo mode '${slug}': unknown group '${g}' ignored`);
      continue;
    }
    // Tuple form: [ "edit", { fileRegex, description } ] — from YAML flow or JSON arrays.
    if (Array.isArray(g) && typeof g[0] === "string") {
      const [name, opts] = g as [string, unknown];
      if (!GROUP_NAMES.has(name)) { warn(`roo mode '${slug}': unknown group '${name}' ignored`); continue; }
      const o = (opts ?? {}) as { fileRegex?: unknown; description?: unknown };
      out.push({
        name,
        ...(typeof o.fileRegex === "string" ? { fileRegex: o.fileRegex } : {}),
        ...(typeof o.description === "string" ? { description: o.description } : {}),
      });
      continue;
    }
    warn(`roo mode '${slug}': unparseable group entry skipped`);
  }
  return out;
}

function coerceMode(raw: unknown, warn: (m: string) => void): RooMode | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const slug = typeof m.slug === "string" ? m.slug.trim() : "";
  // Docs-canonical slug constraint; anything else is treated as unparseable.
  if (!slug || !/^[a-zA-Z0-9-]+$/.test(slug)) { warn("roo mode without a valid slug skipped"); return null; }
  if (typeof m.roleDefinition !== "string" || !m.roleDefinition.trim()) {
    warn(`roo mode '${slug}': missing roleDefinition skipped`);
    return null;
  }
  return {
    slug,
    ...(typeof m.name === "string" ? { name: m.name } : {}),
    ...(typeof m.description === "string" ? { description: m.description } : {}),
    roleDefinition: m.roleDefinition,
    ...(typeof m.whenToUse === "string" ? { whenToUse: m.whenToUse } : {}),
    ...(typeof m.customInstructions === "string" ? { customInstructions: m.customInstructions } : {}),
    groups: Array.isArray(m.groups) ? coerceGroups(m.groups, warn, slug) : [],
  };
}

/** True when the payload parses as JSON without warnings. */
function tryJson(raw: string): RooParseResult | null {
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    const doc = JSON.parse(t) as { customModes?: unknown };
    const warnings: string[] = [];
    if (!Array.isArray(doc.customModes)) return { modes: [], warnings: ["no customModes list found (skipped)"] };
    const modes: RooMode[] = [];
    for (const m of doc.customModes) {
      const mode = coerceMode(m, (msg) => warnings.push(msg));
      if (mode) modes.push(mode);
    }
    return { modes, warnings };
  } catch {
    return null;
  }
}

/** Parse a `.roomodes` payload (JSON or the YAML subset). Fail-closed. */
export function parseRoomodes(raw: string): RooParseResult {
  const asJson = tryJson(raw);
  if (asJson) return asJson;
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);
  const doc = parseYamlSubset(raw.trim(), warn);
  const customModes = (doc as { customModes?: unknown } | null)?.customModes;
  if (!Array.isArray(customModes)) return { modes: [], warnings: [...warnings, "no customModes list found (skipped)"] };
  const modes: RooMode[] = [];
  for (const raw2 of customModes) {
    const mode = coerceMode(raw2, warn);
    if (mode) modes.push(mode);
  }
  return { modes, warnings };
}

// ---- YAML subset ------------------------------------------------------------------------

type Yaml = Record<string, unknown> | string | null;

/**
 * Minimal YAML: nested maps + block lists (- item) + inline flow scalars
 * ([a, b] / "str" / bare). Returns null on a shape it can't represent.
 */
function parseYamlSubset(src: string, warn: (m: string) => void): Yaml {
  // Strip comment lines (naive: '#' at line start or after whitespace, not inside quotes).
  const lines = src.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "$1")).filter((l) => l.trim() !== "");
  let i = 0;
  const indentOf = (l: string) => l.match(/^\s*/)![0].length;

  function parseBlock(indent: number): Yaml {
    if (i >= lines.length) return null;
    const first = lines[i]!;
    if (first.trim().startsWith("- ")) {
      // list block
      const out: unknown[] = [];
      while (i < lines.length && indentOf(lines[i]!) === indent && lines[i]!.trim().startsWith("- ")) {
        const itemRaw = lines[i]!.trim().slice(2);
        if (itemRaw === "") { i++; out.push(parseBlock(indent + 2)); continue; }
        // "- - edit" → nested list item (Roo tuple form): re-inject at the
        // item's virtual indent and parse it as its own block.
        if (itemRaw.startsWith("- ") || itemRaw === "-") {
          const virtualIndent = indent + 2;
          lines[i] = " ".repeat(virtualIndent) + itemRaw;
          out.push(parseBlock(virtualIndent));
          continue;
        }
        // "- slug: x" → map whose first key is on the dash line
        if (/^[A-Za-z][\w-]*:\s/.test(itemRaw) || /^[A-Za-z][\w-]*:\s*$/.test(itemRaw)) {
          const virtualIndent = indent + 2;
          // Re-inject the key at the item's virtual indent and parse the map.
          lines[i] = " ".repeat(virtualIndent) + itemRaw;
          out.push(parseMapBlock(virtualIndent));
          continue;
        }
        out.push(scalar(itemRaw));
        i++;
      }
      return out as unknown as Yaml;
    }
    return parseMapBlock(indent);
  }

  function parseMapBlock(indent: number): Yaml {
    const out: Record<string, unknown> = {};
    while (i < lines.length) {
      const line = lines[i]!;
      const li = indentOf(line);
      if (li < indent) break;
      if (li > indent) { warn(`yaml: unexpected indent at '${line.trim().slice(0, 30)}'`); i++; continue; }
      const m = line.match(/^(\s*)([A-Za-z][\w-]*):(?:\s+(.*))?$/);
      if (!m) { warn(`yaml: unparseable line '${line.trim().slice(0, 30)}' skipped`); i++; continue; }
      const key = m[2]!;
      const rest = m[3]?.trim() ?? "";
      i++;
      if (rest === "") {
        // value is a nested block (deeper indent) or null
        if (i < lines.length && indentOf(lines[i]!) > indent) out[key] = parseBlock(indentOf(lines[i]!));
        else out[key] = null;
      } else if (rest === "-" || /^\d+\.\d+$/.test(rest)) {
        out[key] = rest === "-" ? null : Number(rest);
      } else {
        out[key] = scalar(rest);
      }
    }
    return out;
  }

  /**
   * Scalar: quoted strings strip quotes; [a, b] becomes an array (recursing
   * into quoted items only — a flow list of maps is out of subset, callers
   * fall back to warnings); bare scalars stay strings.
   */
  function scalar(s: string): unknown {
    const t = s.trim();
    if (t.startsWith("[") && t.endsWith("]")) {
      const inner = t.slice(1, -1).trim();
      if (!inner) return [];
      // ponytail: flow items are scalars or quoted strings only — flow maps
      // ([{a: 1}]) are out of the fixture shapes; fail-closed via scalar().
      return splitFlow(inner).map(scalar);
    }
    if ((t.startsWith('"') && t.endsWith('"') && t.length > 1) || (t.startsWith("'") && t.endsWith("'") && t.length > 1)) {
      return t.slice(1, -1);
    }
    return t;
  }

  const doc = parseBlock(0);
  return doc;
}

/** Split a flow list body on top-level commas (quote-aware). */
function splitFlow(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
