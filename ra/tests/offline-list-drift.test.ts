// Drift guard: every offline-safe test file must be registered in
// scripts/offline-tests.txt — the single source of truth CI and
// verify-release.sh consume. A missing entry means the file never runs
// in CI (this exact drift shipped 29 anubis files outside CI on
// 2026-11-10; found during the Wave 6 release audit).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const list = readFileSync(join(root, "scripts", "offline-tests.txt"), "utf8");

describe("offline-tests.txt registration", () => {
  test("every ra/tests/*.test.ts file is registered", () => {
    const onDisk = readdirSync(join(root, "ra", "tests")).filter((f) =>
      f.endsWith(".test.ts"),
    );
    expect(onDisk.length).toBeGreaterThan(50); // sanity: suite hasn't vanished
    const missing = onDisk.filter((f) => !list.includes(`ra/tests/${f}`));
    expect(missing).toEqual([]);
  });

  test("every anubis/tests/*.test.ts file is registered", () => {
    const onDisk = readdirSync(join(root, "anubis", "tests")).filter((f) =>
      f.endsWith(".test.ts"),
    );
    expect(onDisk.length).toBeGreaterThan(30); // sanity
    const missing = onDisk.filter((f) => !list.includes(`tests/${f}`));
    expect(missing).toEqual([]);
  });

  test("registered entries exist on disk (no stale ghost entries)", () => {
    const ghosts = list
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .filter((rel) => {
        const p = rel.startsWith("ra/")
          ? join(root, rel)
          : join(root, "anubis", rel);
        return !exists(p);
      });
    expect(ghosts).toEqual([]);
  });
});

function exists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
