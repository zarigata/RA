import { describe, expect, test } from "bun:test";
import { selfHeal } from "../src/selfheal.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("self-healing loop", () => {
  test("passes immediately when the test passes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-heal-"));
    try {
      const r = await selfHeal({
        cwd,
        files: ["a.py"],
        runTest: async () => true,
        attemptFix: async () => true,
      });
      expect(r.passed).toBe(true);
      expect(r.attempts).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("retries up to maxAttempts then logs to BUGS.md", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-heal-"));
    try {
      writeFileSync(join(cwd, "a.py"), "def foo(:\n    pass\n"); // broken
      let fixCalls = 0;
      const r = await selfHeal({
        cwd,
        files: ["a.py"],
        runTest: async () => false, // always fails
        attemptFix: async () => {
          fixCalls++;
          return true;
        },
        maxAttempts: 3,
      });
      expect(r.passed).toBe(false);
      expect(r.attempts).toBe(3);
      expect(fixCalls).toBe(3);
      // BUGS.md should have been written.
      expect(readFileSync(join(cwd, "BUGS.md"), "utf-8")).toContain("Self-heal failure");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("stops when no diagnostics are produced", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-heal-"));
    try {
      writeFileSync(join(cwd, "a.txt"), "not code"); // no diagnostics
      const r = await selfHeal({
        cwd,
        files: ["a.txt"],
        runTest: async () => false,
        attemptFix: async () => true,
        maxAttempts: 3,
      });
      expect(r.attempts).toBe(1); // stopped after first failure (no diagnostics)
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
