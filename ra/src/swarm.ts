// Swarm mode — orchestrate N parallel agents on git worktrees with a
// merge/conflict-resolution pass.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface SwarmTask {
  id: string;
  prompt: string;
}

export interface SwarmResult {
  taskId: string;
  branch: string;
  ok: boolean;
  output: string;
}

export interface SwarmOptions {
  repo: string;
  baseBranch?: string;
  worktreeRoot?: string;
  /** Run one agent task in a worktree; return its output. */
  runAgent: (worktree: string, task: SwarmTask) => Promise<string>;
  /** Merge a branch back into base; return true on clean merge. */
  mergeBranch?: (branch: string) => boolean;
}

function git(args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** Create a git worktree for a task and return its path. */
export function createWorktree(repo: string, branch: string, root: string): string {
  const path = join(root, branch);
  mkdirSync(root, { recursive: true });
  const r = git(["worktree", "add", "-b", branch, path], repo);
  if (!r.ok) throw new Error(`worktree add failed: ${r.out}`);
  return path;
}

/** Remove a worktree and its branch. */
export function removeWorktree(repo: string, branch: string, path: string): void {
  git(["worktree", "remove", "--force", path], repo);
  git(["branch", "-D", branch], repo);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

/**
 * Run N tasks in parallel worktrees, then merge each branch back. Returns
 * per-task results. A task whose merge conflicts is reported as not-ok.
 */
export async function runSwarm(opts: SwarmOptions, tasks: SwarmTask[]): Promise<SwarmResult[]> {
  const root = opts.worktreeRoot ?? join(opts.repo, ".ra-swarm");
  const base = opts.baseBranch ?? "main";
  const results: SwarmResult[] = [];

  // Create worktrees and run agents in parallel.
  const runs = await Promise.all(
    tasks.map(async (task) => {
      const branch = `ra-swarm/${task.id}`;
      const path = createWorktree(opts.repo, branch, root);
      try {
        const output = await opts.runAgent(path, task);
        return { taskId: task.id, branch, path, ok: true, output };
      } catch (e) {
        return { taskId: task.id, branch, path, ok: false, output: String(e) };
      }
    }),
  );

  // Merge each branch back.
  for (const run of runs) {
    let merged = true;
    if (run.ok) {
      const merge = opts.mergeBranch
        ? opts.mergeBranch(run.branch)
        : git(["merge", "--no-ff", run.branch], opts.repo).ok;
      merged = merge;
    }
    results.push({ taskId: run.taskId, branch: run.branch, ok: run.ok && merged, output: run.output });
    removeWorktree(opts.repo, run.branch, run.path);
  }

  return results;
}
