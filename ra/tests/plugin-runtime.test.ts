// plugin-runtime.test.ts — Wave A hook-execution runtime over the parity
// fixtures: opt-in gating, decision protocol (exit 2 / JSON stdout), timeout
// kill, $CLAUDE_PLUGIN_ROOT substitution, stdin JSON + secret redaction.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractHookCommands, claudeEventToRaHook, matcherToRaTool,
  runHookCommand, loadEnabledHooks, readHooksPolicy, runImportedHooksFor, resetHookRuntimeCache,
  type RegisteredHook,
} from "../src/plugins/hook-shim.ts";
import { importEntry, loadManifest, removeImported } from "../src/plugins/import.ts";
import { execToolBlock } from "../src/agent.ts";

let HOME = "";
let CWD = "";
const FIX = join(import.meta.dir, "fixtures", "parity", "claude-code");
const manifest = () => join(HOME, ".ra", "imports.json");

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "ra-hookexec-"));
  CWD = mkdtempSync(join(tmpdir(), "ra-hookexec-cwd-"));
  // Claude plugin cache with the real parity fixture manifest (caveman hooks).
  const cc = join(HOME, ".claude", "plugins", "cache", "fixture", "plugin-with-hooks", "1.0.0");
  mkdirSync(join(cc, ".claude-plugin"), { recursive: true });
  writeFileSync(join(cc, ".claude-plugin", "plugin.json"), readFileSync(join(FIX, "plugin-with-hooks.plugin.json"), "utf-8"));
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(CWD, { recursive: true, force: true });
});

// Build a runnable RegisteredHook by hand for protocol-level tests.
const hook = (command: string, extra: Partial<RegisteredHook> = {}): RegisteredHook => ({
  id: "test:hook", raHook: "tool.execute.before", event: "PreToolUse",
  handler: { type: "command", command, timeout: extra.handler?.timeout },
  ...extra,
});

describe("fixture extraction", () => {
  test("plugin-with-hooks fixture parses into command handlers with matchers + timeouts", () => {
    const manifestJson = JSON.parse(readFileSync(join(FIX, "plugin-with-hooks.plugin.json"), "utf-8")) as { hooks: Record<string, unknown> };
    const cmds = extractHookCommands(manifestJson.hooks);
    expect(cmds.length).toBe(2); // SessionStart + UserPromptSubmit
    expect(cmds[0]!.event).toBe("SessionStart");
    expect(cmds[0]!.handler.command).toContain("CLAUDE_PLUGIN_ROOT");
    expect(cmds[0]!.handler.timeout).toBe(30);
  });

  test("hooks-settings.json fixture parses PreToolUse matcher groups", () => {
    const settings = JSON.parse(readFileSync(join(FIX, "hooks-settings.json"), "utf-8")) as { hooks: Record<string, unknown> };
    const cmds = extractHookCommands(settings.hooks);
    const pre = cmds.find((c) => c.event === "PreToolUse")!;
    expect(pre.matcher).toBe("Bash");
    expect(pre.handler.command).toContain("$CLAUDE_PROJECT_DIR");
    expect(cmds.find((c) => c.event === "SessionStart")!.matcher).toBe("startup|resume");
  });

  test("event + matcher mapping", () => {
    expect(claudeEventToRaHook("PreToolUse")).toBe("tool.execute.before");
    expect(claudeEventToRaHook("UserPromptSubmit")).toBe("tui.prompt.append");
    expect(claudeEventToRaHook("SessionStart")).toBe("session.start"); // Wave B
    expect(claudeEventToRaHook("SessionEnd")).toBe("session.end"); // Wave B
    expect(claudeEventToRaHook("PostToolUse")).toBe("tool.execute.after"); // Wave B
    expect(claudeEventToRaHook("PreCompact")).toBe("context.compact"); // Wave B
    expect(matcherToRaTool("Bash")).toBe("bash");
    expect(matcherToRaTool("Write|Edit")).toBe("write");
    expect(matcherToRaTool("startup|resume")).toBeNull();
  });
});

