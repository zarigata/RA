import { describe, expect, test } from "bun:test";
import { classifyTier, tierModel } from "../../ra/src/tier.ts";
import { toolWrite, toolRead, toolEdit, safePath, toolWebFetch, toolTodo, toolMultiEdit } from "../../ra/src/tools/index.ts";
import { loadProjectMemory, loadAgentPermissions, loadAgentMeta } from "../../ra/src/agent.ts";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("task tier classifier", () => {
  test("plan is light/meta", () => {
    expect(classifyTier("plan the architecture", "plan")).toBe("meta");
  });
  test("code task is code tier", () => {
    expect(classifyTier("implement fibonacci function")).toBe("code");
  });
  test("mac-weak tier models", () => {
    const models = { meta: "ollama/gemma:latest", code: "ollama-lan/qwen3.8:latest" };
    expect(tierModel("meta", models)).toBe("ollama/gemma:latest");
    expect(tierModel("code", models)).toBe("ollama-lan/qwen3.8:latest");
  });

  test("default tier fallback is qwen3.8 on LAN", () => {
    expect(tierModel("meta")).toBe("ollama-lan/qwen3.8:latest");
  });
});

describe("RA tools", () => {
  test("write and read round-trip", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-tool-"));
    try {
      toolWrite({ cwd }, "test.txt", "hello RA");
      const out = toolRead({ cwd }, "test.txt");
      expect(out).toContain("hello RA");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("safePath blocks sibling prefix escape", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-safe-"));
    try {
      expect(() => safePath(cwd, "../evil.txt")).toThrow(/escapes/);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("toolEdit replaces substring", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-edit-"));
    try {
      toolWrite({ cwd }, "a.txt", "hello world");
      const note = toolEdit({ cwd }, "a.txt", "world", "RA");
      expect(note).toContain("Edited");
      expect(toolRead({ cwd }, "a.txt")).toContain("hello RA");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("toolMultiEdit applies multiple edits atomically", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-multi-"));
    try {
      toolWrite({ cwd }, "a.txt", "foo bar baz");
      const note = toolMultiEdit({ cwd }, "a.txt", [
        { old: "foo", new: "one" },
        { old: "baz", new: "three" },
      ]);
      expect(note).toContain("2 edits");
      expect(toolRead({ cwd }, "a.txt")).toContain("one bar three");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("toolMultiEdit fails if an old string is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-multi-"));
    try {
      toolWrite({ cwd }, "a.txt", "foo bar");
      const note = toolMultiEdit({ cwd }, "a.txt", [
        { old: "foo", new: "one" },
        { old: "nope", new: "x" },
      ]);
      expect(note).toContain("old_string not found");
      // No partial application: file unchanged.
      expect(toolRead({ cwd }, "a.txt")).toContain("foo bar");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("toolWrite redacts secrets", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-redact-"));
    try {
      toolWrite({ cwd }, "leak.txt", "key=sk-abcdefghijklmnopqrstuvwxyz123456");
      const out = toolRead({ cwd }, "leak.txt");
      expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
      expect(out).toContain("VIBEGUARD");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("execToolBlock EDIT", () => {
  test("parses EDIT block", async () => {
    const { execToolBlock } = await import("../../ra/src/agent.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-editblk-"));
    try {
      toolWrite({ cwd }, "x.py", "print(1)\n");
      const r = await execToolBlock(
        { cwd },
        "EDIT x.py\n<<<<<<< OLD\nprint(1)\n=======\nprint(2)\n>>>>>>> NEW",
      );
      expect(r.note).toContain("Edited");
      expect(toolRead({ cwd }, "x.py")).toContain("print(2)");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("parses GLOB", async () => {
    const { execToolBlock } = await import("../../ra/src/agent.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-glob-"));
    try {
      toolWrite({ cwd }, "a.py", "x");
      const r = await execToolBlock({ cwd }, "GLOB *.py");
      expect(r.note).toContain("a.py");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("denies a tool when config forbids it", async () => {
    const { execToolBlock } = await import("../../ra/src/agent.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-deny-"));
    try {
      const cfg = { agent: {}, model: "x", permission: { tool: { write: "deny" } } };
      const r = await execToolBlock({ cwd }, "WRITE a.txt\n```\nhello\n```", cfg as never);
      expect(r.note).toContain("not permitted");
      expect(r.done).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("TASK spawns a subagent via injected spawn fn", async () => {
    const { execToolBlock } = await import("../../ra/src/agent.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-task-"));
    try {
      const r = await execToolBlock(
        { cwd },
        "TASK explore find the main function",
        undefined,
        null,
        async (role, task) => `[${role}] found main in ${task}`,
      );
      expect(r.note).toContain("Subagent explore result");
      expect(r.note).toContain("found main");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("TASK without spawn returns error", async () => {
    const { execToolBlock } = await import("../../ra/src/agent.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-task-"));
    try {
      const r = await execToolBlock({ cwd }, "TASK explore find main");
      expect(r.note).toContain("not available");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("MULTIEDIT parses multiple edit blocks", async () => {
    const { execToolBlock } = await import("../../ra/src/agent.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-multi-"));
    try {
      toolWrite({ cwd }, "a.txt", "foo bar baz");
      const r = await execToolBlock(
        { cwd },
        "MULTIEDIT a.txt\n<<<<<<< OLD\nfoo\n=======\none\n>>>>>>> NEW\n<<<<<<< OLD\nbaz\n=======\nthree\n>>>>>>> NEW",
      );
      expect(r.note).toContain("2 edits");
      expect(toolRead({ cwd }, "a.txt")).toContain("one bar three");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("project memory", () => {
  test("loads AGENTS.md when present", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-mem-"));
    try {
      toolWrite({ cwd }, "AGENTS.md", "Use tabs, not spaces.");
      const mem = loadProjectMemory(cwd);
      expect(mem).toContain("AGENTS.md");
      expect(mem).toContain("Use tabs");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("prefers AGENTS.md over RA.md", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-mem-"));
    try {
      toolWrite({ cwd }, "AGENTS.md", "from agents");
      toolWrite({ cwd }, "RA.md", "from ra");
      const mem = loadProjectMemory(cwd);
      expect(mem).toContain("from agents");
      expect(mem).not.toContain("from ra");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("returns empty when no memory file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-mem-"));
    try {
      expect(loadProjectMemory(cwd)).toBe("");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("agent permissions", () => {
  test("thoth denies edit and bash", () => {
    const perms = loadAgentPermissions("thoth");
    expect(perms).not.toBeNull();
    expect(perms?.edit).toBe("deny");
    expect(perms?.bash).toBe("deny");
    expect(perms?.webfetch).toBe("allow");
  });

  test("ptah allows edit and bash", () => {
    const perms = loadAgentPermissions("ptah");
    expect(perms?.edit).toBe("allow");
    expect(perms?.bash).toBe("allow");
  });

  test("unknown role returns null", () => {
    expect(loadAgentPermissions("nonexistent")).toBeNull();
  });

  test("loadAgentMeta reads steps and temperature", () => {
    const meta = loadAgentMeta("thoth");
    expect(meta.steps).toBe(10);
    expect(meta.temperature).toBe(0.1);
  });

  test("loadAgentMeta returns empty for unknown role", () => {
    expect(loadAgentMeta("nonexistent")).toEqual({});
  });
});

describe("todo tool", () => {
  test("add, list, done round-trip", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-todo-"));
    try {
      expect(toolTodo({ cwd }, "add write tests")).toContain("#1");
      expect(toolTodo({ cwd }, "add run linter")).toContain("#2");
      const list = toolTodo({ cwd }, "list");
      expect(list).toContain("[ ] #1 write tests");
      expect(list).toContain("[ ] #2 run linter");
      expect(toolTodo({ cwd }, "done 1")).toContain("Completed");
      expect(toolTodo({ cwd }, "list")).toContain("[x] #1");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("empty list and unknown op", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-todo-"));
    try {
      expect(toolTodo({ cwd }, "list")).toContain("(no todos)");
      expect(toolTodo({ cwd }, "bogus")).toContain("unknown TODO op");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("webfetch tool", () => {
  test("rejects non-http(s) URLs", async () => {
    const out = await toolWebFetch("file:///etc/passwd");
    expect(out).toContain("unsupported protocol");
  });

  test("rejects invalid URLs", async () => {
    const out = await toolWebFetch("not a url");
    expect(out).toContain("invalid URL");
  });

  test("fetches and strips HTML tags", async () => {
    const out = await toolWebFetch("https://example.com");
    expect(out).toContain("HTTP 200");
    expect(out).toContain("Example Domain");
    expect(out).not.toContain("<html");
  });
});
