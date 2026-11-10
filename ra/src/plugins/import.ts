// import.ts — convert detected store entries into RA's native formats.
// NEVER executes third-party code: declarative files are copied/remapped,
// imperative plugins are listed with an honest note and skipped.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { PluginHost } from "./host.ts";
import { extractHookCommands } from "./hook-shim.ts";
import { parseRulePaths } from "../rules.ts";
import type { RooMode } from "./roo-modes.ts";
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
  /** Settings-import detail: translated permission rules / recorded-not-applied keys. */
  settings?: {
    /** ra.json permission.tool entries derived from permissions.{allow,ask,deny}. */
    permissionRules?: Record<string, string[]>;
    /** env keys recorded but never applied (security). */
    envRecordedOnly?: string[];
    /** model alias noted for the manifest. */
    model?: string;
  };
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
  SessionStart: "session.start",
  SessionEnd: "session.end",
  PostToolUse: "tool.execute.after",
  Notification: null,
  PreCompact: "context.compact",
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

/** Claude Code tool name → RA permission verb (mcp servers map to the mcp verb). */
const CLAUDE_TOOL_TO_RA: Record<string, string> = {
  Bash: "bash", Read: "read", Edit: "edit", Write: "write", MultiEdit: "multiedit", Glob: "glob",
  Grep: "grep", WebFetch: "webfetch", WebSearch: "websearch", Task: "task", TodoWrite: "todo",
  Skill: "skill", WebFetchTool: "webfetch",
};

/**
 * Claude settings.json `permissions.{allow,ask,deny}` rule → namespaced RA
 * permission.tool entry. Rules are `Tool` or `Tool(specifier)`; only bare
 * tool names map (RA's permission keys are per-verb — specifiers like
 * `Bash(npm run *)` have no RA key and pass through as a note, never a
 * mistranslation). Namespaced as `claude:<level>:<Tool>` so an import can
 * never overwrite a user's own rule.
 */