describe("decision protocol", () => {
  test("exit 0 → allow", async () => {
    const r = await runHookCommand(hook("echo ok"), { tool: "bash" }, CWD);
    expect(r.decision.action).toBe("allow");
    expect(r.stdout.trim()).toBe("ok");
  });

  test("exit 2 → block with stderr as reason", async () => {
    const r = await runHookCommand(hook("echo danger >&2; exit 2"), { tool: "bash" }, CWD);
    expect(r.decision.action).toBe("block");
    expect(r.decision.reason).toContain("danger");
  });

  test('stdout JSON {"decision":"block"} → block', async () => {
    const r = await runHookCommand(hook(`echo '{"decision":"block","reason":"nope"}'`), {}, CWD);
    expect(r.decision.action).toBe("block");
    expect(r.decision.reason).toBe("nope");
  });

  test("stdout JSON permissionDecision deny → deny", async () => {
    const r = await runHookCommand(hook(`echo '{"hookSpecificOutput":{"permissionDecision":"deny","reason":"unsafe"}}'`), {}, CWD);
    expect(r.decision.action).toBe("deny");
    expect(r.decision.reason).toBe("unsafe");
  });

  test("other exit codes → non-blocking error (allow, reason logged)", async () => {
    const r = await runHookCommand(hook("exit 1"), {}, CWD);
    expect(r.decision.action).toBe("allow");
    expect(r.decision.reason).toContain("non-blocking");
  });

  test("timeout kills the hook and allows (non-blocking)", async () => {
    const r = await runHookCommand(hook("sleep 30", { handler: { type: "command", command: "sleep 30", timeout: 1 } }), {}, CWD, 500);
    expect(r.decision.action).toBe("allow");
    expect(r.timedOut).toBe(true);
  }, 10000);

  test("JSON stdin carries session context, secrets redacted", async () => {
    writeFileSync(join(CWD, "seen.json"), "");
    await runHookCommand(hook("cat > seen.json"), { tool: "bash", prompt: "use sk-ant-abcdefghijklmnopqrstuvwxyz123456 please" }, CWD);
    const seen = readFileSync(join(CWD, "seen.json"), "utf-8");
    const parsed = JSON.parse(seen) as { tool: string; prompt: string; hook_event_name: string };
    expect(parsed.tool).toBe("bash");
    expect(parsed.hook_event_name).toBe("PreToolUse");
    expect(parsed.prompt).not.toContain("sk-ant-");
    expect(parsed.prompt).toContain("__VIBEGUARD_");
  });

  test("$CLAUDE_PLUGIN_ROOT substitutes the imported artifact dir", async () => {
    writeFileSync(join(CWD, "root.txt"), "");
    const r = await runHookCommand(hook("echo $CLAUDE_PLUGIN_ROOT > root.txt", { pluginRoot: "/opt/plugins/caveman" }), {}, CWD);
    expect(r.decision.action).toBe("allow");
    expect(readFileSync(join(CWD, "root.txt"), "utf-8").trim()).toBe("/opt/plugins/caveman");
  });

  test("missing command (spawn failure) is non-blocking", async () => {
    const r = await runHookCommand(hook("definitely-not-a-command-xyz --run"), {}, CWD);
    expect(r.decision.action).toBe("allow");
    expect(r.decision.reason).toContain("non-blocking");
  });
});

