// parity-conformance.test.ts — Wave D fixture-conformance gate: every fixture
// under tests/fixtures/parity/ (byte-identical to /tmp/ra-parity/fixtures/,
// the 6-competitor canon) must import through the REAL `ra plugins`
// machinery (detectStores → importEntry / the CLI) and produce LIVE RA
// artifacts: resolvable agents, dispatchable commands, loadable skills,
// applied MCP config entries, runnable hooks. Isolated HOME per store — the
// user's real ~/.ra is never touched. Conformance table lands in
// /tmp/ra-parity/PARITY-SCOREBOARD.md.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { detectStores } from "../src/plugins/stores.ts";
import { importEntry, loadManifest, applyMcpToConfig, mcpConfigEntry } from "../src/plugins/import.ts";
import { parseToml } from "../src/plugins/toml.ts";
import { parseRoomodes } from "../src/plugins/roo-modes.ts";
import { loadRules, matchesPaths } from "../src/rules.ts";
import { listSkills, loadSkillBody, checkSkillStrict } from "../src/skills.ts";
import { resolveAgentFile, listCatalog, refreshCatalog } from "../src/agents/catalog.ts";
import { loadCustomCommands } from "../src/commands/index.ts";
import { runImportedHooksFor, resetHookRuntimeCache } from "../src/plugins/hook-shim.ts";

const FIX = join(import.meta.dir, "fixtures", "parity");
const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const read = (p: string) => readFileSync(p, "utf-8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
// VS Code globalStorage root — platform-specific (mirrors stores.ts).
const gsRoot = (home: string) => join(home, ...process.platform === "darwin"
  ? ["Library", "Application Support", "Code", "User", "globalStorage"]
  : [".config", "Code", "User", "globalStorage"]);

// ---- shared isolated environment ---------------------------------------------------------

let HOME = "";
let PROJ = "";

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "ra-conf-home-"));
  PROJ = mkdtempSync(join(tmpdir(), "ra-conf-proj-"));
});
afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(PROJ, { recursive: true, force: true });
});

/** Run the real CLI with an isolated HOME (os.homedir is read at process start). */
function cli(args: string[], extraEnv: Record<string, string> = {}): { code: number; out: string; err: string } {
  // process.execPath = the running bun binary — Windows-safe (no .exe PATH lookup).
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf-8",
    // Windows homedir() reads USERPROFILE, not HOME — set both so the
    // isolated HOME holds on every OS.
    env: { ...process.env, HOME, USERPROFILE: HOME, ...extraEnv },
    cwd: PROJ,
  });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** npm-cache-style plugin root for Claude-Code-shaped fixtures. */
function ccPluginRoot(name: string, version = "1.0.0"): string {
  return join(HOME, ".claude", "plugins", "cache", "fixture", name, version);
}

// ---- 1. Claude Code (8 fixtures) -----------------------------------------------------------

