// stores.ts — plugin store detector: scan known local store roots on disk and
// return normalized entries for the importer. Read-only; never executes anything.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseSkillFrontmatter } from "../skills.ts";
import { parseRoomodes } from "./roo-modes.ts";
import { parseToml } from "./toml.ts";

export type StoreSource = "claude-code" | "opencode" | "cursor" | "cline" | "roo" | "codex";
export type EntryKind = "skill" | "agent" | "command" | "mcp" | "plugin" | "roo-mode" | "rule" | "workflow" | "permission-profile";

export interface StoreEntry {
  source: StoreSource;
  kind: EntryKind;
  name: string;
  /** File (md/json/manifest) or directory (skill) the entry came from. */
  path: string;
  description?: string;
  /** Parsed JSON payload for JSON-sourced entries (mcp server cfg, agent def, plugin manifest). */
  data?: Record<string, unknown>;
}

// ponytail: scan caps — ≤60 plugin roots per cache dir, ≤100 entries per content
// dir; larger stores are silently truncated. Raise the caps when stores grow.
const MAX_ROOTS = 60;
const MAX_ENTRIES = 100;

function dirents(p: string) {
  try { return readdirSync(p, { withFileTypes: true }); } catch { return []; }
}
function readJson(p: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>; } catch { return null; }
}
function mdDescription(p: string): string {
  try { return parseSkillFrontmatter(readFileSync(p, "utf-8")).description; } catch { return ""; }
}

/** Skills: one subdir with a SKILL.md each (agent-skills layout, all stores). */
function skillDirEntries(dir: string, source: StoreSource, out: StoreEntry[]): void {
  let n = 0;
  for (const d of dirents(dir)) {
    if (!d.isDirectory() || ++n > MAX_ENTRIES) continue;
    if (!existsSync(join(dir, d.name, "SKILL.md"))) continue;
    out.push({ source, kind: "skill", name: d.name, path: join(dir, d.name), description: mdDescription(join(dir, d.name, "SKILL.md")) || "(no description)" });
  }
}

/** Agents/commands: flat dirs of markdown files with frontmatter. */
function mdDirEntries(dir: string, kind: "agent" | "command", source: StoreSource, out: StoreEntry[]): void {
  let n = 0;
  for (const f of dirents(dir)) {
    if (!f.name.endsWith(".md") || ++n > MAX_ENTRIES) continue;
    out.push({ source, kind, name: f.name.slice(0, -3), path: join(dir, f.name), description: mdDescription(join(dir, f.name)) });
  }
}

/** A Claude-Code-style plugin root (manifest + optional skills/agents/commands/mcpServers). */
function pluginRootEntries(root: string, manifest: Record<string, unknown>, source: StoreSource, out: StoreEntry[]): void {
  const name = String(manifest.name ?? "plugin");
  out.push({ source, kind: "plugin", name, path: root, description: String(manifest.description ?? ""), data: manifest });
  skillDirEntries(join(root, "skills"), source, out);
  mdDirEntries(join(root, "agents"), "agent", source, out);
  mdDirEntries(join(root, "commands"), "command", source, out);
  const mcp = manifest.mcpServers as Record<string, unknown> | undefined;
  if (mcp && typeof mcp === "object") {
    for (const [srv, cfg] of Object.entries(mcp)) {
      out.push({ source, kind: "mcp", name: srv, path: join(root, ".claude-plugin", "plugin.json"), description: `MCP server from plugin ${name}`, data: cfg as Record<string, unknown> });
    }
  }
}

