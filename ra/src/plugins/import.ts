// import.ts — convert detected store entries into RA's native formats.
// NEVER executes third-party code: declarative files are copied/remapped,
// imperative plugins are listed with an honest note and skipped.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { PluginHost } from "./host.ts";
import { extractHookCommands } from "./hook-shim.ts";
import type { StoreEntry } from "./stores.ts";

export interface ImportRecord {
  id: string;
  source: StoreEntry["source"];
  kind: StoreEntry["kind"];
  name: string;
  originPath: string;
  targetPath: string | null;
  importedAt: string;
  /** Claude hook event → RA hook name; `null` = no sensible mapping (reported, never dropped). */
  hooks?: Record<string, string | null>;
  /** User opted into executing this entry's command hooks (default-deny otherwise). */
  hooksEnabled?: boolean;
  /** Runnable hook definitions (event/matcher/command/timeout) for the runtime shim. */
  hookDefs?: Array<{ event: string; matcher?: string; command: string; timeout?: number }>;
  note?: string;
}

interface Manifest {
  imports: ImportRecord[];
}

// Claude Code hook event → RA PluginHost hook. Name-level mapping only;
// the underlying shell commands are NEVER executed by RA.
const HOOK_MAP: Record<string, string | null> = {
  UserPromptSubmit: "tui.prompt.append",
  PreToolUse: "tool.execute.before",
  Stop: "agent.turn.end",
  SubagentStop: "agent.turn.end",
  SessionStart: null,
  SessionEnd: null,
  PostToolUse: null,
  Notification: null,
  PreCompact: null,
};

/** Map Claude hook names onto KNOWN_HOOKS; unmapped ones are kept as null. */
export function mapHooks(hooks: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const event of Object.keys(hooks)) {
    const mapped = HOOK_MAP[event];
    out[event] = mapped !== undefined && (PluginHost.KNOWN_HOOKS as readonly string[]).includes(mapped) ? mapped : null;
  }
  return out;
}

export function manifestPath(home = homedir()): string {
  return join(home, ".ra", "imports.json");
}

export function loadManifest(home = homedir()): Manifest {
  try { return JSON.parse(readFileSync(manifestPath(home), "utf-8")) as Manifest; } catch { return { imports: [] }; }
}

function saveManifest(m: Manifest, home: string): void {
  mkdirSync(join(home, ".ra"), { recursive: true });
  writeFileSync(manifestPath(home), JSON.stringify(m, null, 2));
}

export interface ImportResult {
  record: ImportRecord;
  status: "imported" | "skipped" | "already";
  /** MCP config snippet for the user to paste into their ra config (never auto-applied). */
  snippet?: string;
  report: string[];
}

export interface ImportOpts {
  /** `--with-hooks`: mark imported command hooks as runnable (still gated by ra.json plugin_runtime.hooks). */
  withHooks?: boolean;
}

/** Cline/OpenCode MCP server JSON → RA mcp config snippet (stdio or url shape). */
export function mcpSnippet(name: string, data: Record<string, unknown>): string | null {
  if (typeof data.url === "string") {
    return `"mcp": { "${name}": { "url": "${data.url}" } }`;
  }
  const command = Array.isArray(data.command) ? data.command.map(String) : typeof data.command === "string" ? [data.command] : null;
  if (!command?.length) return null;
  const args = command.slice(1).map((a) => JSON.stringify(a)).join(", ");
  const env = data.env && typeof data.env === "object" && Object.keys(data.env as object).length
    ? `, "env": ${JSON.stringify(data.env)}` : "";
  return `"mcp": { "${name}": { "command": ${JSON.stringify(command[0])}${args ? `, "args": [${args}]` : ""}${env} } }`;
}