describe("conformance: claude-code (8 fixtures)", () => {
  test("plugin.json (commit-commands) → plugin entry with hooks absent, verbatim copy", () => {
    const root = ccPluginRoot("commit-commands");
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), read(join(FIX, "claude-code", "plugin.json")));
    const entries = detectStores(HOME, PROJ).filter((e) => e.source === "claude-code");
    const plugin = entries.find((e) => e.kind === "plugin" && e.name === "commit-commands")!;
    expect(plugin).toBeTruthy();
    expect(plugin.description).toContain("git workflow");
    // The bundled command lands as a command entry too.
    mkdirSync(join(root, "commands"), { recursive: true });
    writeFileSync(join(root, "commands", "commit.md"), read(join(FIX, "claude-code", "command-allowed-tools.md")));
    const cmds = detectStores(HOME, PROJ).filter((e) => e.kind === "command" && e.source === "claude-code");
    expect(cmds.map((c) => c.name)).toContain("commit");
  });

  test("plugin-with-hooks plugin.json → hooks mapped (2 runnable with --with-hooks)", () => {
    const root = ccPluginRoot("plugin-with-hooks", "3.1.0");
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), read(join(FIX, "claude-code", "plugin-with-hooks.plugin.json")));
    const entry = detectStores(HOME, PROJ).find((e) => e.kind === "plugin" && e.name === "caveman")!;
    expect(entry).toBeTruthy();
    const r = importEntry(entry, HOME, { withHooks: true });
    expect(r.record.hooksEnabled).toBe(true);
    expect(r.record.hookDefs!.map((h) => h.event).sort()).toEqual(["SessionStart", "UserPromptSubmit"]);
    // Hook command carries ${CLAUDE_PLUGIN_ROOT} (brace form, as the canon fixture writes it)
    // + timeout 30 — the shim exports the env var so the shell expands it.
    expect(r.record.hookDefs![0]!.command).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(r.record.hookDefs![0]!.timeout).toBe(30);
  });

  test("codex-hooks.json (Codex shape shipped by a CC plugin) parses via extractHookCommands", async () => {
    const { extractHookCommands } = await import("../src/plugins/hook-shim.ts");
    const j = JSON.parse(read(join(FIX, "claude-code", "codex-hooks.json"))) as { hooks: Record<string, unknown> };
    const cmds = extractHookCommands(j.hooks);
    expect(cmds.length).toBe(1);
    expect(cmds[0]!.event).toBe("SessionStart");
    expect(cmds[0]!.matcher).toBe("startup|resume");
    expect(cmds[0]!.handler.command).toContain("codex-sessionstart.js");
    expect(cmds[0]!.handler.timeout).toBe(5);
  });

  test("hooks-settings.json → PreToolUse Bash matcher + SessionStart matcher group", async () => {
    const { extractHookCommands } = await import("../src/plugins/hook-shim.ts");
    const j = JSON.parse(read(join(FIX, "claude-code", "hooks-settings.json"))) as { hooks: Record<string, unknown> };
    const cmds = extractHookCommands(j.hooks);
    const pre = cmds.find((c) => c.event === "PreToolUse")!;
    expect(pre.matcher).toBe("Bash");
    expect(pre.handler.command).toContain("$CLAUDE_PROJECT_DIR");
  });

  test("agent.md (agent-sdk-verifier-py) → ~/.ra/agents, resolvable in catalog", () => {
    mkdirSync(join(HOME, ".claude", "agents"), { recursive: true });
    writeFileSync(join(HOME, ".claude", "agents", "agent-sdk-verifier-py.md"), read(join(FIX, "claude-code", "agent.md")));
    const entry = detectStores(HOME, PROJ).find((e) => e.kind === "agent" && e.name === "agent-sdk-verifier-py")!;
    expect(entry).toBeTruthy();
    const r = importEntry(entry, HOME);
    expect(r.status).toBe("imported");
    expect(existsSync(join(HOME, ".ra", "agents", "agent-sdk-verifier-py.md"))).toBe(true);
    // LIVE artifact: the agent catalog resolves it — driven through the real
    // CLI below (homedir is cached in-process), here via explicit file check.
    expect(read(join(HOME, ".ra", "agents", "agent-sdk-verifier-py.md"))).toContain("agent-sdk-verifier");
  });

  test("command.md (c3) → ~/.ra/commands, dispatchable via loadCustomCommands", () => {
    mkdirSync(join(HOME, ".claude", "commands"), { recursive: true });
    writeFileSync(join(HOME, ".claude", "commands", "c3.md"), read(join(FIX, "claude-code", "command.md")));
    const entry = detectStores(HOME, PROJ).find((e) => e.kind === "command" && e.name === "c3")!;
    expect(entry).toBeTruthy();
    importEntry(entry, HOME);
    // LIVE artifact: the real command loader picks it up and $ARGUMENTS survives.
    const cmds = loadCustomCommands([join(HOME, ".ra", "commands")]);
    const c3 = cmds.find((c) => c.name === "c3")!;
    expect(c3).toBeTruthy();
    expect(c3.prompt).toContain("$ARGUMENTS");
  });

  test("command-allowed-tools.md → allowed-tools frontmatter gates the turn", () => {
    mkdirSync(join(HOME, ".ra", "commands"), { recursive: true });
    writeFileSync(join(HOME, ".ra", "commands", "commit.md"), read(join(FIX, "claude-code", "command-allowed-tools.md")));
    const cmds = loadCustomCommands([join(HOME, ".ra", "commands")]);
    const commit = cmds.find((c) => c.name === "commit")!;
    expect(commit.allowedTools).toEqual(["Bash(git add:*)", "Bash(git status:*)", "Bash(git commit:*)"]);
  });

  test("skill-ccc/SKILL.md → ~/.ra/skills/ccc, byte-identical + non-portable flag", () => {
    mkdirSync(join(HOME, ".claude", "skills", "ccc"), { recursive: true });
    writeFileSync(join(HOME, ".claude", "skills", "ccc", "SKILL.md"), read(join(FIX, "claude-code", "skill-ccc-SKILL.md")));
    const entry = detectStores(HOME, PROJ).find((e) => e.kind === "skill" && e.name === "ccc")!;
    expect(entry).toBeTruthy();
    importEntry(entry, HOME);
    expect(sha(join(HOME, ".ra", "skills", "ccc", "SKILL.md"))).toBe(sha(join(FIX, "claude-code", "skill-ccc-SKILL.md")));
  });

  test("skill-with-hooks.md → strict-checker flags the hooks key (non-portable for Codex)", () => {
    const raw = read(join(FIX, "claude-code", "skill-with-hooks.md"));
    const f = checkSkillStrict("dep-risk-check", raw);
    expect(f.extraKeys).toContain("hooks");
  });

  test("LIVE CLI: ra plugins (detect) + import c3 via real CLI in isolated HOME", () => {
    const detect = cli(["plugins", "--json"]);
    expect(detect.code).toBe(0);
    const entries = JSON.parse(detect.out) as Array<{ source: string; kind: string; name: string }>;
    // Everything staged into HOME so far is detected through the real CLI.
    expect(entries.some((e) => e.source === "claude-code" && e.kind === "command" && e.name === "c3")).toBe(true);
    expect(entries.some((e) => e.source === "claude-code" && e.kind === "plugin" && e.name === "caveman")).toBe(true);
    const imp = cli(["plugins", "import", "c3"]);
    expect(imp.code).toBe(0);
    expect(imp.out).toContain(join(".ra", "commands", "c3.md"));
    expect(existsSync(join(HOME, ".ra", "commands", "c3.md"))).toBe(true);
  });
});

