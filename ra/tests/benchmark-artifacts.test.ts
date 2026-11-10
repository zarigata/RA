import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureBenchmarkArtifacts, benchmarkInit, setBenchmarkRoot, getBenchmarkRoot, scenarioCwdUnderRoot, BENCHMARK_ROOT } from "../src/benchmark/runner.ts";

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

describe("benchmark --cwd (D3)", () => {
  afterEach(() => setBenchmarkRoot(BENCHMARK_ROOT));

  test("init with --cwd creates scenario dirs under the given root", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-bench-cwd-"));
    try {
      setBenchmarkRoot(dir);
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (s: string) => logs.push(String(s));
      try { benchmarkInit(); } finally { console.log = origLog; }
      for (const d of ["runs", "cookie-website", "todo-app", "fix-bug", "smoke"]) {
        expect(existsSync(join(dir, d))).toBe(true);
      }
      expect(getBenchmarkRoot()).toBe(dir);
      expect(logs.join("\n")).toContain(dir);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("scenario cwd re-anchors under the override root, keeps trailing path", () => {
    const dir = join(tmpdir(), "ra-bench-alt-root");
    setBenchmarkRoot(dir);
    expect(scenarioCwdUnderRoot("~/Desktop/RA-Tests/smoke")).toBe(join(dir, "smoke"));
    expect(scenarioCwdUnderRoot("~/Desktop/RA-Tests/cookie-website")).toBe(join(dir, "cookie-website"));
    // non-default scenario dirs pass through untouched
    expect(scenarioCwdUnderRoot("/tmp/elsewhere/x")).toBe("/tmp/elsewhere/x");
    setBenchmarkRoot(BENCHMARK_ROOT);
    expect(scenarioCwdUnderRoot("~/Desktop/RA-Tests/smoke")).toBe(join(BENCHMARK_ROOT, "smoke"));
  });
});
