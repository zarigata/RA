import { describe, expect, test } from "bun:test";
import { execToolBlock, splitToolBlocks } from "../src/agent.ts";
import { resolveCapabilities } from "../src/permission.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctx = (cwd: string) => ({
  cwd,
  capabilities: resolveCapabilities({} as RaConfig, {}, undefined, [], undefined),
  mutations: { count: 0 },
});

describe("bare-fence recovery", () => {
  test("glm-style unlabeled fence with a filename in prose writes the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-fence-"));
    const content = "Here is hello.py:\n```python\ndef hello():\n    print(\"hello world\")\n```\n";
    const r = await execToolBlock(ctx(dir), content, undefined, null, undefined, [], undefined);
    expect(r.note).toContain("wrote hello.py");
    const written = readFileSync(join(dir, "hello.py"), "utf8");
    expect(written).toContain("def hello():");
    expect(written).not.toContain("WRITE"); // never write the verb literally
  });

  test("WRITE verb nested inside the fence is honored, not written literally", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-fence-"));
    const content = "```python\nWRITE hello.py\n\ndef hello():\n    return \"hello\"\n```\n";
    const r = await execToolBlock(ctx(dir), content, undefined, null, undefined, [], undefined);
    expect(r.note).toContain("wrote hello.py");
    const written = readFileSync(join(dir, "hello.py"), "utf8");
    expect(written).not.toContain("WRITE");
    expect(written).toContain("def hello():");
  });

  test("bare fence with no filename anywhere does not write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-fence-"));
    const content = "```python\nprint('x')\n```";
    const r = await execToolBlock(ctx(dir), content, undefined, null, undefined, [], undefined);
    expect(r.note).not.toContain("wrote");
  });

  test("batched tool calls all execute in order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-fence-"));
    const batched = [
      "WRITE hello.py",
      "```",
      "def hello():",
      "    print('hello')",
      "```",
      "READ hello.py",
    ].join("\n");
    const r = await execToolBlock(ctx(dir), batched, undefined, null, undefined, [], undefined);
    expect(r.note).toContain("hello.py");
    expect(r.note).toContain("def hello():"); // READ result joined too
    expect(readFileSync(join(dir, "hello.py"), "utf8")).toContain("def hello():");
  });

  test("splitToolBlocks keeps fenced bodies intact", () => {
    const content = 'WRITE a.py\n```\nBASH is not a verb here\n```\nBASH echo hi';
    const blocks = splitToolBlocks(content);
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("BASH is not a verb here");
    expect(blocks[1]!.trim()).toBe("BASH echo hi");
  });
});