/** MCP server JSON → RA MCP config entry (stdio command/args/env or url). Never synthesizes secrets. */
export function mcpConfigEntry(data: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof data.url === "string") return { url: data.url };
  const argv = Array.isArray(data.command) ? data.command.map(String) : typeof data.command === "string" ? [data.command] : null;
  if (!argv?.length) return null;
  const out: Record<string, unknown> = { command: argv[0] };
  const args = argv.length > 1 ? argv.slice(1) : Array.isArray(data.args) ? data.args.map(String) : undefined;
  if (args?.length) out.args = args;
  if (data.env && typeof data.env === "object") out.env = data.env;
  return out;
}

/** OpenCode agent JSON → RA agent markdown (mode names already match). */function agentMdFromJson(name: string, def: Record<string, unknown>): string {
  const fm = [
    `description: ${String(def.description ?? `Imported from OpenCode: ${name}`)}`,
    `mode: ${def.mode === "primary" || def.mode === "all" ? def.mode : "subagent"}`,
    typeof def.steps === "number" ? `steps: ${def.steps}` : null,
    typeof def.temperature === "number" ? `temperature: ${def.temperature}` : null,
  ].filter(Boolean);
  return `---\n${fm.join("\n")}\n---\n\n${String(def.system ?? "").trim() || "(no system prompt in source)"}\n`;
}

export function importEntry(entry: StoreEntry, home = homedir(), opts: ImportOpts = {}): ImportResult {
  const id = `${entry.source}:${entry.kind}:${entry.name}`;
  const manifest = loadManifest(home);
  const existing = manifest.imports.find((r) => r.id === id);
  if (existing) {
    return { record: existing, status: "already", report: [`already imported (${existing.targetPath ?? "note only"}) — idempotent skip`] };
  }
  const report: string[] = [];
  let targetPath: string | null = null;
  let snippet: string | undefined;
  let note: string | undefined;
  let hooks: Record<string, string | null> | undefined;
  let hookDefs: ImportRecord["hookDefs"] | undefined;
  let hooksEnabled: boolean | undefined;

  if (entry.kind === "skill") {
    // Copy the whole skill dir (SKILL.md + assets); frontmatter is already compatible.
    targetPath = join(home, ".ra", "skills", entry.name);
    cpSync(entry.path, targetPath, { recursive: true });
  } else if (entry.kind === "agent") {
    targetPath = join(home, ".ra", "agents", `${entry.name}.md`);
    mkdirSync(join(home, ".ra", "agents"), { recursive: true });
    if (entry.data) {
      // OpenCode JSON agent → markdown frontmatter.
      writeFileSync(targetPath, agentMdFromJson(entry.name, entry.data));
    } else {
      // Markdown agent: copy verbatim — name/description frontmatter already match.
      // model:/tools: keys differ from RA's permission block; RA ignores unknown
      // keys, so they are preserved as-is rather than mistranslated.
      writeFileSync(targetPath, readFileSync(entry.path, "utf-8"));
      note = "model/tools frontmatter keys preserved verbatim (RA uses config-driven role models)";
    }
  } else if (entry.kind === "command") {
    targetPath = join(home, ".ra", "commands", `${entry.name}.md`);
    mkdirSync(join(home, ".ra", "commands"), { recursive: true });
    // Claude Code + OpenCode both use $ARGUMENTS/$1..$N — same syntax as RA. Copy verbatim.
    writeFileSync(targetPath, readFileSync(entry.path, "utf-8"));
  } else if (entry.kind === "mcp") {
    snippet = entry.data ? mcpSnippet(entry.name, entry.data) ?? undefined : undefined;
    note = snippet ? "config snippet returned — add it to your ra config manually (never auto-edited)" : "unrecognized MCP server shape (no command/url)";
    report.push(`MCP snippet: ${snippet ?? note}`);
  } else {
    // Imperative plugin code: listed but never imported or executed.
    note = "imperative plugin code — listed only, NOT imported or executed";
    report.push(note);
  }

  // Claude hook JSON (plugin manifests): map names, record unmapped — never silently dropped.
  const rawHooks = entry.kind === "plugin" ? (entry.data?.hooks as Record<string, unknown> | undefined) : undefined;
  if (rawHooks && typeof rawHooks === "object") {
    hooks = mapHooks(rawHooks);
    const unmapped = Object.entries(hooks).filter(([, v]) => v === null).map(([k]) => k);
    report.push(`hooks mapped: ${Object.entries(hooks).filter(([, v]) => v).map(([k, v]) => `${k}→${v}`).join(", ") || "(none)"}`);
    if (unmapped.length) report.push(`hooks with no RA equivalent (not dropped, recorded here): ${unmapped.join(", ")}`);
    if (opts.withHooks) {
      // Opt-in (--with-hooks): record runnable definitions. Execution remains
      // gated by ra.json plugin_runtime.hooks:"on" (default "opt-in" = off).
      hookDefs = extractHookCommands(rawHooks).map((h) => ({ event: h.event, matcher: h.matcher, command: h.handler.command, timeout: h.handler.timeout }));
      hooksEnabled = true;
      report.push(`hooks marked RUNNABLE (--with-hooks; also requires ra.json plugin_runtime.hooks:"on"): ${hookDefs.length} handler(s)`);
    } else {
      report.push("hooks imported as records only — re-import with --with-hooks to enable execution (plus ra.json plugin_runtime.hooks:\"on\")");
    }
  }

  const record: ImportRecord = { id, source: entry.source, kind: entry.kind, name: entry.name, originPath: entry.path, targetPath, importedAt: new Date().toISOString(), hooks, ...(hooksEnabled !== undefined ? { hooksEnabled } : {}), ...(hookDefs ? { hookDefs } : {}), note };
  manifest.imports.push(record);
  saveManifest(manifest, home);
  if (targetPath) report.unshift(`→ ${targetPath}`);
  return { record, status: targetPath || snippet ? "imported" : "skipped", snippet, report };
}