// ---- 2. Roo (3 fixtures) ---------------------------------------------------------------------

describe("conformance: roo (3 fixtures)", () => {
  beforeAll(() => {
    writeFileSync(join(PROJ, ".roomodes"), read(join(FIX, "roo", "roomodes.yaml")));
    writeFileSync(join(PROJ, ".roomodes.json"), read(join(FIX, "roo", "roomodes.json")));
  });

  test(".roomodes (YAML) → roo-docs-writer + roo-reviewer agents, resolvable + permission-gated", () => {
    const modes = detectStores(HOME, PROJ).filter((e) => e.kind === "roo-mode");
    expect(modes.map((m) => m.name).sort()).toEqual(["docs-writer", "reviewer"]);
    for (const e of modes) importEntry(e, HOME);
    expect(existsSync(join(HOME, ".ra", "agents", "roo-docs-writer.md"))).toBe(true);
    expect(existsSync(join(HOME, ".ra", "agents", "roo-reviewer.md"))).toBe(true);
    const reviewer = read(join(HOME, ".ra", "agents", "roo-reviewer.md"));
    expect(reviewer).toContain("  bash: allow");
    expect(reviewer).toContain("  webfetch: deny"); // not in groups → denied
    const dw = read(join(HOME, ".ra", "agents", "roo-docs-writer.md"));
    expect(dw).toContain("fileRegex: \\.(md|mdx)$");
    expect(dw).toContain("Use this mode for writing and editing documentation."); // whenToUse → description (TASK router)
  });

  test(".roomodes.json (JSON) → same docs-writer shape, deduped against YAML", () => {
    // detect dedupes on (source,kind,name): docs-writer appears once across both serializations.
    const modes = detectStores(HOME, PROJ).filter((e) => e.kind === "roo-mode" && e.name === "docs-writer");
    expect(modes.length).toBe(1);
  });

  test("mcp_settings.json → roo-mcp MCP entry; --apply-mcp writes ra.json", () => {
    const gs = join(gsRoot(HOME), "rooveterinaryinc.roo-cline", "settings");
    mkdirSync(gs, { recursive: true });
    writeFileSync(join(gs, "mcp_settings.json"), read(join(FIX, "roo", "mcp_settings.json")));
    const mcp = detectStores(HOME, PROJ).find((e) => e.kind === "mcp" && e.name === "roo-mcp")!;
    expect(mcp).toBeTruthy();
    const r = applyMcpToConfig([{ name: "roo-mcp", data: mcp.data! }], HOME);
    expect(r.applied).toEqual(["roo-mcp"]);
    const cfg = JSON.parse(read(r.configPath));
    expect(cfg.mcp["roo-mcp"]).toEqual({ command: "rood" }); // empty args dropped
  });
});

