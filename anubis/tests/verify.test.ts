import { describe, expect, test } from "bun:test";
import { verifyLastRun } from "../src/verify.ts";

describe("verifyLastRun", () => {
  test("empty run fails with RA verify header", async () => {
    const r = await verifyLastRun(null);
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain("RA verify");
  });

  test("missing file fails", async () => {
    const r = await verifyLastRun({
      task: "t",
      stages: ["thoth", "ptah"],
      models: ["qwen3.8:latest"],
      filesWritten: ["/tmp/ra-does-not-exist-xyz.py"],
      cwd: "/tmp",
      at: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.lines.some((l) => l.includes("missing"))).toBe(true);
  });

  test("html without doctype fails", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const cwd = mkdtempSync(join(tmpdir(), "ra-ver-"));
    try {
      const path = join(cwd, "index.html");
      writeFileSync(path, "<h1>Hi</h1>\n");
      const r = await verifyLastRun({
        task: "page",
        stages: ["thoth", "ptah"],
        models: ["qwen3.8:latest"],
        filesWritten: [path],
        cwd,
        ms: 1200,
        intent: "code",
        timings: [{ stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 1000 }],
        at: 1,
      });
      expect(r.ok).toBe(false);
      expect(r.lines.some((l) => l.includes("missing <!DOCTYPE"))).toBe(true);
      expect(r.lines.some((l) => l.includes("elapsed:"))).toBe(true);
      expect(r.lines.some((l) => l.includes("again: ra again"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("html with doctype passes", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const cwd = mkdtempSync(join(tmpdir(), "ra-verok-"));
    try {
      const path = join(cwd, "index.html");
      writeFileSync(path, "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>\n");
      const r = await verifyLastRun({
        task: "page",
        stages: ["thoth", "ptah"],
        models: ["qwen3.8:latest"],
        filesWritten: [path],
        cwd,
        ms: 900,
        intent: "code",
        timings: [{ stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 800 }],
        at: 1,
      });
      expect(r.ok).toBe(true);
      expect(r.lines.some((l) => l.startsWith("✓ html"))).toBe(true);
      expect(r.lines).toContain("RA verify OK");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
