import { describe, expect, test } from "bun:test";
import { execToolBlock } from "../src/agent.ts";
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
});