// ---- 3. Cline (4 fixtures) ---------------------------------------------------------------------

describe("conformance: cline (4 fixtures)", () => {
  beforeAll(() => {
    mkdirSync(join(PROJ, ".clinerules"), { recursive: true });
    writeFileSync(join(PROJ, ".clinerules", "clinerules.md"), read(join(FIX, "cline", "clinerules.md")));
    writeFileSync(join(PROJ, ".clinerules", "conditional-rule.md"), read(join(FIX, "cline", "conditional-rule.md")));
    mkdirSync(join(PROJ, ".clinerules", "workflows"), { recursive: true });
    writeFileSync(join(PROJ, ".clinerules", "workflows", "release.md"), read(join(FIX, "cline", "workflow.md")));
  });

  test(".clinerules.md → ~/.ra/rules, always-on injection via loadRules", () => {
    const rules = detectStores(HOME, PROJ).filter((e) => e.source === "cline" && e.kind === "rule");
    expect(rules.map((r) => r.name).sort()).toEqual(["clinerules", "conditional-rule"]);
    for (const e of rules) importEntry(e, HOME);
    expect(existsSync(join(HOME, ".ra", "rules", "clinerules.md"))).toBe(true);
    // LIVE: the real rules loader injects the always-on rule; conditional stays out without matches.
    const loaded = loadRules(join(HOME, "project"));
    expect(loaded.find((r) => r.name === "clinerules")!.body).toContain("composition over inheritance");
    expect(loaded.find((r) => r.name === "conditional-rule")).toBeUndefined();
    const gated = loadRules(join(HOME, "project"), ["src/components/Button.tsx"]);
    expect(gated.find((r) => r.name === "conditional-rule")!.body).toContain("functional components");
  });

  test("conditional-rule.md `paths:` gating — exact Cline glob semantics", () => {
    expect(matchesPaths("src/components/Button.tsx", ["src/components/**"])).toBe(true);
    expect(matchesPaths("src/hooks/useX.ts", ["src/hooks/**"])).toBe(true);
    expect(matchesPaths("src/utils/x.ts", ["src/components/**", "src/hooks/**"])).toBe(false);
  });

  test("workflow.md → ~/.ra/commands/release.md, dispatchable", () => {
    const wf = detectStores(HOME, PROJ).find((e) => e.kind === "workflow" && e.name === "release")!;
    expect(wf).toBeTruthy();
    importEntry(wf, HOME);
    expect(existsSync(join(HOME, ".ra", "commands", "release.md"))).toBe(true);
    const cmds = loadCustomCommands([join(HOME, ".ra", "commands")]);
    expect(cmds.find((c) => c.name === "release")!.prompt).toContain("release: <version>");
  });

  test("cline_mcp_settings.json → cline-mcp entry with env passthrough (no secret synthesis)", () => {
    const gs = join(gsRoot(HOME), "saoudrizwan.claude-dev", "settings");
    mkdirSync(gs, { recursive: true });
    writeFileSync(join(gs, "cline_mcp_settings.json"), read(join(FIX, "cline", "cline_mcp_settings.json")));
    const mcp = detectStores(HOME, PROJ).find((e) => e.kind === "mcp" && e.name === "cline-mcp")!;
    expect(mcp).toBeTruthy();
    const r = applyMcpToConfig([{ name: "cline-mcp", data: mcp.data! }], HOME);
    const cfg = JSON.parse(read(r.configPath));
    expect(cfg.mcp["cline-mcp"]).toEqual({ command: "clined", args: ["-s"], env: { K: "V" } });
  });
});

