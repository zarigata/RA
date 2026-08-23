import { describe, expect, test } from "bun:test";
import { createWorktree, removeWorktree, runSwarm } from "../src/swarm.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ra-swarm-repo-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "hello");
  spawnSync("git", ["add", "a.txt"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

describe("swarm mode", () => {
  test("createWorktree and removeWorktree", () => {
    const repo = initRepo();
    const root = mkdtempSync(join(tmpdir(), "ra-swarm-wt-"));
    try {
      const path = createWorktree(repo, "ra-swarm/t1", root);
      expect(path).toContain("ra-swarm/t1");
      removeWorktree(repo, "ra-swarm/t1", path);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("runSwarm runs tasks in parallel and merges", async () => {
    const repo = initRepo();
    const root = mkdtempSync(join(tmpdir(), "ra-swarm-wt-"));
    try {
      const results = await runSwarm(
        {
          repo,
          worktreeRoot: root,
          runAgent: async (wt, task) => {
            writeFileSync(join(wt, `${task.id}.txt`), task.prompt);
            spawnSync("git", ["add", "."], { cwd: wt });
            spawnSync("git", ["commit", "-q", "-m", task.id], { cwd: wt });
            return `did ${task.id}`;
          },
        },
        [
          { id: "one", prompt: "task one" },
          { id: "two", prompt: "task two" },
        ],
      );
      expect(results.length).toBe(2);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results[0].output).toBe("did one");
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
