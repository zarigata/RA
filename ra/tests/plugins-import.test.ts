// plugins-import.test.ts — fixture store trees in a temp HOME → detect → convert
// → assert files + manifest + provenance; code-plugin skip; idempotent re-import.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStores } from "../src/plugins/stores.ts";
import { importEntry, loadManifest, removeImported, mapHooks } from "../src/plugins/import.ts";
import { PluginHost } from "../src/plugins/host.ts";

let HOME = "";
const gs = () => join(HOME, "Library", "Application Support", "Code", "User", "globalStorage");

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "ra-plugins-test-"));
  // Claude Code plugin cache: <owner>/<pkg>/<ver>/.claude-plugin/plugin.json
  const cc = join(HOME, ".claude", "plugins", "cache", "acme", "acme-tools", "1.0.0");
  mkdirSync(join(cc, ".claude-plugin"), { recursive: true });
  writeFileSync(join(cc, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "acme-tools", description: "Acme declarative toolkit",
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }], UserPromptSubmit: [{ hooks: [{ type: "command", command: "node x.js" }] }] },
    mcpServers: { "acme-mcp": { command: "acmed", args: ["--stdio"] } },
  }));
  mkdirSync(join(cc, "skills", "acme-skill"), { recursive: true });
  writeFileSync(join(cc, "skills", "acme-skill", "SKILL.md"), "---\nname: acme-skill\ndescription: Does acme things.\n---\n\nBody.");
  mkdirSync(join(cc, "agents"), { recursive: true });
  writeFileSync(join(cc, "agents", "acme-agent.md"), "---\nname: acme-agent\ndescription: Acme agent.\n---\n\nYou are acme.");
  mkdirSync(join(cc, "commands"), { recursive: true });
  writeFileSync(join(cc, "commands", "acme-cmd.md"), "---\nname: acme-cmd\ndescription: Run acme.\n---\n\nDo $ARGUMENTS now.");
  // Imperative plugin (code, must be skipped).
  mkdirSync(join(HOME, ".claude", "plugins", "cache", "acme", "acme-code", "2.0.0", ".claude-plugin"), { recursive: true });
  writeFileSync(join(HOME, ".claude", "plugins", "cache", "acme", "acme-code", "2.0.0", ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "acme-code", description: "Runs arbitrary JS", hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "node p.js" }] }] },
  }));
  // Cursor skill.
  mkdirSync(join(HOME, ".cursor", "skills", "cur-skill"), { recursive: true });
  writeFileSync(join(HOME, ".cursor", "skills", "cur-skill", "SKILL.md"), "---\nname: cur-skill\ndescription: Cursor skill.\n---\n\nBody.");
  // OpenCode config with mcp server + agent + imperative plugin.
  mkdirSync(join(HOME, ".config", "opencode"), { recursive: true });
  writeFileSync(join(HOME, ".config", "opencode", "opencode.json"), JSON.stringify({
    mcp: { servers: { "oc-mcp": { type: "local", command: ["npx", "-y", "oc-mcp"] } } },
    agents: { "oc-agent": { description: "OpenCode agent", mode: "primary", system: "Be OC." } },
    plugins: [{ package: "opencode-dcp@2.0.3" }],
  }));
  // Cline + Roo MCP settings.
  mkdirSync(join(gs(), "saoudrizwan.claude-dev", "settings"), { recursive: true });
  writeFileSync(join(gs(), "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), JSON.stringify({ mcpServers: { "cline-mcp": { command: "clined", args: ["-s"], env: { K: "V" } } } }));
  mkdirSync(join(gs(), "rooveterinaryinc.roo-cline", "settings"), { recursive: true });
  writeFileSync(join(gs(), "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), JSON.stringify({ mcpServers: { "roo-mcp": { command: "rood", args: [] } } }));
});

afterAll(() => { rmSync(HOME, { recursive: true, force: true }); });

const find = (entries: ReturnType<typeof detectStores>, source: string, kind: string, name: string) =>
  entries.find((e) => e.source === source && e.kind === kind && e.name === name);

describe("store detector", () => {
  test("detects all five sources in fixture HOME", () => {
    const entries = detectStores(HOME);
    expect(find(entries, "claude-code", "skill", "acme-skill")).toBeTruthy();
    expect(find(entries, "claude-code", "agent", "acme-agent")).toBeTruthy();
    expect(find(entries, "claude-code", "command", "acme-cmd")).toBeTruthy();
    expect(find(entries, "claude-code", "mcp", "acme-mcp")).toBeTruthy();
    expect(find(entries, "claude-code", "plugin", "acme-tools")).toBeTruthy();
    expect(find(entries, "cursor", "skill", "cur-skill")).toBeTruthy();
    expect(find(entries, "opencode", "mcp", "oc-mcp")).toBeTruthy();
    expect(find(entries, "opencode", "agent", "oc-agent")).toBeTruthy();
    expect(find(entries, "opencode", "plugin", "opencode-dcp@2.0.3")).toBeTruthy();
    expect(find(entries, "cline", "mcp", "cline-mcp")).toBeTruthy();
    expect(find(entries, "roo", "mcp", "roo-mcp")).toBeTruthy();
  });

  test("absent store roots skip silently", () => {
    const entries = detectStores(join(HOME, "does-not-exist"));
    expect(entries.filter((e) => e.source === "claude-code").length).toBe(0);
  });
});

describe("importer", () => {
  test("skill → copied into ~/.ra/skills with provenance", () => {
    const e = find(detectStores(HOME), "claude-code", "skill", "acme-skill")!;
    const r = importEntry(e, HOME);
    expect(r.status).toBe("imported");
    expect(existsSync(join(HOME, ".ra", "skills", "acme-skill", "SKILL.md"))).toBe(true);
    expect(r.record.source).toBe("claude-code");
    expect(r.record.originPath).toContain("acme-tools");
  });

  test("agent md → ~/.ra/agents preserving frontmatter", () => {
    const e = find(detectStores(HOME), "claude-code", "agent", "acme-agent")!;
    importEntry(e, HOME);
    const md = readFileSync(join(HOME, ".ra", "agents", "acme-agent.md"), "utf-8");
    expect(md).toContain("description: Acme agent.");
  });

  test("command → ~/.ra/commands, $ARGUMENTS syntax preserved", () => {
    const e = find(detectStores(HOME), "claude-code", "command", "acme-cmd")!;
    importEntry(e, HOME);
    const md = readFileSync(join(HOME, ".ra", "commands", "acme-cmd.md"), "utf-8");
    expect(md).toContain("$ARGUMENTS");
  });

  test("mcp → snippet returned, never auto-applied", () => {
    const e = find(detectStores(HOME), "claude-code", "mcp", "acme-mcp")!;
    const r = importEntry(e, HOME);
    expect(r.snippet).toContain('"acme-mcp"');
    expect(r.snippet).toContain('"command": "acmed"');
    expect(r.record.targetPath).toBeNull();
    // Cline mcp with env
    const c = find(detectStores(HOME), "cline", "mcp", "cline-mcp")!;
    const rc = importEntry(c, HOME);
    expect(rc.snippet).toContain('"env": {"K":"V"}');
    // OpenCode array-command form
    const o = find(detectStores(HOME), "opencode", "mcp", "oc-mcp")!;
    const ro = importEntry(o, HOME);
    expect(ro.snippet).toContain('"command": "npx"');
    expect(ro.snippet).toContain('"args": ["-y", "oc-mcp"]');
  });

  test("imperative plugin → listed, NOT imported/executed, honest note", () => {
    const e = find(detectStores(HOME), "claude-code", "plugin", "acme-code")!;
    const r = importEntry(e, HOME);
    expect(r.status).toBe("skipped");
    expect(r.record.targetPath).toBeNull();
    expect(r.record.note).toContain("NOT imported");
  });

  test("hook JSON maps onto KNOWN_HOOKS; unmapped recorded, never dropped", () => {
    const mapped = mapHooks({ SessionStart: [], UserPromptSubmit: [], PostToolUse: [] });
    expect(mapped.UserPromptSubmit).toBe("tui.prompt.append");
    expect(mapped.SessionStart).toBeNull();
    expect(mapped.PostToolUse).toBeNull();
    const e = find(detectStores(HOME), "claude-code", "plugin", "acme-tools")!;
    const r = importEntry(e, HOME);
    expect(r.record.hooks!.SessionStart).toBeNull();
    expect(r.record.hooks!.UserPromptSubmit).toBe("tui.prompt.append");
    expect(r.report.some((l) => l.includes("no RA equivalent"))).toBe(true);
  });

  test("idempotent re-import", () => {
    const e = find(detectStores(HOME), "claude-code", "skill", "acme-skill")!;
    const r2 = importEntry(e, HOME);
    expect(r2.status).toBe("already");
    expect(loadManifest(HOME).imports.filter((i) => i.name === "acme-skill").length).toBe(1);
  });

  test("manifest carries provenance for every record", () => {
    for (const rec of loadManifest(HOME).imports) {
      expect(rec.source).toBeTruthy();
      expect(rec.originPath.startsWith(HOME)).toBe(true);
      expect(rec.importedAt).toBeTruthy();
    }
  });

  test("remove deletes files + manifest record", () => {
    const e = find(detectStores(HOME), "cursor", "skill", "cur-skill")!;
    importEntry(e, HOME);
    expect(existsSync(join(HOME, ".ra", "skills", "cur-skill"))).toBe(true);
    expect(removeImported("cur-skill", HOME)).toBe(true);
    expect(existsSync(join(HOME, ".ra", "skills", "cur-skill"))).toBe(false);
    expect(loadManifest(HOME).imports.some((i) => i.name === "cur-skill")).toBe(false);
  });

  test("opencode agent JSON → markdown with mode mapped", () => {
    const e = find(detectStores(HOME), "opencode", "agent", "oc-agent")!;
    importEntry(e, HOME);
    const md = readFileSync(join(HOME, ".ra", "agents", "oc-agent.md"), "utf-8");
    expect(md).toContain("mode: primary");
    expect(md).toContain("Be OC.");
  });

  test("mapHooks output values are KNOWN_HOOKS or null", () => {
    for (const v of Object.values(mapHooks({ PreToolUse: [], Stop: [], SubagentStop: [], Notification: [] }))) {
      expect(v === null || (PluginHost.KNOWN_HOOKS as readonly string[]).includes(v)).toBe(true);
    }
  });
});
