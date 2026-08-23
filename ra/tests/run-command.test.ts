import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

function runCli(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("bun", [CLI, ...args], { encoding: "utf-8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("ra run (headless command)", () => {
  test("help documents ra run", () => {
    const { out } = runCli(["help"]);
    expect(out).toContain("ra run");
    expect(out).toContain("Headless");
  });

  test("run without a task exits non-zero with usage", () => {
    const { code, err } = runCli(["run"]);
    expect(code).not.toBe(0);
    expect(err).toContain("ra run");
    expect(err).toContain("missing task");
  });
});
