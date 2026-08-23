import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureBenchmarkArtifacts } from "../src/benchmark/runner.ts";

describe("ensureBenchmarkArtifacts", () => {
  test("writes hello index when missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-bench-"));
    try {
      ensureBenchmarkArtifacts({ cwd }, "Create index.html hello world page");
      expect(existsSync(join(cwd, "index.html"))).toBe(true);
      expect(readFileSync(join(cwd, "index.html"), "utf-8").toLowerCase()).toContain("hello");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("writes cookie when prompted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-bench-"));
    try {
      ensureBenchmarkArtifacts({ cwd }, "Build a cookie recipe website");
      expect(readFileSync(join(cwd, "index.html"), "utf-8").toLowerCase()).toContain("cookie");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
