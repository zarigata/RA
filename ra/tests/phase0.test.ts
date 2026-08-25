import { describe, expect, test } from "bun:test";
import { withRetry, isTransientError, surfaceDisagreements } from "../src/agent.ts";
import { loadCustomCommands, customCommandDirs } from "../src/commands/index.ts";
import { toolTodo, listTodos, formatTodos } from "../src/tools/index.ts";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

describe("withRetry", () => {
  test("retries transient errors once, then succeeds", async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      calls++;
      if (calls === 1) throw new Error("nativeChatStream timeout after 5000ms");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls).toBe(2);
  });

  test("permanent errors pass through without retry", async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new Error("chatStream 401: unauthorized");
      });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain("401");
    }
    expect(calls).toBe(1);
  });

  test("exhausts retries on persistent transient failure", async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new Error("fetch failed: ECONNRESET");
      });
      expect.unreachable();
    } catch {
      /* expected */
    }
    expect(calls).toBe(2);
  });
});

describe("isTransientError", () => {
  test("timeouts, resets, 5xx, fetch-failed are transient", () => {
    expect(isTransientError(new Error("chat timeout after 180000ms"))).toBe(true);
    expect(isTransientError(new Error("fetch failed: ECONNREFUSED"))).toBe(true);
    expect(isTransientError(new Error("nativeChat 503: busy"))).toBe(true);
  });
  test("auth and 404 are permanent", () => {
    expect(isTransientError(new Error("chat 401: bad key"))).toBe(false);
    expect(isTransientError(new Error("nativeChat 404: model not found"))).toBe(false);
  });
});

describe("surfaceDisagreements", () => {
  test("flags files only some roles considered", () => {
    const notes = surfaceDisagreements([
      { role: "thoth", model: "qwen", output: "Edit src/a.ts and src/b.ts" },
      { role: "ptah", model: "glm", output: "Rewrite src/a.ts only" },
    ]);
    expect(notes.some((n) => n.includes("src/b.ts"))).toBe(true);
  });

  test("flags mixed success/failure", () => {
    const notes = surfaceDisagreements([
      { role: "maat", model: "qwen", output: "Error: cannot read file" },
      { role: "sekhmet", model: "qwen", output: "Looks fine, ship it" },
    ]);
    expect(notes.some((n) => n.includes("maat"))).toBe(true);
  });

  test("no disagreements when outputs agree", () => {
    const notes = surfaceDisagreements([
      { role: "thoth", model: "qwen", output: "Plan: touch src/a.ts" },
      { role: "ptah", model: "glm", output: "Wrote src/a.ts per plan" },
    ]);
    expect(notes).toEqual([]);
  });
});

describe("custom commands (multi-dir + args)", () => {
  test("loads from project and user dirs, project wins on name clash", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-cmd-proj-"));
    const user = mkdtempSync(join(tmpdir(), "ra-cmd-user-"));
    try {
      writeFileSync(join(proj, "review.md"), "---\nname: review\ndescription: project version\nagent: maat\n---\nReview $ARGUMENTS carefully.\n");
      writeFileSync(join(user, "review.md"), "---\nname: review\n---\nUser version.\n");
      writeFileSync(join(user, "ship.md"), "---\nname: ship\ndescription: ship it\n---\nShip $1 to $2.\n");
      const cmds = loadCustomCommands([join(proj, "nonexistent"), proj, user]); // bad dir skipped, project wins
      expect(cmds.map((c) => c.name)).toEqual(["review", "ship"]);
      const review = cmds.find((c) => c.name === "review")!;
      expect(review.agent).toBe("maat");
      expect(review.prompt).toContain("Review $ARGUMENTS");
      const ship = cmds.find((c) => c.name === "ship")!;
      expect(ship.prompt).toContain("Ship $1 to $2.");
    } finally {
      rmSync(proj, { recursive: true });
      rmSync(user, { recursive: true });
    }
  });

  test("customCommandDirs includes project .ra/commands and user home", () => {
    const dirs = customCommandDirs("/tmp/proj");
    expect(dirs[0]).toBe(join("/tmp/proj", ".ra", "commands"));
    expect(dirs[1]).toBe(join(process.env.HOME ?? "", ".ra", "commands"));
  });
});

describe("todos tool", () => {
  test("add, rm, and user-facing format", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-todos2-"));
    try {
      expect(toolTodo({ cwd }, "add write tests")).toContain("Added todo #1");
      expect(toolTodo({ cwd }, "add ship it")).toContain("Added todo #2");
      expect(toolTodo({ cwd }, "rm 2")).toContain("Removed todo #2");
      const todos = listTodos({ cwd });
      expect(todos).toHaveLength(1);
      expect(formatTodos(todos)).toContain("#1 write tests");
      expect(formatTodos(todos)).toContain("☐");
      mkdirSync(join(cwd, "x"), { recursive: true }); // keep fs warm
      expect(formatTodos([])).toContain("no todos");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
