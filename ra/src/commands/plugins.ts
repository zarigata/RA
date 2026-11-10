// commands/plugins.ts — `ra plugins` CLI: detect stores, import entries, show manifest.
import type { StoreEntry } from "../plugins/stores.ts";
import { detectStores } from "../plugins/stores.ts";
import { importEntry, loadManifest, removeImported, applyMcpToConfig } from "../plugins/import.ts";

export const PLUGINS_HELP = `RA plugins — convert other stores' declarative content into RA formats
  ra plugins                      Detect local stores (Claude Code, OpenCode, Cursor, Cline, Roo, Codex) + counts
  ra plugins --json               Detected entries as JSON
  ra plugins import <name>        Convert one entry into ~/.ra/{skills,agents,commands,rules}
    10|  ra plugins import <name> --with-hooks   Also mark imported command hooks runnable
                                         (still needs ra.json plugin_runtime.hooks:"on")
  ra plugins import <name> --apply-mcp    Write MCP servers into ra.json instead of paste-only
                                         (existing names are skipped, never overwritten)
  ra plugins list-imported        Show the import manifest (~/.ra/imports.json)
  ra plugins remove <name>        Delete an imported item (files + manifest record)
Import never executes third-party code unless hooks are explicitly enabled twice
(--with-hooks at import + plugin_runtime.hooks:"on" in ra.json); imperative
plugins are listed with a note. MCP is paste-only unless --apply-mcp is passed.
Sources: Claude Code, Cursor (plugin caches + skills), OpenCode (global +
project opencode.json), Cline (rules/workflows/MCP), Roo (.roomodes YAML+JSON,
MCP), Codex (config.toml MCP, skills, legacy prompts).`;

export function pluginsCommand(args: string[], opts: { json?: boolean; home?: string } = {}): { code: number; data: unknown; text: string } {
  const home = opts.home ?? (process.env.HOME ?? "");
  const [action, name] = args;
  if (!action || action === "help") return { code: 0, data: { help: PLUGINS_HELP }, text: PLUGINS_HELP };

  if (action === "list-imported") {
    const { imports } = loadManifest(home);
    const text = imports.length
      ? ["RA imported plugins (~/.ra/imports.json)", ...imports.map((r) => `  ${r.id} → ${r.targetPath ?? `(no files — ${r.note ?? "snippet only"})`}${r.hooksEnabled ? " [hooks RUNNABLE]" : ""}`)]
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
    const withHooks = args.includes("--with-hooks");
    const applyMcp = args.includes("--apply-mcp");
    const matches = entries.filter((e) => e.name === name || e.name === `${name}.md`);
    if (!matches.length) throw new Error(`No detected entry named '${name}'. Try: ra plugins`);
    const results = matches.map((e) => importEntry(e, home, { withHooks }));
    const text = results.map((r) => [`RA plugins import ${r.record.name} [${r.status}]`, ...r.report].join("\n")).join("\n\n");
    let mcpText = "";
    if (applyMcp) {
      const mcpEntries = matches.filter((e) => e.kind === "mcp" && e.data).map((e) => ({ name: e.name, data: e.data! }));
      if (mcpEntries.length) {
        const applied = applyMcpToConfig(mcpEntries, home);
        mcpText = `\n\nMCP auto-apply → ${applied.configPath}\n${applied.applied.map((n) => `  + ${n}`).join("\n")}${applied.skipped.map((n) => `  ! skipped ${n}`).join("\n")}`;
      }
    }
    return { code: 0, data: results.map((r) => ({ ...r.record, status: r.status, snippet: r.snippet })), text: text + mcpText };
  }

  throw new Error(PLUGINS_HELP);
}

/** Human listing for `ra plugins` (no action): stores + kinds + counts. */
export function listStoresText(entries: StoreEntry[]): string {
  if (!entries.length) return "No plugin stores detected. RA scans ~/.claude/plugins, ~/.opencode, ~/.cursor, ~/.codex, ~/.agents/skills, and VS Code globalStorage (Cline/Roo), plus project .roomodes/.clinerules/opencode.json.";
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