/** Remove imported entry/entries: delete copied files + manifest records (all name matches). */
export function removeImported(idOrName: string, home = homedir()): boolean {
  const manifest = loadManifest(home);
  const matches = manifest.imports.filter((r) => r.id === idOrName || r.name === idOrName);
  if (!matches.length) return false;
  manifest.imports = manifest.imports.filter((r) => !matches.includes(r));
  for (const rec of matches) {
    if (!rec.targetPath) continue;
    if (rec.kind === "skill") rmSync(rec.targetPath, { recursive: true, force: true });
    else if (existsSync(rec.targetPath)) rmSync(rec.targetPath);
  }
  saveManifest(manifest, home);
  return true;
}

// ---- MCP auto-apply (--apply-mcp) ------------------------------------------------------

export interface McpApplyResult {
  applied: string[];
  skipped: string[];
  configPath: string;
}

/**
 * Write detected MCP servers into a ra.json `mcp` block (project ra.json when
 * present, else ~/.ra/ra.json — mirroring loadRaConfig resolution). Never
 * overwrites an existing server of the same name; `{env:VAR}` templates and
 * literal key names pass through untouched (no secret synthesis).
 */
export function applyMcpToConfig(
  servers: Array<{ name: string; data: Record<string, unknown> }>,
  home = homedir(),
  projectRoot?: string,
): McpApplyResult {
  const applied: string[] = [];
  const skipped: string[] = [];
  let configPath: string;
  let cfg: Record<string, unknown>;
  if (projectRoot && existsSync(join(projectRoot, "ra.json"))) {
    configPath = join(projectRoot, "ra.json");
  } else {
    configPath = join(home, ".ra", "ra.json");
  }
  try {
    cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown> : {};
  } catch {
    cfg = {};
  }
  for (const { name, data } of servers) {
    const entry = mcpConfigEntry(data);
    if (!entry) { skipped.push(`${name} (unrecognized shape)`); continue; }
    const mcp = (cfg.mcp ?? {}) as Record<string, unknown>;
    if (mcp[name] !== undefined) { skipped.push(`${name} (already configured — never overwritten)`); continue; }
    mcp[name] = entry;
    cfg.mcp = mcp;
    applied.push(name);
  }
  if (applied.length) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  }
  return { applied, skipped, configPath };
}