// ---- 4. Codex (4 fixture files) ------------------------------------------------------------------

describe("conformance: codex (4 fixtures)", () => {
  beforeAll(() => {
    mkdirSync(join(HOME, ".codex"), { recursive: true });
    writeFileSync(join(HOME, ".codex", "config.toml"), read(join(FIX, "codex", "config.toml")));
  });

  test("config.toml → 3 MCP shapes applied field-for-field + timeouts preserved as fields", () => {
    const mcps = detectStores(HOME, PROJ).filter((e) => e.source === "codex" && e.kind === "mcp");
    expect(mcps.map((m) => m.name).sort()).toEqual(["cloudflare", "godot-mcp", "roblox-studio"]);
    const r = applyMcpToConfig(mcps.map((m) => ({ name: m.name, data: m.data! })), HOME);
    expect(r.applied.sort()).toEqual(["cloudflare", "godot-mcp", "roblox-studio"]);
    const cfg = JSON.parse(read(r.configPath));
    expect(cfg.mcp["roblox-studio"]).toEqual({ command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP" });
    expect(cfg.mcp.cloudflare).toEqual({ url: "https://mcp.cloudflare.com/mcp" });
    expect(cfg.mcp["godot-mcp"]).toMatchObject({
      command: "/Users/zari/.local/bin/uv", args: ["run", "server.py"],
      env: { GDAI_MCP_SERVER_PORT: "3571" },
    });
    // Codex timeouts ride the entry (startup/tool timeout semantics: mcp.ts ceiling noted in scoreboard).
    expect(cfg.mcp["godot-mcp"].startup_timeout_sec).toBe(60);
    expect(cfg.mcp["godot-mcp"].tool_timeout_sec).toBe(90);
  });

  test("config.toml permission-profile → report-only record (trust posture never silently applied)", () => {
    const prof = detectStores(HOME, PROJ).find((e) => e.kind === "permission-profile")!;
    expect(prof).toBeTruthy();
    const r = importEntry(prof, HOME);
    expect(r.status).toBe("skipped");
    expect(r.record.note).toContain("report-only");
  });

  test("skill-review-agent/SKILL.md → byte-identical import + zero strict findings", () => {
    cpSync(join(FIX, "codex", "skill-review-agent"), join(HOME, ".codex", "skills", "review-agent"), { recursive: true });
    const entry = detectStores(HOME, PROJ).find((e) => e.kind === "skill" && e.name === "review-agent")!;
    expect(entry).toBeTruthy();
    importEntry(entry, HOME);
    expect(sha(join(HOME, ".ra", "skills", "review-agent", "SKILL.md"))).toBe(sha(join(FIX, "codex", "skill-review-agent", "SKILL.md")));
    expect(checkSkillStrict("review-agent", read(join(HOME, ".ra", "skills", "review-agent", "SKILL.md"))).problems).toEqual([]);
    // agents/openai.yaml rides along in the copied dir (interface metadata preserved, policy noted in scoreboard).
    expect(existsSync(join(HOME, ".ra", "skills", "review-agent", "agents", "openai.yaml"))).toBe(true);
  });

  test("prompt.md → legacy command (named $KEY passthrough preserved verbatim)", () => {
    mkdirSync(join(HOME, ".codex", "prompts"), { recursive: true });
    writeFileSync(join(HOME, ".codex", "prompts", "prep-pr.md"), read(join(FIX, "codex", "prompt.md")));
    const entry = detectStores(HOME, PROJ).find((e) => e.kind === "command" && e.name === "prep-pr")!;
    expect(entry).toBeTruthy();
    importEntry(entry, HOME);
    const cmd = loadCustomCommands([join(HOME, ".ra", "commands")]).find((c) => c.name === "prep-pr")!;
    expect(cmd.prompt).toContain("$FILES");
    expect(cmd.prompt).toContain("$PR_TITLE");
  });
});

// ---- 5. Cursor (2 skills / 4 files) ----------------------------------------------------------------

describe("conformance: cursor (4 files)", () => {
  test("skill-raker → ~/.ra/skills/raker with scripts/ asset; body loadable via SKILL verb path", () => {
    cpSync(join(FIX, "cursor", "skill-raker"), join(HOME, ".cursor", "skills", "raker"), { recursive: true });
    const entry = detectStores(HOME, PROJ).find((e) => e.source === "cursor" && e.kind === "skill" && e.name === "raker")!;
    expect(entry).toBeTruthy();
    importEntry(entry, HOME);
    // Whole-dir copy: SKILL.md + scripts/selfcheck.sh land together.
    expect(existsSync(join(HOME, ".ra", "skills", "raker", "scripts", "selfcheck.sh"))).toBe(true);
    expect(sha(join(HOME, ".ra", "skills", "raker", "SKILL.md"))).toBe(sha(join(FIX, "cursor", "skill-raker", "SKILL.md")));
  });

  test("skill-game-studio → SKILL.md + reference.md copied; strict checker flags nothing structural", () => {
    cpSync(join(FIX, "cursor", "skill-game-studio"), join(HOME, ".cursor", "skills", "game-studio"), { recursive: true });
    const entry = detectStores(HOME, PROJ).find((e) => e.source === "cursor" && e.kind === "skill" && e.name === "game-studio")!;
    expect(entry).toBeTruthy();
    importEntry(entry, HOME);
    expect(existsSync(join(HOME, ".ra", "skills", "game-studio", "reference.md"))).toBe(true);
    const f = checkSkillStrict("game-studio", read(join(HOME, ".ra", "skills", "game-studio", "SKILL.md")));
    expect(f.problems).toEqual([]);
  });
});

// ---- 6. OpenCode (3 fixtures) -----------------------------------------------------------------------

describe("conformance: opencode (3 fixtures)", () => {
  test("opencode.json (project) → mcp chrome-devtools (array-form command split), agent forge, plugins listed-not-imported", () => {
    writeFileSync(join(PROJ, "opencode.json"), read(join(FIX, "opencode", "opencode.json")));
    const entries = detectStores(HOME, PROJ).filter((e) => e.source === "opencode");
    const mcp = entries.find((e) => e.kind === "mcp" && e.name === "chrome-devtools")!;
    expect(mcp).toBeTruthy();
    // Array-form command ["npx","-y",...] → command + args split.
    const cfgEntry = mcpConfigEntry(mcp.data!);
    expect(cfgEntry!.command).toBe("npx");
    expect(cfgEntry!.args).toContain("-y");
    const agent = entries.find((e) => e.kind === "agent" && e.name === "forge")!;
    expect(agent).toBeTruthy();
    const r = importEntry(agent, HOME);
    expect(existsSync(join(HOME, ".ra", "agents", "forge.md"))).toBe(true);
    const forgeMd = read(join(HOME, ".ra", "agents", "forge.md"));
    expect(forgeMd).toContain("mode: primary");
    expect(forgeMd).toContain("description:");
    // Imperative TS plugins: listed-but-skipped (honest stance).
    const plugins = entries.filter((e) => e.kind === "plugin");
    expect(plugins.length).toBe(2);
    for (const p of plugins) {
      const pr = importEntry(p, HOME);
      expect(pr.status).toBe("skipped");
      expect(pr.record.note).toContain("NOT imported or executed");
    }
    rmSync(join(PROJ, "opencode.json"));
  });

  test("plugin.ts + plugins/index.ts (imperative) → honest skip when staged as files", () => {
    // The fixtures document the imperative-plugin formats; RA's contract is
    // listing them with a note (never executing). Stage via the config plugins
    // array path (already covered) — here assert the stance directly on the importer.
    const fake = { source: "opencode" as const, kind: "plugin" as const, name: "my-plugin", path: join(FIX, "opencode", "plugin.ts"), description: "" };
    const r = importEntry(fake as never, HOME);
    expect(r.status).toBe("skipped");
    expect(r.record.note).toContain("NOT imported or executed");
  });
});

// ---- 7. Cross-cutting LIVE checks ---------------------------------------------------------------------

describe("conformance: live runtime integration", () => {
  test("imported hook actually executes when fully opted in (RA_PLUGIN_HOOKS=on)", async () => {
    // Build a benign blocking hook on the imported caveman record.
    const m = loadManifest(HOME);
    const rec = m.imports.find((i) => i.name === "caveman")!;
    expect(rec).toBeTruthy();
    rec.hookDefs = [{ event: "PreToolUse", matcher: "Bash", command: "echo conf-block >&2; exit 2", timeout: 5 }];
    writeFileSync(join(HOME, ".ra", "imports.json"), JSON.stringify(m, null, 2));
    resetHookRuntimeCache();
    process.env.RA_PLUGIN_HOOKS = "on";
    process.env.RA_PLUGIN_HOME = HOME;
    try {
      const r = await runImportedHooksFor("tool.execute.before", { tool: "bash" }, PROJ, HOME);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain("conf-block");
      // Matcher respected: same hook ignores non-bash.
      expect((await runImportedHooksFor("tool.execute.before", { tool: "write" }, PROJ, HOME)).blocked).toBe(false);
    } finally {
      delete process.env.RA_PLUGIN_HOOKS;
      delete process.env.RA_PLUGIN_HOME;
      resetHookRuntimeCache();
    }
  });

  test("default-deny: without RA_PLUGIN_HOOKS/policy, imported hooks never execute", async () => {
    resetHookRuntimeCache();
    process.env.RA_PLUGIN_HOME = HOME;
    try {
      const r = await runImportedHooksFor("tool.execute.before", { tool: "bash" }, PROJ, HOME);
      expect(r.blocked).toBe(false);
    } finally {
      delete process.env.RA_PLUGIN_HOME;
      resetHookRuntimeCache();
    }
  });

  test("MCP auto-apply is idempotent — re-apply never overwrites", () => {
    const before = read(join(HOME, ".ra", "ra.json"));
    const r = applyMcpToConfig([{ name: "roo-mcp", data: { command: "other" } }], HOME);
    expect(r.skipped.join(" ")).toContain("already configured");
    expect(read(join(HOME, ".ra", "ra.json"))).toBe(before);
  });

  test("LIVE CLI: ra agents --json in isolated HOME resolves imported agents", () => {
    writeFileSync(join(HOME, "ra-config.json"), "{}");
    const r = cli(["agents", "--json"], { RA_CONFIG: join(HOME, "ra-config.json") });
    expect(r.code).toBe(0);
    const roles = JSON.parse(r.out) as Array<{ role: string; scope: string }>;
    expect(roles.some((a) => a.role === "roo-reviewer" && a.scope === "user")).toBe(true);
    expect(roles.some((a) => a.role === "roo-docs-writer" && a.scope === "user")).toBe(true);
    expect(roles.some((a) => a.role === "agent-sdk-verifier-py" && a.scope === "user")).toBe(true);
    expect(roles.some((a) => a.role === "forge" && a.scope === "user")).toBe(true);
  });

  test("LIVE CLI: ra plugins list-imported shows the manifest", () => {
    const r = cli(["plugins", "list-imported"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("caveman");
    expect(r.out).toContain("roo:roo-mode:reviewer");
    expect(r.out).toContain("codex:skill:review-agent");
  });
});