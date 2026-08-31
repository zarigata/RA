// Coding teams work on isolated branches. Applying results is an explicit, atomic fast-forward.
import { runGitCommand } from "./sandbox.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { settledPool, checkRun, runSignal } from "./execution.ts";
import { redact } from "../../anubis/src/redact.ts";

export interface SwarmTask { id: string; prompt: string; model?: string; files?: string[] }
export interface SwarmResult {
  taskId: string;
  branch: string;
  ok: boolean;
  output: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  worktree?: string;
  commit?: string;
  model?: string;
  files?: string[];
  error?: string;
}
export interface SwarmManifest {
  id: string;
  repo: string;
  base: string;
  baseRef: string;
  created: number;
  status: "running" | "ready" | "partial" | "failed" | "cancelled" | "conflict" | "applied";
  concurrency: number;
  tasks: SwarmTask[];
  results: SwarmResult[];
  integrationWorktree?: string;
  integrationBranch?: string;
  conflicts?: string[];
  error?: string;
}
export interface SwarmOptions {
  repo: string;
  baseBranch?: string;
  worktreeRoot?: string;
  concurrency?: number;
  runAgent: (worktree: string, task: SwarmTask) => Promise<string | { output: string; model: string }>;
  onProgress?: (message: string) => void;
  /** Legacy programmatic hook; the CLI always uses transactional apply. */
  mergeBranch?: (branch: string) => boolean;
}
function git(args: string[], cwd: string): { ok: boolean; out: string } {
  return runGitCommand(args, cwd);
}
function mustGit(args: string[], cwd: string, raw = false): string {
  const result = git(args, cwd);
  if (!result.ok) throw new Error(`git ${args[0]} failed: ${result.out.trim()}`);
  return raw ? result.out : result.out.trim();
}
function repository(cwd: string): string { return resolve(mustGit(["rev-parse", "--show-toplevel"], cwd)); }
function storeRoot(repo: string): string { return join(resolve(repo, mustGit(["rev-parse", "--git-common-dir"], repo)), "ra-swarms"); }
function clean(repo: string): void {
  if (mustGit(["status", "--porcelain", "--untracked-files=all"], repo)) throw new Error("Working tree is not clean. Commit or stash your changes before swarm work; RA will not stash them for you.");
}
function validId(id: string): boolean { return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id); }
function manifestPath(repo: string, id: string): string {
  if (!validId(id)) throw new Error("Invalid swarm ID");
  return join(storeRoot(repo), id, "manifest.json");
}
function save(manifest: SwarmManifest): void {
  const path = manifestPath(manifest.repo, manifest.id);
  mkdirSync(join(storeRoot(manifest.repo), manifest.id), { recursive: true });
  writeFileSync(path + ".tmp", redact(JSON.stringify(manifest, null, 2)).text + "\n", "utf-8");
  renameSync(path + ".tmp", path);
}
export function loadSwarm(cwd: string, id: string): SwarmManifest {
  const repo = repository(cwd);
  const path = manifestPath(repo, id);
  if (!existsSync(path)) throw new Error(`Swarm not found: ${id}`);
  const manifest = JSON.parse(readFileSync(path, "utf-8")) as SwarmManifest;
  if (manifest.id !== id || manifest.repo !== repo || !Array.isArray(manifest.results)) throw new Error("Invalid swarm manifest");
  return manifest;
}
export function listSwarms(cwd: string): SwarmManifest[] {
  const repo = repository(cwd), root = storeRoot(repo);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(validId).flatMap(id => {
    try { return [loadSwarm(repo, id)]; } catch { return []; }
  }).sort((a, b) => b.created - a.created);
}
export function validateTasks(value: unknown): SwarmTask[] {
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error("Swarm needs an array of 1–16 tasks");
  const ids = new Set<string>();
  return value.map((task: SwarmTask) => {
    if (!task || typeof task.id !== "string" || !validId(task.id) || ids.has(task.id)) throw new Error("Task IDs must be unique letters, numbers, underscores or hyphens (max 64)");
    if (typeof task.prompt !== "string" || !task.prompt.trim() || task.prompt.length > 100_000) throw new Error(`Task ${task.id} needs a nonempty prompt (max 100000 characters)`);
    if (task.model !== undefined && (typeof task.model !== "string" || !task.model.trim())) throw new Error(`Invalid model for ${task.id}`);
    if (task.files !== undefined && (!Array.isArray(task.files) || !task.files.length || task.files.some(p => typeof p !== "string" || !p || isAbsolute(p) || p.split(/[\\/]/).some(x => x === ".." || x === ".git")))) throw new Error(`Invalid file ownership for ${task.id}`);
    ids.add(task.id);
    return { id: task.id, prompt: task.prompt, model: task.model, files: task.files };
  });
}
export function createWorktree(repo: string, branch: string, root: string, base = "HEAD"): string {
  const path = resolve(root, branch);
  if (relative(resolve(root), path).startsWith("..")) throw new Error("Worktree path escapes root");
  mkdirSync(root, { recursive: true });
  mustGit(["worktree", "add", "-b", branch, path, base], repo);
  return path;
}
/** Explicit cleanup only; never called automatically on failed or conflicted work. */
export function removeWorktree(repo: string, branch: string, path: string): void {
  mustGit(["worktree", "remove", path], repo);
  mustGit(["branch", "-d", branch], repo);
}

