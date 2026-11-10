// permission-matrix.test.ts — Wave 3a full truth table: the permission
// engine's precedence chain from agent frontmatter → config permission.tool →
// command allowed-tools, for every tool verb × allow/ask/deny.

import { describe, expect, test } from "bun:test";
import { toolPermission, canRunTool, restrictedTools, resolveCapabilities, assertTool, assertBash, TOOL_VERBS, type BashRule } from "../src/permission.ts";
import { allowedToolsToPerms } from "../src/commands/index.ts";
import { resolveBashLevel, bashPatternMatches, loadAgentPermissionDetail } from "../src/agent.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

const base: RaConfig = { agent: {}, model: "m" };

// ---- config-level truth table ------------------------------------------------------------

describe("config permission: every verb × every level", () => {
  const verbs = [...TOOL_VERBS];
  const levels = ["allow", "ask", "deny"] as const;

  test("full verb × level table for toolPermission + canRunTool(headless/auto)", () => {
    for (const verb of verbs) {
      for (const level of levels) {
        const cfg: RaConfig = { ...base, permission: { tool: { [verb]: level } } };
        expect(toolPermission(cfg, verb)).toBe(level); // ${verb}/${level}
        // headless (no autoApprove, no onAsk): ask ≡ deny
        expect(canRunTool(cfg, verb)).toBe(level === "allow"); // ${verb}/${level}
      }
    }
  });

  test("ask resolution: autoApprove=true proceeds, false denies, onAsk consulted", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { bash: "ask" } } };
    expect(canRunTool(cfg, "bash", { autoApprove: true })).toBe(true);
    expect(canRunTool(cfg, "bash", { autoApprove: false })).toBe(false);
    expect(canRunTool(cfg, "bash", { onAsk: () => true })).toBe(true);
    expect(canRunTool(cfg, "bash", { onAsk: () => false })).toBe(false);
  });

  test("wildcard '*' applies to any tool without its own rule; specific rule wins", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { "*": "deny", read: "allow" } } };
    expect(toolPermission(cfg, "bash")).toBe("deny");
    expect(toolPermission(cfg, "write")).toBe("deny");
    expect(toolPermission(cfg, "read")).toBe("allow"); // specific overrides *
  });

  test("write falls back to the edit rule when unset (alias semantics)", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { edit: "deny" } } };
    expect(toolPermission(cfg, "write")).toBe("deny");
    // explicit write wins over the edit fallback
    const cfg2: RaConfig = { ...base, permission: { tool: { edit: "deny", write: "allow" } } };
    expect(toolPermission(cfg2, "write")).toBe("allow");
  });

  test("unknown tool names default to allow (forward-compat)", () => {
    expect(toolPermission(base, "future-tool")).toBe("allow");
  });

  test("restrictedTools lists exactly the non-allow verbs", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { bash: "deny", write: "ask", read: "allow", mcp: "deny" } } };
    expect(restrictedTools(cfg).sort()).toEqual(["bash", "mcp", "write"]);
  });
});

// ---- agent capabilities truth table ----------------------------------------------------------

