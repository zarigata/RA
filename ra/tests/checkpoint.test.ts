import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotFile, restoreLatest, listCheckpoints, clearCheckpoints } from "../src/server/checkpoint.ts";

describe("checkpoint/undo", () => {
  test("snapshot then restore reverts a file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-cp-"));
    try {
      writeFileSync(join(cwd, "a.txt"), "original");
      snapshotFile(cwd, "a.txt");
      writeFileSync(join(cwd, "a.txt"), "modified");
      const restored = restoreLatest(cwd);
      expect(restored).toContain("a.txt");
      expect(readFileSync(join(cwd, "a.txt"), "utf-8")).toBe("original");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("snapshot of missing file returns null", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-cp-"));
    try {
      expect(snapshotFile(cwd, "nope.txt")).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("restore with no checkpoint returns empty", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-cp-"));
    try {
      expect(restoreLatest(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("multiple snapshots accumulate into one checkpoint", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-cp-"));
    try {
      writeFileSync(join(cwd, "a.txt"), "a");
      writeFileSync(join(cwd, "b.txt"), "b");
      snapshotFile(cwd, "a.txt");
      snapshotFile(cwd, "b.txt");
      const list = listCheckpoints(cwd);
      expect(list.length).toBe(1);
      expect(list[0].files).toContain("a.txt");
      expect(list[0].files).toContain("b.txt");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("clearCheckpoints removes all", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-cp-"));
    try {
      writeFileSync(join(cwd, "a.txt"), "a");
      snapshotFile(cwd, "a.txt");
      clearCheckpoints(cwd);
      expect(listCheckpoints(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