/** Plugin caches have the shape <cache>/<owner>/<name>/<version>/.claude-plugin/plugin.json. */
function pluginCacheEntries(cacheDir: string, source: StoreSource, out: StoreEntry[]): void {
  let roots = 0;
  for (const owner of dirents(cacheDir)) {
    if (!owner.isDirectory() || owner.name.startsWith(".")) continue;
    for (const pkg of dirents(join(cacheDir, owner.name))) {
      if (!pkg.isDirectory()) continue;
      for (const ver of dirents(join(cacheDir, owner.name, pkg.name))) {
        if (!ver.isDirectory()) continue;
        if (++roots > MAX_ROOTS) return;
        const root = join(cacheDir, owner.name, pkg.name, ver.name);
        const manifest = readJson(join(root, ".claude-plugin", "plugin.json")) ?? readJson(join(root, "plugin.json"));
        if (manifest) pluginRootEntries(root, manifest, source, out);
      }
    }
  }
}

/** OpenCode: opencode.json (mcp.servers, agents, plugins) + command/ and agent/ md dirs. */
function opencodeEntries(home: string, out: StoreEntry[]): void {
  for (const root of [join(home, ".opencode"), join(home, ".config", "opencode")]) {
    mdDirEntries(join(root, "command"), "command", "opencode", out);
    mdDirEntries(join(root, "agent"), "agent", "opencode", out);
    const cfg = readJson(join(root, "opencode.json"));
    if (!cfg) continue;
    const servers = (cfg.mcp as { servers?: Record<string, unknown> } | undefined)?.servers;
    if (servers) for (const [name, srv] of Object.entries(servers)) {
      out.push({ source: "opencode", kind: "mcp", name, path: join(root, "opencode.json"), data: srv as Record<string, unknown> });
    }
    const agents = cfg.agents as Record<string, Record<string, unknown>> | undefined;
    if (agents) for (const [name, def] of Object.entries(agents)) {
      out.push({ source: "opencode", kind: "agent", name, path: join(root, "opencode.json"), description: String(def?.description ?? ""), data: def });
    }
    const plugins = cfg.plugins as unknown[] | undefined;
    if (plugins) for (const p of plugins) {
      const name = typeof p === "string" ? p : String((p as { package?: string })?.package ?? "opencode-plugin");
      out.push({ source: "opencode", kind: "plugin", name, path: join(root, "opencode.json"), description: "imperative TS plugin (listed, not imported)" });
    }
  }
}

/** Cline / Roo keep MCP marketplace settings in VS Code globalStorage. */
function vscodeMcpEntries(home: string, ext: string, file: string, source: "cline" | "roo", out: StoreEntry[]): void {
  const gs = process.platform === "darwin"
    ? join(home, "Library", "Application Support", "Code", "User", "globalStorage")
    : join(home, ".config", "Code", "User", "globalStorage");
  const cfg = readJson(join(gs, ext, "settings", file));
  const servers = (cfg?.mcpServers as Record<string, unknown> | undefined) ?? {};
  for (const [name, srv] of Object.entries(servers)) {
    out.push({ source, kind: "mcp", name, path: join(gs, ext, "settings", file), data: srv as Record<string, unknown> });
  }
}

/** Markdown rule/workflow files (Cline rules dirs + workflows dirs). */
function mdFileEntries(dir: string, kind: "rule" | "workflow", source: StoreSource, out: StoreEntry[]): void {
  let n = 0;
  for (const f of dirents(dir)) {
    if (!f.name.endsWith(".md") || ++n > MAX_ENTRIES) continue;
    out.push({ source, kind, name: f.name.slice(0, -3), path: join(dir, f.name), description: mdDescription(join(dir, f.name)) });
  }
}

/** A `.roomodes` file (YAML or JSON) → one roo-mode entry per parsed mode. */
function rooModeEntries(path: string, source: StoreSource, out: StoreEntry[], label = path): void {
  let raw: string;
  try { raw = readFileSync(path, "utf-8"); } catch { return; }
  const { modes, warnings } = parseRoomodes(raw);
  for (const w of warnings) console.error(`\x1b[2m[plugins] ${label}: ${w}\x1b[0m`);
  for (const mode of modes) {
    out.push({
      source, kind: "roo-mode", name: mode.slug, path,
      description: [mode.description, mode.whenToUse].filter(Boolean).join(" — ") || "(no description)",
      data: mode as unknown as Record<string, unknown>,
    });
  }
}