export async function startSwarm(options: SwarmOptions, input: unknown): Promise<SwarmManifest> {
  const tasks = validateTasks(input), repo = repository(options.repo);
  clean(repo);
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("concurrency must be an integer from 1 to 16");
  const base = mustGit(["rev-parse", "--verify", `${options.baseBranch ?? "HEAD"}^{commit}`], repo);
  const baseRef = mustGit(["symbolic-ref", "HEAD"], repo);
  if (base !== mustGit(["rev-parse", "HEAD"], repo)) throw new Error("Swarm base must match the checked-out commit");
  const id = `swarm-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const manifest: SwarmManifest = {
    id, repo, base, baseRef, created: Date.now(), status: "running", concurrency, tasks,
    results: tasks.map(task => ({ taskId: task.id, branch: `codex/ra-${id}/${task.id}`, status: "queued", ok: false, output: "" })),
  };
  save(manifest);
  const root = options.worktreeRoot ?? join(storeRoot(repo), id, "worktrees");
  const settled = await settledPool(tasks, concurrency, async (task, i) => {
    const result = manifest.results[i];
    try {
      checkRun();
      result.worktree = createWorktree(repo, result.branch, root, base);
      result.status = "running";
      save(manifest);
      options.onProgress?.(`${task.id}: started in ${result.worktree}`);
      const answer = await options.runAgent(result.worktree, task);
      checkRun();
      result.output = typeof answer === "string" ? answer : answer.output;
      result.model = typeof answer === "string" ? undefined : answer.model;
      mustGit(["add", "--all"], result.worktree);
      const files = mustGit(["diff", "--cached", "--name-only", "-z"], result.worktree, true).split("\0").filter(Boolean);
      if (!files.length) throw new Error("Agent produced no changed files; no commit was created");
      if (task.files) {
        const outside = files.filter(file => !task.files!.some(owned => owned.endsWith("/") ? file.startsWith(owned) : file === owned));
        if (outside.length) throw new Error(`Task changed files outside its ownership: ${outside.join(", ")}`);
      }
      mustGit(["-c", "user.name=RA", "-c", "user.email=ra@localhost", "-c", "commit.gpgsign=false", "commit", "-m", `feat: add swarm task ${task.id}`.slice(0, 50)], result.worktree);
      result.commit = mustGit(["rev-parse", "HEAD"], result.worktree);
      result.files = files;
      result.status = "ready";
      result.ok = true;
      options.onProgress?.(`${task.id}: ready [${result.model ?? "agent"}] · ${files.length} files`);
    } catch (e) {
      result.status = runSignal()?.aborted ? "cancelled" : "failed";
      result.error = redact(String(e)).text;
      options.onProgress?.(`${task.id}: ${result.status} · ${result.error}`);
    }
    save(manifest);
    return result;
  });
  settled.forEach((result, i) => {
    if (result.status === "rejected") Object.assign(manifest.results[i], { status: runSignal()?.aborted ? "cancelled" : "failed", error: redact(String(result.reason)).text });
  });
  const ready = manifest.results.filter(r => r.ok).length;
  manifest.status = runSignal()?.aborted ? "cancelled" : ready === tasks.length ? "ready" : ready ? "partial" : "failed";
  save(manifest);
  return manifest;
}

/** All merges occur in a retained integration worktree. The user's branch changes only on success. */
export function applySwarm(cwd: string, id: string): SwarmManifest {
  const manifest = loadSwarm(cwd, id), repo = manifest.repo;
  if (manifest.status === "applied") return manifest;
  if (!manifest.results.every(r => r.status === "ready" && r.commit)) throw new Error("All swarm tasks must be ready before apply. Failed worktrees are preserved for inspection.");
  clean(repo);
  if (mustGit(["rev-parse", "HEAD"], repo) !== manifest.base || mustGit(["symbolic-ref", "HEAD"], repo) !== manifest.baseRef) throw new Error("The target branch moved since this swarm started. Nothing was applied.");
  if (!manifest.integrationWorktree) {
    manifest.integrationBranch = `codex/ra-${id}/integration`;
    manifest.integrationWorktree = createWorktree(repo, manifest.integrationBranch, join(storeRoot(repo), id, "integration"), manifest.base);
    save(manifest);
  }
  const integration = manifest.integrationWorktree;
  clean(integration);
  for (const result of manifest.results) {
    if (!result.commit || !/^[0-9a-f]{40,64}$/.test(result.commit)) throw new Error("Invalid task commit");
    if (git(["merge-base", "--is-ancestor", result.commit, "HEAD"], integration).ok) continue;
    const merged = git(["-c", "user.name=RA", "-c", "user.email=ra@localhost", "-c", "commit.gpgsign=false", "merge", "--no-ff", "--no-edit", result.commit], integration);
    if (!merged.ok) {
      manifest.status = "conflict";
      manifest.conflicts = mustGit(["diff", "--name-only", "--diff-filter=U"], integration).split("\n").filter(Boolean);
      manifest.error = `Merge failed for ${result.taskId}. Resolve and commit in ${integration}, then run ra swarm apply ${id}. ${merged.out.trim()}`;
      save(manifest);
      return manifest;
    }
  }
  clean(repo);
  if (mustGit(["rev-parse", "HEAD"], repo) !== manifest.base || mustGit(["symbolic-ref", "HEAD"], repo) !== manifest.baseRef) throw new Error("Target changed during integration; nothing applied");
  const integratedCommit = mustGit(["rev-parse", "HEAD"], integration);
  mustGit(["merge", "--ff-only", "--no-overwrite-ignore", integratedCommit], repo);
  manifest.status = "applied";
  manifest.error = undefined;
  manifest.conflicts = [];
  save(manifest);
  return manifest;
}
export function formatSwarm(manifest: SwarmManifest): string {
  return [
    `RA swarm ${manifest.id} · ${manifest.status} · concurrency ${manifest.concurrency}`,
    ...manifest.results.map(r => `  ${r.status}: ${r.taskId}${r.model ? ` [${r.model}]` : ""}\n    branch: ${r.branch}${r.worktree ? `\n    worktree: ${r.worktree}` : ""}${r.error ? `\n    error: ${r.error}` : ""}`),
    manifest.error ?? "",
    manifest.status === "ready" ? `Review the branches, then: ra swarm apply ${manifest.id}` : "",
    "Task branches and worktrees are retained. No automatic force-cleanup is performed.",
  ].filter(Boolean).join("\n");
}
/** Programmatic compatibility; callers opt into merge behavior explicitly. */
export async function runSwarm(options: SwarmOptions, tasks: SwarmTask[]): Promise<SwarmResult[]> {
  const result = await startSwarm(options, tasks);
  if (options.mergeBranch) for (const task of result.results) if (task.ok) task.ok = options.mergeBranch(task.branch);
  return result.results;
}