export function claudePermRuleToRa(rule: string): { key: string; level: "allow" | "ask" | "deny" } | null {
  const bare = rule.match(/^([A-Za-z]+)(?:[([]|$)/);
  if (!bare) return null;
  const verb = CLAUDE_TOOL_TO_RA[bare[1]];
  if (!verb) return null;
  const hasSpecifier = /[([]/.test(rule);
  const key = hasSpecifier ? `claude:${verb}:${rule}` : `claude:${verb}`;
  return { key, level: "allow" };
}

/**
 * Claude settings.json → RA import payload. `permissions.{allow,ask,deny}`
 * become namespaced ra.json permission.tool entries; `env` is RECORDED,
 * never applied (auto-exporting env would be a silent security change);
 * `model` is noted in the manifest. Returns the manifest `settings` record
 * plus the permission entries to merge (never overwriting existing keys).
 */
export function claudeSettingsToImport(data: Record<string, unknown>): {
  settings: NonNullable<ImportRecord["settings"]>;
  permissionRules: Record<string, "allow" | "ask" | "deny">;
  notes: string[];
} {
  const settings: NonNullable<ImportRecord["settings"]> = {};
  const permissionRules: Record<string, "allow" | "ask" | "deny"> = {};
  const notes: string[] = [];
  const perms = data.permissions as { allow?: unknown[]; ask?: unknown[]; deny?: unknown[] } | undefined;
  if (perms) {
    for (const level of ["deny", "ask", "allow"] as const) {
      for (const raw of Array.isArray(perms[level]) ? perms[level]! : []) {
        if (typeof raw !== "string") continue;
        const m = raw.match(/^([A-Za-z]+)(\(|$)/);
        if (!m || !CLAUDE_TOOL_TO_RA[m[1]]) { notes.push(`rule not mappable (kept as note): ${raw}`); continue; }
        const verb = CLAUDE_TOOL_TO_RA[m[1]];
        const hasSpec = raw.includes("(");
        // Namespaced key: bare verbs collapse onto claude:<verb>; specifier
        // rules keep their full text so two Bash rules never collide.
        const key = hasSpec ? `claude:${verb}:${raw}` : `claude:${verb}`;
        permissionRules[key] = level;
        (settings.permissionRules ??= {})[level] ??= [];
        settings.permissionRules[level]!.push(raw);
      }
    }
  }
  if (data.env && typeof data.env === "object") {
    settings.envRecordedOnly = Object.keys(data.env as object);
    notes.push(`env keys recorded but NOT applied (security): ${settings.envRecordedOnly.join(", ")}`);
  }
  if (typeof data.model === "string") {
    settings.model = data.model;
    notes.push(`model noted: ${data.model}`);
  }
  return { settings, permissionRules, notes };
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
  if (typeof data.url === "string") {
    // Cline: `"type":"sse"` selects legacy SSE; `"streamableHttp"` (default)
    // is the modern transport. The marker rides the entry so mcp.ts picks
    // the right client.
    // ponytail: Cline's zod schema also defaults url-without-type to legacy
    // SSE, but defaulting ALL url entries to sse would mistype Codex/OpenCode
    // streamable endpoints — pass the source through here if that default
    // ever needs honoring.
    return data.type === "sse" ? { url: data.url, type: "sse" } : { url: data.url };
  }
  const argv = Array.isArray(data.command) ? data.command.map(String) : typeof data.command === "string" ? [data.command] : null;
  if (!argv?.length) return null;
  const out: Record<string, unknown> = { command: argv[0] };
  const args = argv.length > 1 ? argv.slice(1) : Array.isArray(data.args) ? data.args.map(String) : undefined;
  if (args?.length) out.args = args;
  if (data.env && typeof data.env === "object") out.env = data.env;
  // Codex startup_timeout_sec / tool_timeout_sec ride the entry verbatim
  // (INTEROP §4: timeouts → mcp config). Consumers may read them when wiring
  // per-server timeouts; unknown keys never block the import.
  for (const k of ["startup_timeout_sec", "tool_timeout_sec"] as const) {
    const v = data[k];
    if (typeof v === "number" || typeof v === "string") out[k] = v;
  }
  // Per-server tool allowlist (Cline autoApprove / Codex enabled_tools).
  // Enforced by mcp.ts at tool-registration + call time (toolAllowed()).
  const allow = allowlistOf(data);
  if (allow) out.tools = allow;
  return out;
}

/** Cline `autoApprove` / Codex `enabled_tools`+`disabled_tools` → {allow,deny} record. */
function allowlistOf(data: Record<string, unknown>): { allow?: string[]; deny?: string[] } | undefined {
  const allow = Array.isArray(data.autoApprove) ? data.autoApprove.map(String)
    : Array.isArray(data.enabled_tools) ? data.enabled_tools.map(String) : undefined;
  const deny = Array.isArray(data.disabled_tools) ? data.disabled_tools.map(String) : undefined;
  return allow?.length || deny?.length ? { ...(allow?.length ? { allow } : {}), ...(deny?.length ? { deny } : {}) } : undefined;
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

// ---- Roo modes → RA agents (INTEROP §2) ------------------------------------------------

/** Roo group → RA tool allow/deny sets. edit+fileRegex → path-scoped rule. */
function rooGroupsToPermission(mode: RooMode): { fm: string[]; notes: string[] } {
  const tools: Record<string, "allow" | "deny"> = {};
  const notes: string[] = [];
  let fileRegex: string | undefined;
  for (const g of mode.groups) {
    switch (g.name) {
      case "read": tools.read = "allow"; tools.glob = "allow"; tools.grep = "allow"; tools.outline = "allow"; tools.repomap = "allow"; break;
      case "edit":
        tools.edit = "allow"; tools.multiedit = "allow"; tools.write = "allow";
        if (g.fileRegex) fileRegex = g.fileRegex;
        break;
      case "command": tools.bash = "allow"; tools.diagnose = "allow"; tools.test = "allow"; break;
      case "mcp": tools.mcp = "allow"; break;
      case "browser": notes.push("browser group has no RA equivalent — recorded only"); break;
    }
  }
  const fm: string[] = [];
  const keys = Object.keys(tools);
  if (keys.length) {
    // Deny everything not in the group-derived allow set: RA's default-allow
    // would otherwise hand a read-only Roo mode WRITE/BASH.
    const allTools = ["write", "edit", "multiedit", "read", "outline", "diagnose", "glob", "grep", "bash", "test", "webfetch", "websearch", "skill", "repomap", "todo", "task", "mcp"];
    const lines = allTools.map((t) => `  ${t}: ${tools[t] === "allow" ? "allow" : "deny"}`);
    fm.push("permission:", ...lines);
  } else {
    // groups: [] → read-only agent.
    fm.push("permission:", "  read: allow", "  glob: allow", "  grep: allow", "  outline: allow", "  write: deny", "  edit: deny", "  bash: deny", "  mcp: deny");
    notes.push("empty groups → read-only agent");
  }
  if (fileRegex) fm.push(`  # roo fileRegex: ${fileRegex} (edit path scope)`);
  return { fm, notes };
}

/** A Roo mode → RA agent markdown (same artifact shape `ra plugins import` writes). */
export function rooModeToAgentMd(mode: RooMode, ns = "roo"): string {
  const description = [mode.description, mode.whenToUse].filter(Boolean).join(" — ") || `Imported Roo mode ${mode.slug}.`;
  const { fm, notes } = rooGroupsToPermission(mode);
  const body = [
    mode.roleDefinition.trim(),
    mode.customInstructions?.trim(),
    "When working on this project, consult the memory bank rules (memory-bank/*.md, loaded as .ra/rules/memory-bank/) for current context and progress before large changes.",
    notes.length ? `<!-- roo-import: ${notes.join("; ")} -->` : null,
  ].filter(Boolean).join("\n\n");
  return `---\ndescription: ${description.replace(/\n/g, " ")}\ncategory: roo\nmode: subagent\n${fm.join("\n")}\n---\n\n${body}\n`;
}

// ---- Cline rules / Codex artifacts ------------------------------------------------------

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
  let settingsRecord: ImportRecord["settings"] | undefined;

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
  } else if (entry.kind === "workflow") {
    // Cline workflows are slash-invoked markdown procedures — same shape as
    // RA commands. Copy verbatim; $ARGUMENTS semantics already match.
    targetPath = join(home, ".ra", "commands", `${entry.name}.md`);
    mkdirSync(join(home, ".ra", "commands"), { recursive: true });
    writeFileSync(targetPath, readFileSync(entry.path, "utf-8"));
  } else if (entry.kind === "rule") {
    // Cline rules → project-memory-style instruction files under .ra/rules/
    // (injected by loadProjectMemory via the rules loader). `paths:` frontmatter
    // is preserved so the conditional activation survives for tools that honor it.
    targetPath = join(home, ".ra", "rules", `${entry.name}.md`);
    mkdirSync(join(home, ".ra", "rules"), { recursive: true });
    writeFileSync(targetPath, readFileSync(entry.path, "utf-8"));
    const paths = parseRulePaths(readFileSync(entry.path, "utf-8"));
    if (paths.length) note = `paths-gated rule (${paths.join(", ")}) — injected when a touched file matches`;
  } else if (entry.kind === "roo-mode") {
    targetPath = join(home, ".ra", "agents", `roo-${entry.name}.md`);
    mkdirSync(join(home, ".ra", "agents"), { recursive: true });
    writeFileSync(targetPath, rooModeToAgentMd(entry.data as unknown as RooMode));
    note = "Roo mode → RA agent (groups mapped to tool permission gates)";
  } else if (entry.kind === "settings") {
    // Claude Code settings.json: permissions → namespaced ra.json
    // permission.tool entries (merged, never overwriting existing keys); env
    // RECORDED not applied (security); model noted in the manifest.
    const data = entry.data ?? {};
    const { settings, permissionRules, notes } = claudeSettingsToImport(data);
    let configPath: string | null = null;
    const ruleKeys = Object.keys(permissionRules);
    if (ruleKeys.length) {
      const apply = applyPermissionRules(permissionRules, home);
      configPath = apply.configPath;
      report.push(...ruleKeys.map((k) => `permission entry: ${k} = ${permissionRules[k]}`));
      if (apply.skipped.length) report.push(`already present (never overwritten): ${apply.skipped.join(", ")}`);
    }
    report.push(...notes);
    note = notes.join("; ") || "no mappable keys in settings.json";
    if (configPath) note += `; rules merged into ${configPath}`;
    settingsRecord = settings;
  } else if (entry.kind === "memory-bank") {
    // Roo/Cline memory-bank/*.md → .ra/rules/memory-bank/ (always-on rules;
    // injected by loadRules — the memory-bank dir is one of its roots).
    targetPath = join(home, ".ra", "rules", "memory-bank", `${entry.name}.md`);
    mkdirSync(join(home, ".ra", "rules", "memory-bank"), { recursive: true });
    writeFileSync(targetPath, readFileSync(entry.path, "utf-8"));
    note = "memory-bank file → .ra/rules/memory-bank (always-on rule; roo-* agents consult it via TASK routing)";
  } else if (entry.kind === "permission-profile") {
    // Codex approval_policy/sandbox_mode → record-only. RA has its own
    // permission/sandbox machinery; importing Codex's trust posture wholesale
    // would silently change the security stance, so this is reported, not enforced.
    note = "Codex approval_policy/sandbox_mode recorded (report-only, not auto-enforced)";
    report.push(note);
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

  const record: ImportRecord = { id, source: entry.source, kind: entry.kind, name: entry.name, originPath: entry.path, targetPath, importedAt: new Date().toISOString(), hooks, ...(hooksEnabled !== undefined ? { hooksEnabled } : {}), ...(hookDefs ? { hookDefs } : {}), ...(settingsRecord ? { settings: settingsRecord } : {}), note };
  manifest.imports.push(record);
  saveManifest(manifest, home);
  if (targetPath) report.unshift(`→ ${targetPath}`);
  return { record, status: targetPath || snippet || entry.kind === "settings" ? "imported" : "skipped", snippet, report };
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

/**
 * Merge namespaced permission.tool rules (Claude settings import) into ra.json
 * (project ra.json > ~/.ra/ra.json — same resolution as applyMcpToConfig).
 * Existing keys are NEVER overwritten; returns which keys were skipped.
 */
export function applyPermissionRules(
  rules: Record<string, "allow" | "ask" | "deny">,
  home = homedir(),
  projectRoot?: string,
): { applied: string[]; skipped: string[]; configPath: string } {
  const configPath = projectRoot && existsSync(join(projectRoot, "ra.json"))
    ? join(projectRoot, "ra.json")
    : join(home, ".ra", "ra.json");
  let cfg: Record<string, unknown>;
  try {
    cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown> : {};
  } catch {
    cfg = {};
  }
  const permission = (cfg.permission ?? {}) as { tool?: Record<string, string> };
  const tool = permission.tool ?? {};
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [key, level] of Object.entries(rules)) {
    if (tool[key] !== undefined) { skipped.push(key); continue; }
    tool[key] = level;
    applied.push(key);
  }
  if (applied.length) {
    permission.tool = tool;
    cfg.permission = permission;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  }
  return { applied, skipped, configPath };
}