describe("resolveCapabilities: frontmatter role × config × parent narrowing", () => {
  const denyWrite: RaConfig = { ...base, permission: { tool: { write: "deny" } } };

  test("default (no role, no config): every verb available", () => {
    const caps = resolveCapabilities(base);
    for (const v of TOOL_VERBS) expect(caps.tools.has(v)).toBe(true); // ${v}
    expect(caps.readOnly).toBe(false);
  });

  test("role deny is directional: write inherits edit's rule, not the reverse", () => {
    // level(): role[tool] ?? (write ? role.edit) ?? role[*] — write falls back
    // to the edit rule; edit NEVER falls back to write.
    const caps = resolveCapabilities(base, { write: "deny" });
    expect(caps.tools.has("write")).toBe(false);
    expect(caps.tools.has("edit")).toBe(true); // edit has no rule of its own
    expect(caps.tools.has("multiedit")).toBe(true); // multiedit maps to edit (allowed)
    expect(caps.readOnly).toBe(false); // readOnly needs BOTH write and edit gated
    const caps2 = resolveCapabilities(base, { edit: "deny" });
    expect(caps2.tools.has("edit")).toBe(false);
    expect(caps2.tools.has("write")).toBe(false); // write falls back to role.edit
    expect(caps2.tools.has("multiedit")).toBe(false);
    expect(caps2.readOnly).toBe(true);
  });

  test("role '*' applies to every verb", () => {
    const caps = resolveCapabilities(base, { "*": "ask" });
    expect(caps.tools.size).toBe(1); // only 'done' survives ask at capability level
    expect(caps.tools.has("done")).toBe(true);
  });

  test("config deny intersects: role-allowed verbs still drop when config denies them", () => {
    const caps = resolveCapabilities(denyWrite, {});
    expect(caps.tools.has("write")).toBe(false); // config gate
    expect(caps.tools.has("edit")).toBe(true); // config allows edit (no alias at config level)
    expect(caps.readOnly).toBe(false); // readOnly needs both write AND edit gated
    const denyBoth: RaConfig = { ...base, permission: { tool: { write: "deny", edit: "deny" } } };
    const caps2 = resolveCapabilities(denyBoth, {});
    expect(caps2.readOnly).toBe(true);
    expect(caps2.tools.has("todo")).toBe(false); // readOnly strips mutators
  });

  test("whitelist narrows to exactly the listed verbs (case-insensitive)", () => {
    const caps = resolveCapabilities(base, {}, ["Read", "BASH"]);
    expect([...caps.tools].sort()).toEqual(["bash", "done", "read"]);
  });

  test("parent capabilities only narrow, never expand (inheritance invariant)", () => {
    const parent = resolveCapabilities(base, { edit: "deny" }); // write falls back too
    const child = resolveCapabilities(base, {}, undefined, [], parent);
    expect(child.tools.has("write")).toBe(false); // parent denies via role.edit alias
    expect(child.tools.has("edit")).toBe(false);
    expect(child.readOnly).toBe(true); // readOnly propagates
    // parent without bash → child cannot gain bash even though its own role allows
    const parent2 = resolveCapabilities(base, {}, ["read"]);
    const child2 = resolveCapabilities(base, {}, undefined, [], parent2);
    expect(child2.tools.has("bash")).toBe(false);
    expect(child2.tools.has("read")).toBe(true);
  });

  test("readOnly strips every mutating verb including todo and mcp", () => {
    const caps = resolveCapabilities(base, { write: "deny", edit: "deny" });
    for (const v of ["write", "edit", "multiedit", "todo", "mcp"]) {
      expect(caps.tools.has(v)).toBe(false); // ${v}
    }
    expect(caps.tools.has("read")).toBe(true);
  });

  test("assertTool throws only for verbs missing from the capability set", () => {
    const caps = resolveCapabilities(base, { bash: "deny" });
    expect(() => assertTool(caps, "read")).not.toThrow();
    expect(() => assertTool(caps, "bash")).toThrow(/not permitted/);
    expect(() => assertTool(undefined, "anything")).not.toThrow(); // no caps = no gate
  });
});

// ---- bash layer rules ---------------------------------------------------------------------

