// hook-matrix.test.ts — Wave 3a property sweep: the full hook-shim decision
// matrix. Every exit code (0/1/2/127/…os-level) × every output form (empty,
// stdout-JSON decision block, stdout-JSON hookSpecificOutput
// permissionDecision allow/ask/deny + missing/garbage variants, stderr text)
// × timeout expiry. The table is the contract from hook-shim.ts's header —
// a maintainer reading a row name knows exactly which cell broke.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHookCommand, type RegisteredHook } from "../src/plugins/hook-shim.ts";

let CWD = "";
beforeAll(() => { CWD = mkdtempSync(join(tmpdir(), "ra-hookmatrix-")); });
afterAll(() => { rmSync(CWD, { recursive: true, force: true }); });

const hook = (command: string, timeout?: number): RegisteredHook => ({
  id: "matrix:hook", raHook: "tool.execute.before", event: "PreToolUse",
  handler: { type: "command", command, ...(timeout !== undefined ? { timeout } : {}) },
});

describe("hook-shim decision matrix — exit code × output form", () => {
  // Cell semantics (from the Claude Code protocol in hook-shim.ts):
  //   exit 2 → block (stderr is the reason)
  //   stdout JSON decision:"block" → block
  //   stdout JSON hookSpecificOutput.permissionDecision deny/ask/allow
  //   exit 0 (no decision output) → allow
  //   exit != 0/2 (non-blocking error) → allow + reason
  //   timeout expiry → allow (non-blocking), timedOut flag set
  const table: Array<{ name: string; command: string; timeout?: number; want: { action: string; reasonMatch?: RegExp; timedOut?: boolean } }> = [
    // --- exit 0 ---
    { name: "exit 0 + empty output → allow, no reason", command: "true", want: { action: "allow" } },
    { name: "exit 0 + stdout text (non-JSON) → allow, text ignored", command: "echo hello-world-text", want: { action: "allow" } },
    { name: "exit 0 + stdout JSON decision:block → block (stdout outranks exit 0)", command: `echo '{"decision":"block","reason":"stop it"}'`, want: { action: "block", reasonMatch: /stop it/ } },
    { name: "exit 0 + stdout JSON permissionDecision deny → deny", command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny","reason":"no"}}'`, want: { action: "deny", reasonMatch: /no/ } },
    { name: "exit 0 + stdout JSON permissionDecision ask → ask", command: `echo '{"hookSpecificOutput":{"permissionDecision":"ask"}}'`, want: { action: "ask" } },
    { name: "exit 0 + stdout JSON permissionDecision allow → allow", command: `echo '{"hookSpecificOutput":{"permissionDecision":"allow"}}'`, want: { action: "allow" } },
    { name: "exit 0 + permissionDecision garbage value → treated as no decision → allow", command: `echo '{"hookSpecificOutput":{"permissionDecision":"maybe"}}'`, want: { action: "allow" } },
    { name: "exit 0 + permissionDecision UPPERCASE → normalized to lowercase action", command: `echo '{"hookSpecificOutput":{"permissionDecision":"DENY"}}'`, want: { action: "deny" } },
    { name: "exit 0 + decision:approve (non-block JSON) → allow (JSON parsed, no decision)", command: `echo '{"decision":"approve"}'`, want: { action: "allow" } },
    { name: "exit 0 + JSON with leading whitespace → still parsed (trim, not line 1)", command: `printf '  \\n\\t{"decision":"block","reason":"ws"}'`, want: { action: "block", reasonMatch: /ws/ } },
    // --- exit 2 ---
    { name: "exit 2 + stderr text → block with stderr as reason", command: "echo bad-tool >&2; exit 2", want: { action: "block", reasonMatch: /bad-tool/ } },
    { name: "exit 2 + empty stderr → block with fallback reason (hook id)", command: "exit 2", want: { action: "block", reasonMatch: /matrix:hook/ } },
    { name: "exit 2 + stdout JSON allow → exit 2 wins (Claude CC semantics: exit 2 always blocks)", command: `echo '{"hookSpecificOutput":{"permissionDecision":"allow"}}'; exit 2`, want: { action: "block" } },
    { name: "decision:block outranks permissionDecision in the same JSON payload", command: `echo '{"decision":"block","reason":"top","hookSpecificOutput":{"permissionDecision":"deny"}}'`, want: { action: "block", reasonMatch: /top/ } },
    // --- other exit codes ---
    { name: "exit 1 → non-blocking error → allow + reason", command: "exit 1", want: { action: "allow", reasonMatch: /non-blocking/ } },
    { name: "exit 3 (arbitrary) → allow + reason mentions code", command: "exit 3", want: { action: "allow", reasonMatch: /hook exited 3/ } },
    { name: "exit 127 (command not found) → spawn failure → allow + non-blocking reason", command: "definitely-not-a-real-cmd-xyz", want: { action: "allow", reasonMatch: /non-blocking/ } },
    // --- malformed JSON stdout ---
    { name: "truncated JSON stdout → parse failure → fall through to exit-code rule", command: `echo -n '{"decision":"blo'`, want: { action: "allow" } },
    { name: "JSON stdout on exit 1 → garbage JSON ignored, exit rule applies", command: `echo '{"decision":"block","reason":"x"'; exit 1`, want: { action: "allow", reasonMatch: /non-blocking/ } },
    { name: "JSON array stdout → not an object decision → exit rule applies", command: `echo '[1,2,3]'`, want: { action: "allow" } },
    { name: "multi-line output where first line is text → not JSON-decided", command: "echo not-json; echo second", want: { action: "allow" } },
    { name: "stderr-only text with exit 0 → allow, stderr captured but ignored", command: "echo warnings-to-stderr >&2", want: { action: "allow" } },
    // --- permissionDecision reason fallbacks ---
    { name: "permissionDecision deny without reason → deny, no reason", command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny"}}'`, want: { action: "deny" } },
    { name: "permissionDecision deny + top-level reason (no nested reason) → reason lifted from top level", command: `echo '{"reason":"top-only","hookSpecificOutput":{"permissionDecision":"deny"}}'`, want: { action: "deny", reasonMatch: /top-only/ } },
    { name: "decision:block without reason → default reason mentions JSON decision", command: `echo '{"decision":"block"}'`, want: { action: "block", reasonMatch: /JSON decision/ } },
  ];

  for (const row of table) {
    test(row.name, async () => {
      const r = await runHookCommand(hook(row.command, row.timeout), { tool: "bash" }, CWD);
      expect(r.decision.action).toBe(row.want.action); // ${row.name}
      if (row.want.reasonMatch) expect(r.decision.reason ?? "").toMatch(row.want.reasonMatch);
      if (row.want.timedOut) expect(r.timedOut).toBe(true);
    });
  }

  test("exit code precedence summary: block only from exit 2 or JSON block/deny", async () => {
    // The invariant behind the whole matrix: nothing except an explicit
    // block signal (exit 2 / JSON block/deny) ever blocks. Everything else
    // — crashes, weird output, timeouts — degrades to allow.
    const blocking: Array<string> = [
      "exit 2",
      `echo '{"decision":"block"}'`,
      `echo '{"hookSpecificOutput":{"permissionDecision":"deny"}}'`,
    ];
    const allowing: Array<string> = [
      "true", "exit 1", "exit 42", "echo plain text", `echo '{"garbage": true}'`,
      "kill -9 $$",
    ];
    for (const c of blocking) {
      const r = await runHookCommand(hook(c), {}, CWD);
      expect(["block", "deny"]).toContain(r.decision.action); // cmd: ${c}
    }
    for (const c of allowing) {
      const r = await runHookCommand(hook(c), {}, CWD);
      expect(r.decision.action).toBe("allow"); // cmd: ${c}
    }
  });
});

describe("hook-shim timeout matrix", () => {
  test("handler.timeout (seconds) is honored over the default arg", async () => {
    const r = await runHookCommand(hook("sleep 5", 1), {}, CWD, 30_000);
    expect(r.timedOut).toBe(true);
    expect(r.decision.action).toBe("allow");
    expect(r.decision.reason).toContain("timed out");
  }, 10_000);

  test("default timeoutMs applies when handler has none", async () => {
    const r = await runHookCommand(hook("sleep 5"), {}, CWD, 200);
    expect(r.timedOut).toBe(true);
    expect(r.decision.action).toBe("allow");
  }, 10_000);

  test("a hook finishing before the deadline is not timed out", async () => {
    const r = await runHookCommand(hook("sleep 0.05", 30), {}, CWD, 5_000);
    expect(r.timedOut ?? false).toBe(false);
    expect(r.decision.action).toBe("allow");
  }, 10_000);

  test("timeout mid-output still degrades to allow (never blocks on expiry)", async () => {
    // Writes partial JSON then hangs — the partial stdout must not be parsed
    // into a block decision; expiry wins as a non-blocking allow.
    const r = await runHookCommand(hook(`printf '{"decision":"blo'; sleep 5`, 1), {}, CWD, 30_000);
    expect(r.timedOut).toBe(true);
    expect(r.decision.action).toBe("allow");
  }, 10_000);

  test("timeout: 0 (falsy) falls back to the caller default, not instant kill", async () => {
    // handler.timeout === 0 is falsy in JS — the shim's `handler.timeout ? … : timeoutMs`
    // treats it as unset. Pin the contract: 0 means default, not 0ms.
    const r = await runHookCommand(hook("sleep 1", 0), {}, CWD, 100);
    expect(r.timedOut).toBe(true);
    expect(r.decision.action).toBe("allow");
  }, 10_000);
});

describe("hook-shim stdin payload properties", () => {
  test("hook_event_name rides along on every event type", async () => {
    writeFileSync(join(CWD, "stdin-ev.txt"), "");
    await runHookCommand(
      { id: "x", raHook: "session.start", event: "SessionStart", handler: { type: "command", command: "cat > stdin-ev.txt" } },
      { cwd: "/tmp" }, CWD,
    );
    const seen = JSON.parse(await Bun.file(join(CWD, "stdin-ev.txt")).text()) as { hook_event_name: string };
    expect(seen.hook_event_name).toBe("SessionStart");
  });

  test("nested secrets in tool_input are redacted before crossing stdin", async () => {
    writeFileSync(join(CWD, "stdin-nested.txt"), "");
    await runHookCommand(
      hook("cat > stdin-nested.txt"),
      { tool: "write", tool_input: { path: "/x", content: "key ghp_abcdefghijklmnopqrstuvwxyz0123456789 ok", list: ["sk-ant-abcdefghijklmnopqrstuvwxyz12"] } },
      CWD,
    );
    const seen = await Bun.file(join(CWD, "stdin-nested.txt")).text();
    expect(seen).not.toContain("ghp_");
    expect(seen).not.toContain("sk-ant-");
    expect(seen).toContain("__VIBEGUARD_");
  });
});
