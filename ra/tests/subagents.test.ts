import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAgentPermissions } from "../src/agent.ts";
import { AGENTS_DIR } from "../src/paths.ts";

describe("subagents", () => {
  test("general, explore, scout agent files exist", () => {
    for (const role of ["general", "explore", "scout"]) {
      expect(existsSync(join(AGENTS_DIR, `${role}.md`))).toBe(true);
    }
  });

  test("explore is read-only (edit/bash deny)", () => {
    const perms = loadAgentPermissions("explore");
    expect(perms?.edit).toBe("deny");
    expect(perms?.bash).toBe("deny");
  });

  test("scout is read-only but allows webfetch", () => {
    const perms = loadAgentPermissions("scout");
    expect(perms?.edit).toBe("deny");
    expect(perms?.bash).toBe("deny");
    expect(perms?.webfetch).toBe("allow");
  });

  test("general has full access", () => {
    const perms = loadAgentPermissions("general");
    expect(perms?.edit).toBe("allow");
    expect(perms?.bash).toBe("allow");
  });
});