describe("bash pattern rules (agent layers)", () => {
  test("bashPatternMatches: glob semantics on trimmed commands", () => {
    expect(bashPatternMatches("git diff*", "git diff HEAD")).toBe(true);
    expect(bashPatternMatches("git diff*", "git diff")).toBe(true);
    expect(bashPatternMatches("git diff*", "git push")).toBe(false);
    expect(bashPatternMatches("git diff*", "  git diff  ")).toBe(true); // trimmed
    expect(bashPatternMatches("exact-cmd", "exact-cmd")).toBe(true);
    expect(bashPatternMatches("exact-cmd", "exact-cmd --flag")).toBe(false);
    expect(bashPatternMatches("a.b", "aXb")).toBe(false); // dots escaped
  });

  test("resolveBashLevel: first matching pattern wins; '*' is skipped as a pattern", () => {
    const rules = [
      { pattern: "git push*", level: "deny" as const },
      { pattern: "git diff*", level: "allow" as const },
      { pattern: "*", level: "ask" as const },
    ];
    expect(resolveBashLevel("git push origin", rules, "allow")).toBe("deny");
    expect(resolveBashLevel("git diff", rules, "deny")).toBe("allow");
    // '*' never matches in the loop — an unmatched command returns the CALLER's
    // fallback (the collapsed '*' level flows in via loadAgentPermissionDetail):
    expect(resolveBashLevel("cargo build", rules, "ask")).toBe("ask");
    expect(resolveBashLevel("cargo build", rules, "deny")).toBe("deny");
    expect(resolveBashLevel("nothing matches", [], "deny")).toBe("deny"); // empty rules → fallback
  });

  test("assertBash enforces every inherited layer; unmatched commands fall to the layer fallback (role bash level)", () => {
    // Layer fallback = level("bash") from the ROLE map: a role with bash:ask
    // gates every command not explicitly pattern-allowed in a layer.
    const askBash = resolveCapabilities(base, { bash: "ask" }, undefined, [{ pattern: "ls*", level: "allow" }]);
    expect(() => assertBash(askBash, "ls -la")).not.toThrow(); // pattern allows
    expect(() => assertBash(askBash, "rm -rf /")).toThrow(/not permitted/); // fallback ask ≠ allow
    // default role (no bash rule): fallback = allow → everything passes
    const solo = resolveCapabilities(base, undefined, undefined, [{ pattern: "ls*", level: "allow" }]);
    expect(() => assertBash(solo, "cargo build")).not.toThrow(); // unmatched → allow fallback
    // two layers: parent patterns + child patterns, BOTH must allow
    const parent = resolveCapabilities(base, { bash: "deny" }, undefined, [{ pattern: "git*", level: "allow" }]);
    const child = resolveCapabilities(base, {}, undefined, [{ pattern: "git*", level: "allow" }], parent);
    expect(() => assertBash(child, "git push")).not.toThrow(); // allowed in both layers
    expect(() => assertBash(child, "git push --force")).not.toThrow();
    expect(() => assertBash(child, "ls")).toThrow(/not permitted/); // parent fallback deny
    expect(() => assertBash(undefined, "rm -rf /")).not.toThrow(); // no caps = no gate
  });

  test("frontmatter nested bash map: '*' collapse + pattern list extraction", () => {
    const raw = [
      "---",
      "description: t",
      "permission:",
      "  bash:",
      '    "git diff*": allow',
      '    "git push*": deny',
      '    "*": ask',
      "---",
    ].join("\n");
    const detail = loadAgentPermissionDetail("role-x", "/nonexistent-cwd-for-permmatrix");
    // loadAgentPermissionDetail reads files from disk — exercise the parser via the real fixture instead:
    const { loadAgentPermissionDetail: lapd } = require("../src/agent.ts") as typeof import("../src/agent.ts");
    // write a temp agent file into a temp project and read it through the real path
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const proj = mkdtempSync(join("/tmp", "ra-permmatrix-"));
    try {
      mkdirSync(join(proj, ".ra", "agents"), { recursive: true });
      writeFileSync(join(proj, ".ra", "agents", "tester.md"), raw);
      const d = lapd("tester", proj);
      expect(d!.tools["bash"]).toBe("ask"); // '*' collapse
      expect(d!.bashPatterns).toEqual([
        { pattern: "git diff*", level: "allow" },
        { pattern: "git push*", level: "deny" },
        { pattern: "*", level: "ask" },
      ]);
      expect(resolveBashLevel("git push o", d!.bashPatterns, d!.tools["bash"])).toBe("deny");
      expect(resolveBashLevel("cargo b", d!.bashPatterns, d!.tools["bash"])).toBe("ask"); // '*' as the caller fallback
    } finally {
      rmSync(proj, { recursive: true, force: true });
      expect(detail).toBeNull(); // unknown cwd/role → null (never throws)
    }
  });

  test("nested bash map without '*' collapses to the MOST restrictive entry", () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { loadAgentPermissionDetail: lapd } = require("../src/agent.ts") as typeof import("../src/agent.ts");
    const proj = mkdtempSync(join("/tmp", "ra-permmatrix2-"));
    try {
      mkdirSync(join(proj, ".ra", "agents"), { recursive: true });
      writeFileSync(join(proj, ".ra", "agents", "t2.md"), [
        "---", "description: t", "permission:", "  bash:",
        '    "git diff*": allow', '    "git push*": deny',
        "---",
      ].join("\n"));
      const d = lapd("t2", proj)!;
      expect(d.tools["bash"]).toBe("deny"); // min(allow, deny)
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

// ---- command allowed-tools overlay -----------------------------------------------------------

describe("command allowed-tools → perms overlay (the third precedence layer)", () => {
  test("every mapped Claude tool name allows its RA verb; everything else denies", () => {
    const perms = allowedToolsToPerms(["Bash(git add:*)", "Write"]);
    expect(perms["bash"]).toBe("allow");
    expect(perms["write"]).toBe("allow");
    expect(perms["edit"]).toBe("deny");
    expect(perms["read"]).toBe("deny");
    expect(perms["mcp"]).toBe("deny");
  });

  test("mcp__server__tool entries allow the mcp verb", () => {
    const perms = allowedToolsToPerms(["mcp__github__create_issue"]);
    expect(perms["mcp"]).toBe("allow");
    expect(perms["bash"]).toBe("deny");
  });

  test("unknown Claude tools (NotebookEdit) deny by omission — never allow an RA verb", () => {
    const perms = allowedToolsToPerms(["NotebookEdit"]);
    expect(Object.values(perms).every((v) => v === "deny")).toBe(true);
  });

  test("empty spec list denies every verb for the turn", () => {
    expect(Object.values(allowedToolsToPerms([])).every((v) => v === "deny")).toBe(true);
  });

  test("overlay replaces the whole verb table (turn-scoped allowlist, not a merge per verb)", () => {
    // The dispatch seam: { ...original.tool, ...allowedToolsToPerms(specs) } —
    // allowedToolsToPerms returns ALL 17 verbs, so unlisted tools flip to deny
    // for the turn and listed ones to allow; original rules resurface after.
    const original = { bash: "ask", write: "deny" } as Record<string, "allow" | "ask" | "deny">;
    const overlay = { ...original, ...allowedToolsToPerms(["Bash"]) };
    expect(overlay["bash"]).toBe("allow"); // turn override
    expect(overlay["write"]).toBe("deny"); // still denied (was already deny)
    expect(overlay["read"]).toBe("deny"); // not in the allowlist → denied this turn
  });

  test("the full table has exactly the 17 RA verbs", () => {
    const perms = allowedToolsToPerms(["Bash"]);
    expect(Object.keys(perms).length).toBe(17);
  });
});
