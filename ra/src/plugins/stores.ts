// stores.ts — plugin store detector: scan known local store roots on disk and
// return normalized entries for the importer. Read-only; never executes anything.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseSkillFrontmatter } from "../skills.ts";

export type StoreSource = "claude-code" | "opencode" | "cursor" | "cline" | "roo";
export type EntryKind = "skill" | "agent" | "command" | "mcp" | "plugin";

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

/** Detect every known store under `home` (default: the real home). Absent roots skip silently. */
export function detectStores(home = homedir()): StoreEntry[] {
  const out: StoreEntry[] = [];
  // Claude Code: plugin caches + user-level skills/agents/commands dirs.
  pluginCacheEntries(join(home, ".claude", "plugins", "cache"), "claude-code", out);
  skillDirEntries(join(home, ".claude", "skills"), "claude-code", out);
  mdDirEntries(join(home, ".claude", "agents"), "agent", "claude-code", out);
  mdDirEntries(join(home, ".claude", "commands"), "command", "claude-code", out);
  // Cursor: plugin cache + skills.
  pluginCacheEntries(join(home, ".cursor", "plugins", "cache"), "cursor", out);
  skillDirEntries(join(home, ".cursor", "skills"), "cursor", out);
  // OpenCode.
  opencodeEntries(home, out);
  // Cline / Roo (VS Code globalStorage marketplaces).
  vscodeMcpEntries(home, "saoudrizwan.claude-dev", "cline_mcp_settings.json", "cline", out);
  vscodeMcpEntries(home, "rooveterinaryinc.roo-cline", "mcp_settings.json", "roo", out);
  // Dedupe (source, kind, name) — cache revisions can repeat a plugin name.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.source}:${e.kind}:${e.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
