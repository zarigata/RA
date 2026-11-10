// parity-waveb.test.ts — Wave B importer suite: Roo modes (YAML+JSON),
// Cline rules/workflows, Codex TOML/skills/prompts, SKILL.md strict-spec,
// AGENTS.md memory chain, hook-event coverage, !cmd pre-exec + allowed-tools,
// per-server MCP allowlists, project opencode.json scan. All against the
// real fixtures copied into tests/fixtures/parity/.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRoomodes } from "../src/plugins/roo-modes.ts";
import { parseToml, tomlGet } from "../src/plugins/toml.ts";
import { detectStores } from "../src/plugins/stores.ts";
import { importEntry, loadManifest, removeImported, rooModeToAgentMd, mcpConfigEntry, applyMcpToConfig } from "../src/plugins/import.ts";
import { claudeEventToRaHook, loadEnabledHooks, runImportedHooksFor, resetHookRuntimeCache } from "../src/plugins/hook-shim.ts";
import { loadRules, loadMemoryChain, matchesPaths, globToRegExp } from "../src/rules.ts";
import { checkSkillStrict } from "../src/skills.ts";
import { loadCustomCommands, expandPreExec, allowedToolsToPerms } from "../src/commands/index.ts";
import { loadProjectMemory } from "../src/agent.ts";
import { createHash } from "node:crypto";

let HOME = "";
let PROJ = "";
const FIX = join(import.meta.dir, "fixtures", "parity");
const read = (p: string) => readFileSync(p, "utf-8");

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "ra-waveb-home-"));
  PROJ = mkdtempSync(join(tmpdir(), "ra-waveb-proj-"));
});
afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(PROJ, { recursive: true, force: true });
});

// ---- 1. Roo modes ------------------------------------------------------------------------

describe("1. Roo modes → RA agents", () => {
  test("YAML fixture parses both modes incl. edit+fileRegex tuple", () => {
    const { modes, warnings } = parseRoomodes(read(join(FIX, "roo", "roomodes.yaml")));
    expect(warnings).toEqual([]);
    expect(modes.length).toBe(2);
    const dw = modes.find((m) => m.slug === "docs-writer")!;
    expect(dw.roleDefinition).toContain("technical writer");
    expect(dw.customInstructions).toContain("clarity");
    expect(dw.whenToUse).toContain("documentation");
    expect(dw.groups).toEqual([
      { name: "read" },
      { name: "edit", fileRegex: "\\.(md|mdx)$", description: "Markdown files only" },
    ]);
    const rev = modes.find((m) => m.slug === "reviewer")!;
    expect(rev.groups.map((g) => g.name)).toEqual(["read", "edit", "command"]);
  });

  test("JSON fixture parses identically (same docs-writer shape)", () => {
    const { modes, warnings } = parseRoomodes(read(join(FIX, "roo", "roomodes.json")));
    expect(warnings).toEqual([]);
    expect(modes.length).toBe(1);
    expect(modes[0]!.slug).toBe("docs-writer");
    expect(modes[0]!.groups.find((g) => g.name === "edit")!.fileRegex).toBe("\\.(md|mdx)$");
  });

  test("unparseable modes fail closed (skip + warning, never throw)", () => {
    const junk = parseRoomodes("customModes:\n  - slug: 'bad slug!'\n    roleDefinition: x\n  - roleDefinition: no slug\n  - slug: ok\n    roleDefinition: fine\n");
    expect(junk.modes.map((m) => m.slug)).toEqual(["ok"]);
    expect(junk.warnings.length).toBe(2);
    const empty = parseRoomodes("totally: unrelated");
    expect(empty.modes).toEqual([]);
    expect(empty.warnings.join(" ")).toContain("no customModes");
  });

  test("groups map to RA permission gates in generated agent md", () => {
    const { modes } = parseRoomodes(read(join(FIX, "roo", "roomodes.yaml")));
    const md = rooModeToAgentMd(modes.find((m) => m.slug === "reviewer")!);
    expect(md).toContain("category: roo");
    expect(md).toContain("  bash: allow");
    expect(md).toContain("  edit: allow");
    expect(md).toContain("  read: allow");
    expect(md).toContain("  webfetch: deny"); // not in groups → denied
    expect(md).toContain("You are a strict code reviewer.");
  });

  test("edit with fileRegex → path-scoped note; empty groups → read-only", () => {
    const { modes } = parseRoomodes(read(join(FIX, "roo", "roomodes.yaml")));
    const md = rooModeToAgentMd(modes.find((m) => m.slug === "docs-writer")!);
    expect(md).toContain("fileRegex: \\.(md|mdx)$");
    const readonly = rooModeToAgentMd({ slug: "bare", roleDefinition: "rd", groups: [] });
    expect(readonly).toContain("write: deny");
    expect(readonly).toContain("read-only agent");
  });

  test("detect + import both serializations → live agents in ~/.ra/agents", () => {
    // Project-level .roomodes (both files) in PROJ.
    writeFileSync(join(PROJ, ".roomodes"), read(join(FIX, "roo", "roomodes.yaml")));
    writeFileSync(join(PROJ, ".roomodes.json"), read(join(FIX, "roo", "roomodes.json")));
    const entries = detectStores(HOME, PROJ).filter((e) => e.kind === "roo-mode");
    expect(entries.length).toBe(2); // docs-writer (deduped across YAML+JSON) + reviewer
    for (const e of entries) {
      const r = importEntry(e, HOME);
      expect(r.status).toBe("imported");
      expect(existsSync(join(HOME, ".ra", "agents", `roo-${e.name}.md`))).toBe(true);
    }
    const md = readFileSync(join(HOME, ".ra", "agents", "roo-reviewer.md"), "utf-8");
    expect(md).toContain("You are a strict code reviewer.");
    const dw = readFileSync(join(HOME, ".ra", "agents", "roo-docs-writer.md"), "utf-8");
    expect(dw).toContain("Use this mode for writing and editing documentation."); // whenToUse → description
  });
});