/** Cline: rules (always-on + `paths:`-conditional) and workflows (→ commands). */
function clineEntries(home: string, cwd: string | undefined, out: StoreEntry[]): void {
  const roots = [
    join(home, ".clinerules"),           // canonical dir
    join(home, ".cline", "rules"),       // newer dir layout
    join(home, "Documents", "Cline", "Rules"), // global rules
  ];
  if (cwd) roots.unshift(join(cwd, ".clinerules"), join(cwd, ".cline", "rules"));
  for (const dir of roots) mdFileEntries(dir, "rule", "cline", out);
  // Legacy single-file .clinerules (was markdown, now usually a dir).
  if (cwd) {
    // Legacy single-file .clinerules (when it's a file, not a dir): readdirSync
    // throws ENOTDIR → treat as one rule entry.
    const legacy = join(cwd, ".clinerules");
    if (existsSync(legacy)) {
      try { readdirSync(legacy); } catch {
        out.push({ source: "cline", kind: "rule", name: "clinerules", path: legacy, description: mdDescription(legacy) });
      }
    }
  }
  // Workflows → commands.
  const wfRoots = [join(home, ".clinerules", "workflows"), join(home, ".cline", "workflows"), join(home, "Documents", "Cline", "Workflows")];
  if (cwd) wfRoots.unshift(join(cwd, ".clinerules", "workflows"), join(cwd, ".cline", "workflows"));
  for (const dir of wfRoots) mdFileEntries(dir, "workflow", "cline", out);
}

/** Roo: `.roomodes` (project) + global custom_modes.yaml. */
function rooEntries(home: string, cwd: string | undefined, out: StoreEntry[]): void {
  if (cwd) {
    for (const f of [".roomodes", ".roomodes.json"]) {
      const p = join(cwd, f);
      if (existsSync(p)) rooModeEntries(p, "roo", out);
    }
  }
  const gs = process.platform === "darwin"
    ? join(home, "Library", "Application Support", "Code", "User", "globalStorage")
    : join(home, ".config", "Code", "User", "globalStorage");
  const global = join(gs, "rooveterinaryinc.roo-cline", "settings", "custom_modes.yaml");
  if (existsSync(global)) rooModeEntries(global, "roo", out);
  if (cwd) mdFileEntries(join(cwd, ".roo", "workflows"), "workflow", "roo", out);
}

/**
 * Codex: config.toml (mcp_servers + approval/sandbox → permission profile
 * record), skills dirs, legacy prompts (→ commands).
 */
function codexEntries(home: string, out: StoreEntry[]): void {
  const root = process.env.CODEX_HOME && existsSync(process.env.CODEX_HOME) ? process.env.CODEX_HOME : join(home, ".codex");
  const cfgPath = join(root, "config.toml");
  if (existsSync(cfgPath)) {
    try {
      const { value: cfg } = parseToml(readFileSync(cfgPath, "utf-8"));
      const servers = (cfg.mcp_servers ?? {}) as Record<string, Record<string, unknown>>;
      for (const [name, srv] of Object.entries(servers)) {
        out.push({ source: "codex", kind: "mcp", name, path: cfgPath, data: srv, description: "MCP server from Codex config.toml" });
      }
      if (cfg.approval_policy !== undefined || cfg.sandbox_mode !== undefined) {
        out.push({
          source: "codex", kind: "permission-profile", name: "codex", path: cfgPath,
          description: `approval_policy=${String(cfg.approval_policy ?? "(unset)")} sandbox_mode=${String(cfg.sandbox_mode ?? "(unset)")}`,
          data: { approval_policy: cfg.approval_policy, sandbox_mode: cfg.sandbox_mode },
        });
      }
    } catch (e) {
      console.error(`\x1b[2m[plugins] codex config.toml unreadable: ${String(e)}\x1b[0m`);
    }
  }
  skillDirEntries(join(root, "skills"), "codex", out);
  // Legacy prompts (~/.codex/prompts, removed in Codex v0.117) → commands.
  mdDirEntries(join(root, "prompts"), "command", "codex", out);
}

