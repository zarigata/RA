import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotFile, restoreLatest, listCheckpoints, clearCheckpoints, checkpointContent } from "../src/server/checkpoint.ts";
import { RA_GLOBAL, projectStateKey } from "../../anubis/src/config.ts";

describe("checkpoint/undo", () => {
  test("checkpoint snapshots are owner-only on POSIX", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-cp-private-"));
    try {
      writeFileSync(join(cwd, "secret-source.txt"), "private source");
      snapshotFile(cwd, "secret-source.txt");
      expect(checkpointContent(cwd, "secret-source.txt")).toBe("private source");
      if (process.platform !== "win32") {
        const cp = listCheckpoints(cwd)[0];
        const stored = join(RA_GLOBAL, "checkpoints", projectStateKey(cwd), cp.id, "secret-source.txt");
        expect(statSync(stored).mode & 0o777).toBe(0o600);
      }
    } finally {
      clearCheckpoints(cwd);
      rmSync(cwd, { recursive: true });
    }
  });

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

  test("legacy-colliding project paths keep independent checkpoints", () => {
    const root = mkdtempSync(join(tmpdir(), "ra-cp-collision-"));
    const cwdA = join(root, "a", "b_c");
    const cwdB = join(root, "a_b", "c");
    try {
      mkdirSync(cwdA, { recursive: true });
      mkdirSync(cwdB, { recursive: true });
      writeFileSync(join(cwdA, "same.txt"), "A original");
      writeFileSync(join(cwdB, "same.txt"), "B original");
      snapshotFile(cwdA, "same.txt");
      snapshotFile(cwdB, "same.txt");
      writeFileSync(join(cwdA, "same.txt"), "A changed");
      writeFileSync(join(cwdB, "same.txt"), "B changed");

      restoreLatest(cwdA);
      restoreLatest(cwdB);
      expect(readFileSync(join(cwdA, "same.txt"), "utf-8")).toBe("A original");
      expect(readFileSync(join(cwdB, "same.txt"), "utf-8")).toBe("B original");
    } finally {
      clearCheckpoints(cwdA);
      clearCheckpoints(cwdB);
      rmSync(root, { recursive: true });
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