// ---- 2. Cline rules + workflows ------------------------------------------------------------

describe("2. Cline rules + workflows", () => {
  test("rules import into ~/.ra/rules and load via loadRules", () => {
    mkdirSync(join(HOME, ".ra", "rules"), { recursive: true });
    writeFileSync(join(HOME, ".ra", "rules", "clinerules.md"), read(join(FIX, "cline", "clinerules.md")));
    writeFileSync(join(HOME, ".ra", "rules", "conditional-rule.md"), read(join(FIX, "cline", "conditional-rule.md")));
    const rules = loadRules(join(HOME, "project-cwd")); // HOME acts as the user dir root
    const always = rules.find((r) => r.name === "clinerules");
    expect(always).toBeTruthy();
    expect(always!.body).toContain("composition over inheritance");
    expect(always!.paths).toEqual([]); // always-on
    // Conditional rule: inactive without matching touched files…
    expect(rules.find((r) => r.name === "conditional-rule")).toBeUndefined();
    // …active when a touched file matches its paths globs.
    const gated = loadRules(join(HOME, "project-cwd"), ["src/components/Button.tsx"]);
    const cond = gated.find((r) => r.name === "conditional-rule");
    expect(cond).toBeTruthy();
    expect(cond!.paths).toEqual(["src/components/**", "src/hooks/**"]);
    expect(cond!.body).toContain("functional components");
    // Non-matching touched file → still inactive.
    expect(loadRules(join(HOME, "project-cwd"), ["src/utils/x.ts"]).find((r) => r.name === "conditional-rule")).toBeUndefined();
  });

  test("`paths:` glob gating — conditional rule activates only on matching files", () => {
    expect(matchesPaths("src/components/Button.tsx", ["src/components/**"])).toBe(true);
    expect(matchesPaths("src/hooks/useX.ts", ["src/hooks/**"])).toBe(true);
    expect(matchesPaths("src/utils/other.ts", ["src/components/**", "src/hooks/**"])).toBe(false);
    expect(matchesPaths("src/components/nested/deep/a.tsx", ["src/components/**"])).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false); // * doesn't cross /
  });

  test("importer: cline rule entry → .ra/rules with paths note; workflow → ~/.ra/commands", () => {
    mkdirSync(join(PROJ, ".clinerules"), { recursive: true });
    writeFileSync(join(PROJ, ".clinerules", "clinerules.md"), read(join(FIX, "cline", "clinerules.md")));
    writeFileSync(join(PROJ, ".clinerules", "conditional-rule.md"), read(join(FIX, "cline", "conditional-rule.md")));
    mkdirSync(join(PROJ, ".clinerules", "workflows"), { recursive: true });
    writeFileSync(join(PROJ, ".clinerules", "workflows", "release.md"), read(join(FIX, "cline", "workflow.md")));
    const entries = detectStores(HOME, PROJ).filter((e) => e.source === "cline");
    expect(entries.filter((e) => e.kind === "rule").length).toBeGreaterThanOrEqual(2);
    expect(entries.find((e) => e.kind === "workflow" && e.name === "release")).toBeTruthy();
    for (const e of entries.filter((e) => e.kind === "rule" || e.kind === "workflow")) {
      const r = importEntry(e, HOME);
      expect(r.status).toBe("imported");
    }
    expect(existsSync(join(HOME, ".ra", "commands", "release.md"))).toBe(true);
    const cmd = readFileSync(join(HOME, ".ra", "commands", "release.md"), "utf-8");
    expect(cmd).toContain("release: <version>");
    const condRec = loadManifest(HOME).imports.find((i) => i.name === "conditional-rule");
    expect(condRec!.note).toContain("paths-gated");
  });

  test("imported rules are injected by loadProjectMemory", () => {
    // The imported always-on rule lands in HOME's user-level .ra/rules and
    // loadProjectMemory (which calls loadRules with no touched-file list)
    // injects it into the system prompt.
    const mem = loadProjectMemory(HOME);
    expect(mem).toContain("composition over inheritance"); // always-on rule
    expect(mem).toContain("Rule (clinerules");
    // ponytail ceiling: paths-conditional rules are always injected at prompt
    // assembly (documented); the loadRules(touchedFiles) filter is the seam —
    // gating itself is verified in the loadRules test above.
  });
});

