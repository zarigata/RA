import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCustomCommands } from "../src/commands/index.ts";

describe("custom slash commands", () => {
  test("loads Markdown commands with frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-cmd-"));
    try {
      writeFileSync(
        join(dir, "summarize.md"),
        "---\nname: summarize\ndescription: Summarize a file\n---\nSummarize the given input concisely.",
      );
      const cmds = loadCustomCommands(dir);
      expect(cmds.length).toBe(1);
      expect(cmds[0].name).toBe("summarize");
      expect(cmds[0].description).toBe("Summarize a file");
      expect(cmds[0].prompt).toContain("Summarize");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("skips files without frontmatter or prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-cmd-"));
    try {
      writeFileSync(join(dir, "bad.md"), "no frontmatter here");
      writeFileSync(join(dir, "noprompt.md"), "---\nname: x\n---\n");
      expect(loadCustomCommands(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("returns empty for missing dir", () => {
    expect(loadCustomCommands("/nonexistent/dir/xyz")).toEqual([]);
  });
});
