// commands/plugins.ts — `ra plugins` CLI: detect stores, import entries, show manifest.
import type { StoreEntry } from "../plugins/stores.ts";
import { detectStores } from "../plugins/stores.ts";
import { importEntry, loadManifest, removeImported } from "../plugins/import.ts";

export const PLUGINS_HELP = `RA plugins — convert other stores' declarative content into RA formats
  ra plugins                      Detect local stores (Claude Code, OpenCode, Cursor, Cline, Roo) + counts
  ra plugins --json               Detected entries as JSON
  ra plugins import <name>        Convert one entry into ~/.ra/{skills,agents,commands}
  ra plugins list-imported        Show the import manifest (~/.ra/imports.json)
  ra plugins remove <name>        Delete an imported item (files + manifest record)
Import never executes third-party code; imperative plugins are listed with a note.
MCP servers return a config snippet for your ra config — it is never auto-edited.`;

export function pluginsCommand(args: string[], opts: { json?: boolean; home?: string } = {}): { code: number; data: unknown; text: string } {
  const home = opts.home ?? (process.env.HOME ?? "");
  const [action, name] = args;
  if (!action || action === "help") return { code: 0, data: { help: PLUGINS_HELP }, text: PLUGINS_HELP };

  if (action === "list-imported") {
    const { imports } = loadManifest(home);
    const text = imports.length
      ? ["RA imported plugins (~/.ra/imports.json)", ...imports.map((r) => `  ${r.id} → ${r.targetPath ?? `(no files — ${r.note ?? "snippet only"})`}`)]
      : "No imports yet. Run: ra plugins";
    return { code: 0, data: imports, text };
  }

  const entries = detectStores(home);
  if (action === "import" || action === "remove") {
    if (!name) throw new Error(`Usage: ra plugins ${action} <name>`);
    if (action === "remove") {
      const ok = removeImported(name, home);
      return { code: ok ? 0 : 1, data: { removed: ok }, text: ok ? `Removed ${name}` : `Not imported: ${name}` };
    }
    const matches = entries.filter((e) => e.name === name || e.name === `${name}.md`);
    if (!matches.length) throw new Error(`No detected entry named '${name}'. Try: ra plugins`);
    const results = matches.map((e) => importEntry(e, home));
    const text = results.map((r) => [`RA plugins import ${r.record.name} [${r.status}]`, ...r.report].join("\n")).join("\n\n");
    return { code: 0, data: results.map((r) => ({ ...r.record, status: r.status, snippet: r.snippet })), text };
  }

  throw new Error(PLUGINS_HELP);
}

/** Human listing for `ra plugins` (no action): stores + kinds + counts. */
export function listStoresText(entries: StoreEntry[]): string {
  if (!entries.length) return "No plugin stores detected. RA scans ~/.claude/plugins, ~/.opencode, ~/.cursor, and VS Code globalStorage (Cline/Roo).";
  const bySource = new Map<string, StoreEntry[]>();
  for (const e of entries) {
    const list = bySource.get(e.source) ?? [];
    list.push(e);
    bySource.set(e.source, list);
  }
  const lines = [`RA plugins — ${entries.length} entries in ${bySource.size} stores`];
  for (const [source, list] of bySource) {
    const kinds = new Map<string, number>();
    for (const e of list) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    lines.push(`  ${source}: ${[...kinds].map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`).join(", ")}`);
    for (const e of list) lines.push(`    ${e.name} [${e.kind}]${e.description ? ` — ${e.description.slice(0, 80)}` : ""}`);
  }
  lines.push("", "Import with: ra plugins import <name>");
  return lines.join("\n");
}

// Re-export so callers can render the plain listing.
export { detectStores };