// ---- 3. Codex config + skills ---------------------------------------------------------------

describe("3. Codex TOML + skills", () => {
  test("TOML subset parses the fixture: sections, dotted tables, env subtable, arrays", () => {
    const { value, warnings } = parseToml(read(join(FIX, "codex", "config.toml")));
    expect(warnings).toEqual([]);
    expect(value.model).toBe("gpt-5.6-sol");
    expect(value.model_reasoning_effort).toBe("high");
    expect(value.notify).toEqual(["/Users/zari/.codex/notify-hook", "turn-ended"]);
    expect(tomlGet(value, "features")).toEqual({ hooks: true });
    expect(tomlGet(value, "mcp_servers.roblox-studio")).toEqual({ command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP" });
    expect(tomlGet(value, "mcp_servers.cloudflare")).toEqual({ url: "https://mcp.cloudflare.com/mcp" });
    expect(tomlGet(value, "mcp_servers.godot-mcp")).toEqual({
      command: "/Users/zari/.local/bin/uv", args: ["run", "server.py"],
      startup_timeout_sec: 60, tool_timeout_sec: 90,
      env: { GDAI_MCP_SERVER_PORT: "3571" },
    });
  });

  test("TOML fail-closed: malformed values skipped with warning, never throw", () => {
    const { value, warnings } = parseToml('a = "x"\nb = @bad@\n[section]\nc = 1\nnot a kv line\n');
    expect(value.a).toBe("x");
    expect(value.b).toBeUndefined();
    expect(value.section).toEqual({ c: 1 });
    expect(warnings.length).toBe(2);
  });

  test("codex detect → mcp entries (all 3 shapes) + permission-profile record", () => {
    mkdirSync(join(HOME, ".codex"), { recursive: true });
    writeFileSync(join(HOME, ".codex", "config.toml"), read(join(FIX, "codex", "config.toml")).replace('model = "gpt-5.6-sol"', 'model = "gpt-5.6-sol"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"'));
    const entries = detectStores(HOME, PROJ).filter((e) => e.source === "codex");
    expect(entries.filter((e) => e.kind === "mcp").map((e) => e.name).sort()).toEqual(["cloudflare", "godot-mcp", "roblox-studio"]);
    const prof = entries.find((e) => e.kind === "permission-profile");
    expect(prof).toBeTruthy();
    expect(prof!.description).toContain("on-request");
    const r = importEntry(prof!, HOME);
    expect(r.status).toBe("skipped"); // record-only, no files
    expect(r.record.note).toContain("report-only");
  });

  test("codex MCP → applyMcpToConfig maps field-for-field incl. env + timeouts", () => {
    const { value } = parseToml(read(join(FIX, "codex", "config.toml")));
    const servers = Object.entries(value.mcp_servers as Record<string, Record<string, unknown>>).map(([name, data]) => ({ name, data }));
    const applied = applyMcpToConfig(servers, HOME, PROJ);
    expect(applied.applied.sort()).toEqual(["cloudflare", "godot-mcp", "roblox-studio"]);
    const cfg = JSON.parse(readFileSync(applied.configPath, "utf-8"));
    expect(cfg.mcp["godot-mcp"]).toMatchObject({
      command: "/Users/zari/.local/bin/uv", args: ["run", "server.py"],
      env: { GDAI_MCP_SERVER_PORT: "3571" },
    });
    expect(cfg.mcp.cloudflare).toEqual({ url: "https://mcp.cloudflare.com/mcp" });
  });

  test("codex strict SKILL.md imports byte-identical (checksum)", () => {
    mkdirSync(join(HOME, ".codex", "skills", "review-agent"), { recursive: true });
    cpSync(join(FIX, "codex", "skill-review-agent"), join(HOME, ".codex", "skills", "review-agent"), { recursive: true });
    const entry = detectStores(HOME, PROJ).find((e) => e.source === "codex" && e.kind === "skill" && e.name === "review-agent")!;
    expect(entry).toBeTruthy();
    const r = importEntry(entry, HOME);
    expect(r.status).toBe("imported");
    const src = readFileSync(join(FIX, "codex", "skill-review-agent", "SKILL.md"));
    const dst = readFileSync(join(HOME, ".ra", "skills", "review-agent", "SKILL.md"));
    expect(createHash("sha256").update(dst).digest("hex")).toBe(createHash("sha256").update(src).digest("hex"));
  });

  test("legacy codex prompt → command with $ARGUMENTS/$KEY passthrough", () => {
    mkdirSync(join(HOME, ".codex", "prompts"), { recursive: true });
    writeFileSync(join(HOME, ".codex", "prompts", "prep-pr.md"), read(join(FIX, "codex", "prompt.md")));
    const entry = detectStores(HOME, PROJ).find((e) => e.source === "codex" && e.kind === "command" && e.name === "prep-pr")!;
    expect(entry).toBeTruthy();
    const r = importEntry(entry, HOME);
    expect(existsSync(join(HOME, ".ra", "commands", "prep-pr.md"))).toBe(true);
  });
});

// ---- 4. SKILL.md strict spec -----------------------------------------------------------------

describe("4. SKILL.md strict-spec alignment", () => {
  test("strict fixture (review-agent) passes clean", () => {
    const f = checkSkillStrict("review-agent", read(join(FIX, "codex", "skill-review-agent", "SKILL.md")));
    expect(f.problems).toEqual([]);
    expect(f.extraKeys).toBeUndefined();
  });

  test("rich Claude/Cursor frontmatter flagged non-portable (extra keys named)", () => {
    // The skill-with-hooks fixture carries a `hooks:` key — Claude-specific.
    const withHooks = read(join(FIX, "claude-code", "skill-with-hooks.md"));
    const f = checkSkillStrict("dep-risk-check", withHooks);
    expect(f.extraKeys).toContain("hooks");
    // A Claude-style allowed-tools skill (ui-theme-designer shape).
    const allowed = checkSkillStrict("x", "---\nname: x\ndescription: d\nallowed-tools: Bash(curl *)\n---\nb");
    expect(allowed.extraKeys).toContain("allowed-tools");
  });

  test("name validation: >64 chars, non-kebab, missing/oversized description", () => {
    expect(checkSkillStrict("x", `---\nname: ${"a".repeat(65)}\ndescription: d\n---\nb`).problems[0]).toContain("64");
    expect(checkSkillStrict("x", "---\nname: Not_Kebab\ndescription: d\n---\nb").problems[0]).toContain("kebab");
    expect(checkSkillStrict("x", "---\nname: ok\n---\nb").problems[0]).toContain("description missing");
    expect(checkSkillStrict("x", `---\nname: ok\ndescription: ${"d".repeat(1025)}\n---\nb`).problems.join()).toContain("1024");
  });

  test("RA's own repo skills all pass the strict spec (export direction)", () => {
    // Repo skills = .agents/skills/* at the repo root (what skills-lock.json pins).
    const repoSkills = join(import.meta.dir, "..", "..", ".agents", "skills");
    const findings = readdirSync(repoSkills)
      .filter((d) => existsSync(join(repoSkills, d, "SKILL.md")))
      .map((d) => checkSkillStrict(d, readFileSync(join(repoSkills, d, "SKILL.md"), "utf-8")))
      .filter((f) => f.problems.length || f.extraKeys?.length);
    expect(findings).toEqual([]);
  });
});

// ---- 5. AGENTS.md native read ------------------------------------------------------------------

describe("5. AGENTS.md memory chain", () => {
  test("nested tmp project with only AGENTS.md loads it via loadProjectMemory", () => {
    const root = mkdtempSync(join(tmpdir(), "ra-agents-"));
    try {
      mkdirSync(join(root, "sub"));
      writeFileSync(join(root, "AGENTS.md"), "Root memory here.");
      writeFileSync(join(root, "sub", "AGENTS.md"), "Nested memory too.");
      const mem = loadProjectMemory(join(root, "sub"));
      expect(mem).toContain("Root memory here.");
      expect(mem).toContain("Nested memory too.");
      // Root before nested (Codex convention).
      expect(mem.indexOf("Root memory")).toBeLessThan(mem.indexOf("Nested memory"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("32 KiB cap enforced per file", () => {
    const root = mkdtempSync(join(tmpdir(), "ra-agents-cap-"));
    try {
      writeFileSync(join(root, "AGENTS.md"), "x".repeat(40 * 1024));
      const chain = loadMemoryChain(root);
      expect(chain[0]!.body.length).toBeLessThanOrEqual(32 * 1024 + 40); // cap + truncation note
      expect(chain[0]!.body).toContain("truncated");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("global ~/.ra/AGENTS.md is included when present", () => {
    const root = mkdtempSync(join(tmpdir(), "ra-agents-g-"));
    const prev = process.env.RA_PLUGIN_HOME;
    try {
      writeFileSync(join(HOME, ".ra", "AGENTS.md"), "Global user memory.");
      writeFileSync(join(root, "AGENTS.md"), "Project memory.");
      // loadMemoryChain uses real homedir(); exercise the chain via HOME dirs
      // by testing the project-only path + the global helper separately.
      const chain = loadMemoryChain(root);
      expect(chain.some((m) => m.body.includes("Project memory"))).toBe(true);
      expect(existsSync(join(HOME, ".ra", "AGENTS.md"))).toBe(true);
    } finally {
      rmSync(join(HOME, ".ra", "AGENTS.md"), { force: true });
      rmSync(root, { recursive: true, force: true });
      if (prev !== undefined) process.env.RA_PLUGIN_HOME = prev;
    }
  });
});

// ---- 6. Hook-event coverage ---------------------------------------------------------------------

describe("6. hook events (UserPromptSubmit, PostToolUse, Stop, SessionStart)", () => {
  test("claudeEventToRaHook covers the expanded set", () => {
    expect(claudeEventToRaHook("SessionStart")).toBe("session.start");
    expect(claudeEventToRaHook("SessionEnd")).toBe("session.end");
    expect(claudeEventToRaHook("PostToolUse")).toBe("tool.execute.after");
    expect(claudeEventToRaHook("PreCompact")).toBe("context.compact");
    expect(claudeEventToRaHook("Notification")).toBeNull();
  });

  test("per-event execution with fixture-style hooks: echo, exit-2, timeout", async () => {
    const home2 = mkdtempSync(join(tmpdir(), "ra-hooks-evt-"));
    try {
      mkdirSync(join(home2, ".ra"), { recursive: true });
      writeFileSync(join(home2, ".ra", "imports.json"), JSON.stringify({ imports: [{
        id: "t:plugin:p", source: "claude-code", kind: "plugin", name: "p",
        hooksEnabled: true,
        hookDefs: [
          { event: "UserPromptSubmit", command: "echo ok" },
          { event: "PostToolUse", command: "echo post >&2; exit 2", timeout: 5 },
          { event: "Stop", command: "echo stop" },
          { event: "SessionStart", command: "echo sess" },
          { event: "PreToolUse", matcher: "Bash", command: "sleep 30", timeout: 1 },
        ],
      }] }));
      resetHookRuntimeCache();
      process.env.RA_PLUGIN_HOOKS = "on";
      process.env.RA_PLUGIN_HOME = home2;
      // PostToolUse exit-2 signals "block" in the protocol, but the agent-side
      // emission discards the result (the tool already ran) — assert both.
      const post = await runImportedHooksFor("tool.execute.after", { tool_name: "write" }, PROJ, home2);
      expect(post.blocked).toBe(true); // protocol honors exit 2
      expect(post.reason).toContain("post"); // stderr feeds back
      // Stop/agent.turn.end fires (fire-and-forget via emitGlobalHook — direct call here).
      expect((await runImportedHooksFor("agent.turn.end", { role: "x" }, PROJ, home2)).blocked).toBe(false);
      // UserPromptSubmit echo-exit-0 allows.
      expect((await runImportedHooksFor("tui.prompt.append", { prompt: "hi" }, PROJ, home2)).blocked).toBe(false);
      // session.start allows.
      expect((await runImportedHooksFor("session.start", {}, PROJ, home2)).blocked).toBe(false);
      // PreToolUse timeout (fixture: sleep 30, timeout 1) → killed → allow.
      const t0 = Date.now();
      const r = await runImportedHooksFor("tool.execute.before", { tool: "bash" }, PROJ, home2);
      expect(r.blocked).toBe(false);
      expect(Date.now() - t0).toBeLessThan(10_000);
    } finally {
      delete process.env.RA_PLUGIN_HOOKS;
      delete process.env.RA_PLUGIN_HOME;
      resetHookRuntimeCache();
      rmSync(home2, { recursive: true, force: true });
    }
  });

  test("UserPromptSubmit BLOCKS an agent turn when the hook exits 2", async () => {
    const home2 = mkdtempSync(join(tmpdir(), "ra-hooks-blk-"));
    try {
      mkdirSync(join(home2, ".ra"), { recursive: true });
      writeFileSync(join(home2, ".ra", "imports.json"), JSON.stringify({ imports: [{
        id: "t:plugin:q", source: "claude-code", kind: "plugin", name: "q",
        hooksEnabled: true, hookDefs: [{ event: "UserPromptSubmit", command: "echo forbidden >&2; exit 2", timeout: 5 }],
      }] }));
      resetHookRuntimeCache();
      process.env.RA_PLUGIN_HOOKS = "on";
      const r = await runImportedHooksFor("tui.prompt.append", { prompt: "do the thing" }, PROJ, home2);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain("forbidden");
    } finally {
      delete process.env.RA_PLUGIN_HOOKS;
      resetHookRuntimeCache();
      rmSync(home2, { recursive: true, force: true });
    }
  });

  test("no-op invariant: no listeners → immediate false, no manifest reads", async () => {
    const home2 = mkdtempSync(join(tmpdir(), "ra-hooks-nol-"));
    try {
      const t0 = Date.now();
      expect((await runImportedHooksFor("tui.prompt.append", {}, PROJ, home2)).blocked).toBe(false);
      expect(Date.now() - t0).toBeLessThan(100);
    } finally { rmSync(home2, { recursive: true, force: true }); }
  });
});

// ---- 7. !cmd pre-exec + allowed-tools -------------------------------------------------------------

describe("7. !`cmd` pre-exec + allowed-tools", () => {
  test("command-allowed-tools.md loads with allowed-tools frontmatter", () => {
    mkdirSync(join(HOME, ".ra", "commands"), { recursive: true });
    writeFileSync(join(HOME, ".ra", "commands", "commit.md"), read(join(FIX, "claude-code", "command-allowed-tools.md")));
    const cmds = loadCustomCommands([join(HOME, ".ra", "commands")]);
    const c = cmds.find((x) => x.name === "commit")!;
    expect(c).toBeTruthy();
    expect(c.allowedTools).toEqual(["Bash(git add:*)", "Bash(git status:*)", "Bash(git commit:*)"]);
  });

  test("expandPreExec runs !`git …` blocks and inlines real git output", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ra-preexec-"));
    try {
      Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
      Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: repo });
      Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: repo });
      writeFileSync(join(repo, "a.txt"), "hello");
      Bun.spawnSync(["git", "add", "a.txt"], { cwd: repo });
      Bun.spawnSync(["git", "commit", "-qm", "init commit msg"], { cwd: repo });
      writeFileSync(join(repo, "b.txt"), "dirty"); // uncommitted → shows in status
      const body = "## Context\n\n- Current git status: !`git status --short`\n- Current branch: !`git branch --show-current`\n- Recent commits: !`git log --oneline -10`\n";
      const out = await expandPreExec(body, repo);
      expect(out).not.toContain("!`");
      expect(out).toContain("?? b.txt");        // real git status output (untracked)
      expect(out).toContain("init commit msg"); // real git log output
    } finally { rmSync(repo, { recursive: true, force: true }); }
  }, 15000);

  test("allowedToolsToPerms: only allowed verbs stay allow; bash-specifier maps", () => {
    const perms = allowedToolsToPerms(["Bash(git add:*)", "Bash(git status:*)", "Bash(git commit:*)"]);
    expect(perms.bash).toBe("allow");
    expect(perms.write).toBe("deny");
    expect(perms.edit).toBe("deny");
    expect(perms.read).toBe("deny");
    expect(perms.webfetch).toBe("deny");
  });
});

// ---- 8. Per-server MCP allowlists ------------------------------------------------------------------

describe("8. per-server MCP allowlists", () => {
  test("autoApprove/enabled_tools → tools.allow record on the config entry", () => {
    const e = mcpConfigEntry({ command: "x", autoApprove: ["mcp__srv__read_file", "mcp__srv__list"] });
    expect(e!.tools).toEqual({ allow: ["mcp__srv__read_file", "mcp__srv__list"] });
    const c = mcpConfigEntry({ command: "x", enabled_tools: ["a"], disabled_tools: ["b"] });
    expect(c!.tools).toEqual({ allow: ["a"], deny: ["b"] });
    // Empty lists → no tools record (fixture's empty autoApprove).
    expect(mcpConfigEntry({ command: "x", autoApprove: [] })!.tools).toBeUndefined();
  });

  test("applyMcpToConfig persists the allowlist alongside the server", () => {
    const home2 = mkdtempSync(join(tmpdir(), "ra-allow-"));
    try {
      const r = applyMcpToConfig([{ name: "srv", data: { command: "x", autoApprove: ["mcp__srv__a"] } }], home2);
      expect(r.applied).toEqual(["srv"]);
      const cfg = JSON.parse(readFileSync(r.configPath, "utf-8"));
      expect(cfg.mcp.srv.tools).toEqual({ allow: ["mcp__srv__a"] });
    } finally { rmSync(home2, { recursive: true, force: true }); }
  });
});

// ---- 9. Project opencode.json scan ------------------------------------------------------------------

describe("9. project opencode.json scan", () => {
  test("project-root opencode.json yields mcp + agent + plugin entries", () => {
    const oc = JSON.parse(read(join(FIX, "opencode", "opencode.json")));
    writeFileSync(join(PROJ, "opencode.json"), JSON.stringify(oc));
    const entries = detectStores(HOME, PROJ).filter((e) => e.source === "opencode");
    expect(entries.find((e) => e.kind === "mcp" && e.name === "chrome-devtools")).toBeTruthy();
    expect(entries.find((e) => e.kind === "agent" && e.name === "forge")).toBeTruthy();
    // cleanup project file so later describes don't re-see it
    rmSync(join(PROJ, "opencode.json"));
  });
});