/** Project-root opencode.json (GAP §d.9): same shapes as the global scan. */
function opencodeProjectEntries(cwd: string, out: StoreEntry[]): void {
  for (const p of [join(cwd, "opencode.json"), join(cwd, "opencode.jsonc"), join(cwd, ".opencode", "opencode.json")]) {
    const cfg = readJson(p);
    if (!cfg) continue;
    const servers = (cfg.mcp as { servers?: Record<string, unknown> } | undefined)?.servers;
    if (servers) for (const [name, srv] of Object.entries(servers)) {
      out.push({ source: "opencode", kind: "mcp", name, path: p, data: srv as Record<string, unknown> });
    }
    const agents = cfg.agents as Record<string, Record<string, unknown>> | undefined;
    if (agents) for (const [name, def] of Object.entries(agents)) {
      out.push({ source: "opencode", kind: "agent", name, path: p, description: String(def?.description ?? ""), data: def });
    }
    const plugins = cfg.plugins as unknown[] | undefined;
    if (plugins) for (const pl of plugins) {
      const name = typeof pl === "string" ? pl : String((pl as { package?: string })?.package ?? "opencode-plugin");
      out.push({ source: "opencode", kind: "plugin", name, path: p, description: "imperative TS plugin (listed, not imported)" });
    }
    break; // first found wins
  }
}


/**
 * Detect every known store under `home` (default: the real home). Absent
 * roots skip silently. `cwd` (default: process.cwd()) enables the
 * project-level scans: .roomodes, .clinerules, opencode.json.
 */
export function detectStores(home = homedir(), cwd = process.cwd()): StoreEntry[] {
  const out: StoreEntry[] = [];
  // Claude Code: plugin caches + user-level skills/agents/commands dirs.
  pluginCacheEntries(join(home, ".claude", "plugins", "cache"), "claude-code", out);
  skillDirEntries(join(home, ".claude", "skills"), "claude-code", out);
  mdDirEntries(join(home, ".claude", "agents"), "agent", "claude-code", out);
  mdDirEntries(join(home, ".claude", "commands"), "command", "claude-code", out);
  // Cursor: plugin cache + skills.
  pluginCacheEntries(join(home, ".cursor", "plugins", "cache"), "cursor", out);
  skillDirEntries(join(home, ".cursor", "skills"), "cursor", out);
  // Neutral cross-agent skills dirs (Codex writes ~/.agents/skills; OpenCode
  // and RA read it — INTEROP precedent 8). Plus Cursor's skills-cursor dir.
  skillDirEntries(join(home, ".agents", "skills"), "codex", out);
  skillDirEntries(join(home, ".cursor", "skills-cursor"), "cursor", out);
  // Project .agents/skills (repo-level standard).
  if (cwd) skillDirEntries(join(cwd, ".agents", "skills"), "opencode", out);
  // OpenCode: global config + dirs, then project opencode.json.
  opencodeEntries(home, out);
  if (cwd) opencodeProjectEntries(cwd, out);
  // Cline / Roo (VS Code globalStorage marketplaces + rules/workflows/modes).
  vscodeMcpEntries(home, "saoudrizwan.claude-dev", "cline_mcp_settings.json", "cline", out);
  vscodeMcpEntries(home, "rooveterinaryinc.roo-cline", "mcp_settings.json", "roo", out);
  clineEntries(home, cwd, out);
  rooEntries(home, cwd, out);
  // Codex: config.toml + skills + legacy prompts.
  codexEntries(home, out);
  // Dedupe (source, kind, name) — cache revisions can repeat a plugin name.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.source}:${e.kind}:${e.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