describe("default-deny opt-in", () => {
  test("import without --with-hooks records hooks but NOT runnable defs", () => {
    const { detectStores } = require("../src/plugins/stores.ts") as typeof import("../src/plugins/stores.ts");
    const entry = detectStores(HOME).find((e) => e.kind === "plugin" && e.name === "caveman")!;
    expect(entry).toBeTruthy();
    const r = importEntry(entry, HOME);
    expect(r.record.hooksEnabled).toBeUndefined();
    expect(r.record.hookDefs).toBeUndefined();
    expect(loadEnabledHooks(HOME).length).toBe(0); // nothing runnable
  });

  test("--with-hooks marks runnable; execution still needs the global policy", () => {
    removeImported("caveman", HOME);
    const { detectStores } = require("../src/plugins/stores.ts") as typeof import("../src/plugins/stores.ts");
    const entry = detectStores(HOME).find((e) => e.kind === "plugin" && e.name === "caveman")!;
    const r = importEntry(entry, HOME, { withHooks: true });
    expect(r.record.hooksEnabled).toBe(true);
    expect(r.record.hookDefs!.length).toBe(2);
    const rec = loadManifest(HOME).imports.find((i) => i.name === "caveman")!;
    expect(rec.hooksEnabled).toBe(true);
    // Wave B: both SessionStart and UserPromptSubmit map now → 2 runnable.
    const runnable = loadEnabledHooks(HOME);
    expect(runnable.length).toBe(2);
    expect(runnable.some((h) => h.raHook === "tui.prompt.append")).toBe(true);
    expect(runnable.some((h) => h.raHook === "session.start")).toBe(true);
  });

  test("readHooksPolicy defaults to opt-in when no ra.json", () => {
    expect(readHooksPolicy(CWD).hooks ?? "opt-in").toBe("opt-in");
  });

  test("runtime guard: no execution unless policy on + hooks enabled", async () => {
    // Fixture-hook UserPromptSubmit handler runs `node …` — if the guard
    // failed, this would spawn node (slow) or block; assert it stays inert.
    resetHookRuntimeCache();
    const r = await runImportedHooksFor("tui.prompt.append", { prompt: "hi" }, CWD, HOME);
    expect(r.blocked).toBe(false);
    // Policy file says off explicitly.
    writeFileSync(join(CWD, "ra.json"), JSON.stringify({ plugin_runtime: { hooks: "opt-in" } }));
    resetHookRuntimeCache();
    expect((await runImportedHooksFor("tui.prompt.append", { prompt: "hi" }, CWD, HOME)).blocked).toBe(false);
    rmSync(join(CWD, "ra.json"));
  });

  test("runtime executes + blocks when fully opted in (RA_PLUGIN_HOOKS=on)", async () => {
    const { detectStores } = require("../src/plugins/stores.ts") as typeof import("../src/plugins/stores.ts");
    removeImported("caveman", HOME);
    const entry = detectStores(HOME).find((e) => e.kind === "plugin" && e.name === "caveman")!;
    // Replace the recorded hookDefs with a benign blocking hook for the test.
    importEntry(entry, HOME, { withHooks: true });
    const m = loadManifest(HOME);
    const rec = m.imports.find((i) => i.name === "caveman")!;
    rec.hookDefs = [{ event: "PreToolUse", matcher: "bash", command: "echo block-it >&2; exit 2", timeout: 5 }];
    writeFileSync(manifest(), JSON.stringify(m, null, 2));
    resetHookRuntimeCache();
    process.env.RA_PLUGIN_HOOKS = "on";
    try {
      const r = await runImportedHooksFor("tool.execute.before", { tool: "bash", tool_input: { command: "rm -rf /" } }, CWD, HOME);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain("block-it");
      // Matcher: same hook ignores non-bash tools.
      expect((await runImportedHooksFor("tool.execute.before", { tool: "write" }, CWD, HOME)).blocked).toBe(false);
    } finally {
      delete process.env.RA_PLUGIN_HOOKS;
      resetHookRuntimeCache();
    }
  });

  test("execToolBlock surfaces hook blocks as tool errors", async () => {
    const m = loadManifest(HOME);
    const rec = m.imports.find((i) => i.name === "caveman")!;
    rec.hookDefs = [{ event: "PreToolUse", matcher: "bash", command: "exit 2" }];
    writeFileSync(manifest(), JSON.stringify(m, null, 2));
    resetHookRuntimeCache();
    process.env.RA_PLUGIN_HOOKS = "on";
    process.env.RA_PLUGIN_HOME = HOME; // os.homedir ignores env on macOS — test seam
    try {
      const r = await execToolBlock({ cwd: CWD }, "BASH echo hi");
      expect(r.note).toContain("imported hook blocked");
      expect(r.done).toBe(false);
    } finally {
      delete process.env.RA_PLUGIN_HOOKS;
      delete process.env.RA_PLUGIN_HOME;
      resetHookRuntimeCache();
    }
  });

  test("hooks never run without the env/policy even when enabled in manifest", async () => {
    // hookDefs still set from the previous test; policy off → no execution.
    resetHookRuntimeCache();
    process.env.RA_PLUGIN_HOME = HOME;
    try {
      const r = await execToolBlock({ cwd: CWD }, "BASH echo hi");
      expect(r.note).not.toContain("imported hook blocked");
    } finally {
      delete process.env.RA_PLUGIN_HOME;
    }
  });
});
