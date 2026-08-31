import { runCommand, assertFileAccess, type SandboxConfig } from "../sandbox.ts";
import { assertTool, type AgentCapabilities } from "../permission.ts";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, realpathSync, lstatSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { redact } from "../../../anubis/src/redact.ts";
import { snapshotFile } from "../server/checkpoint.ts";
import { outlineSymbols, formatOutline } from "../symbols.ts";
import { diagnoseFile, formatDiagnostics } from "../diagnostics.ts";
import { isLocalUrl } from "../airgap.ts";

export interface ToolContext {
  cwd: string;
  filesWritten?: string[];
  mutations?: { count: number };
  signal?: AbortSignal;
  capabilities?: AgentCapabilities;
  sandbox?: SandboxConfig;
  history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

export function safePath(cwd: string, p: string): string {
  const root = resolve(cwd);
  const abs = resolve(cwd, p);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes project: ${p}`);
  }
  // Validate existing ancestors too: lexical containment does not stop symlinks.
  const realRoot = realpathSync(root);
  let ancestor = abs;
  while (!existsSync(ancestor)) {
    try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error(`broken symlink: ${p}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    ancestor = dirname(ancestor);
  }
  const realAncestor = realpathSync(ancestor);
  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + sep)) throw new Error(`symlink escapes project: ${p}`);
  return resolve(realAncestor, relative(ancestor, abs));
}

/** Run diagnostics (compiler/linter) on a file and return errors/warnings. */
export async function toolDiagnose(ctx: ToolContext, path: string): Promise<string> {
  safePath(ctx.cwd, path);
  assertFileAccess(resolve(ctx.cwd, path), false, ctx.cwd);
  const diags = await diagnoseFile(ctx.cwd, path, ctx);
  return `Diagnostics for ${path}:\n${formatDiagnostics(diags)}`;
}

/** Symbol outline of a file (functions/classes/imports) for code navigation. */
export function toolOutline(ctx: ToolContext, path: string): string {
  const abs = safePath(ctx.cwd, path);
  assertFileAccess(abs, false, ctx.cwd);
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  if (statSync(abs).isDirectory()) return `Error: ${path} is a directory; use LIST on it or READ a file inside it`;
  const src = readFileSync(abs, "utf-8");
  return `Outline of ${path}:\n${formatOutline(outlineSymbols(src))}`;
}

export function toolRead(ctx: ToolContext, path: string, offset = 1, limit = 200): string {
  const abs = safePath(ctx.cwd, path);
  assertTool(ctx.capabilities, "read");
  assertFileAccess(abs, false, ctx.cwd);
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  const st = statSync(abs);
  if (st.isDirectory()) return listDir(ctx, path);
  const lines = readFileSync(abs, "utf-8").split("\n");
  const slice = lines.slice(Math.max(0, offset - 1), offset - 1 + limit);
  return redact(slice.map((l, i) => `${offset + i}|${l}`).join("\n")).text;
}

export function toolWrite(ctx: ToolContext, path: string, content: string): string {
  const abs = safePath(ctx.cwd, path);
  assertTool(ctx.capabilities, "write");
  assertFileAccess(abs, true, ctx.cwd);
  // Empty content is almost always a truncated or malformed tool call, not
  // intent. Fail loudly so the model retries with the actual content.
  if (!content.trim()) return `Error: WRITE to ${path} had empty content; emit the full file body inside the tool call`;
  mkdirSync(dirname(abs), { recursive: true });
  // Snapshot before overwrite so the change is undoable.
  snapshotFile(ctx.cwd, path);
  // vibeguard: never write raw secrets into the project tree
  const safe = redact(content).text;
  writeFileSync(abs, safe, "utf-8");
  if (ctx.mutations) ctx.mutations.count++;
  if (ctx.filesWritten && !ctx.filesWritten.includes(abs)) ctx.filesWritten.push(abs);
  return `Wrote ${relative(ctx.cwd, abs)} (${safe.length} bytes)`;
}

export function toolEdit(ctx: ToolContext, path: string, oldStr: string, newStr: string): string {
  const abs = safePath(ctx.cwd, path);
  assertTool(ctx.capabilities, "edit");
  assertFileAccess(abs, true, ctx.cwd);
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  if (statSync(abs).isDirectory()) return `Error: ${path} is a directory; use LIST on it or READ a file inside it`;
  const content = readFileSync(abs, "utf-8");
  if (!content.includes(oldStr)) return `Error: old_string not found in ${path}`;
  if (!oldStr || content.split(oldStr).length !== 2) return `Error: old_string must match exactly once in ${path}`;
  snapshotFile(ctx.cwd, path);
  writeFileSync(abs, redact(content.replace(oldStr, newStr)).text, "utf-8");
  if (ctx.mutations) ctx.mutations.count++;
  if (ctx.filesWritten && !ctx.filesWritten.includes(abs)) ctx.filesWritten.push(abs);
  return `Edited ${relative(ctx.cwd, abs)}`;
}

export interface EditOp {
  old: string;
  new: string;
}

/**
 * Apply multiple edits to a single file atomically. Each `old` must be found
 * exactly once (or be unique); all edits are applied to the original content
 * in order. Snapshot is taken once before any change.
 */
export function toolMultiEdit(ctx: ToolContext, path: string, ops: EditOp[]): string {
  const abs = safePath(ctx.cwd, path);
  assertTool(ctx.capabilities, "multiedit");
  assertFileAccess(abs, true, ctx.cwd);
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  if (statSync(abs).isDirectory()) return `Error: ${path} is a directory; use LIST on it or READ a file inside it`;
  let content = readFileSync(abs, "utf-8");
  for (const op of ops) {
    if (!content.includes(op.old)) return `Error: old_string not found: ${op.old.slice(0, 40)}`;
    if (!op.old || content.split(op.old).length !== 2) return `Error: old_string must match exactly once in ${path}`;
    content = content.replace(op.old, op.new);
  }
  snapshotFile(ctx.cwd, path);
  writeFileSync(abs, redact(content).text, "utf-8");
  if (ctx.mutations) ctx.mutations.count++;
  if (ctx.filesWritten && !ctx.filesWritten.includes(abs)) ctx.filesWritten.push(abs);
  return `Edited ${relative(ctx.cwd, abs)} (${ops.length} edits)`;
}

export async function toolGlob(ctx: ToolContext, pattern: string): Promise<string> {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for await (const m of glob.scan({ cwd: ctx.cwd, onlyFiles: true })) {
    matches.push(m);
    if (matches.length >= 100) break;
  }
  return matches.join("\n") || "(no matches)";
}

export async function toolGrep(ctx: ToolContext, pattern: string, globPat = "**/*"): Promise<string> {
  try {
    const result = await runCommand(ctx, ["rg", "-l", "--glob", globPat, "--", pattern], { tool: "grep", timeoutMs: 10000 });
    if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr || "rg failed");
    return result.stdout.trim() || "(no matches)";
  } catch {
    ctx.signal?.throwIfAborted();
    const hits: string[] = [];
    const glob = new Bun.Glob(globPat === "**/*" ? "**/*" : globPat);
    for await (const m of glob.scan({ cwd: ctx.cwd, onlyFiles: true })) {
      try {
        const path = safePath(ctx.cwd, m); assertFileAccess(path, false, ctx.cwd);
        if (readFileSync(path, "utf-8").includes(pattern)) hits.push(m);
      } catch {
        /* skip */
      }
      if (hits.length >= 50) break;
    }
    return hits.join("\n") || "(no matches)";
  }
}

export async function toolBash(ctx: ToolContext, command: string, timeoutMs = 60000): Promise<string> {
  const safe = redact(command).text;
  const result = await runCommand(ctx, ["/bin/bash", "-c", safe], { timeoutMs });
  return redact(`$ ${safe}\n[${result.sandbox}]\nexit ${result.code ?? "signal"}${result.timedOut ? " (timeout)" : ""}\n${result.stdout}${result.stderr ? `\nstderr:\n${result.stderr}` : ""}`.trim()).text;
}

export async function toolWebFetch(url: string, timeoutMs = 15000, airgap = false, signal?: AbortSignal): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `Error: invalid URL: ${url}`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `Error: unsupported protocol: ${u.protocol}`;
  }
  if (airgap && !isLocalUrl(u.host)) {
    return `Error: webfetch blocked in air-gapped mode (${u.host})`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), { signal: signal ? AbortSignal.any([ctrl.signal, signal]) : ctrl.signal, redirect: "follow" });
    const text = await res.text();
    // Strip <script>/<style> to keep the payload lean for the model.
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `HTTP ${res.status} ${u.host}\n${stripped.slice(0, 4000)}`;
  } catch (e) {
    return `Error: fetch failed: ${String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

const TODO_FILE = ".ra/todos.json";

function loadTodos(ctx: ToolContext): TodoItem[] {
  const abs = safePath(ctx.cwd, TODO_FILE);
  if (!existsSync(abs)) return [];
  try {
    return JSON.parse(readFileSync(abs, "utf-8")) as TodoItem[];
  } catch {
    return [];
  }
}

function saveTodos(ctx: ToolContext, todos: TodoItem[]): void {
  const abs = safePath(ctx.cwd, TODO_FILE);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(todos, null, 2), "utf-8");
}

/**
 * TODO tool — track a task list. Syntax:
 *   TODO add <text>          add an item
 *   TODO done <id>           mark an item complete
 *   TODO list                show the list
 */
export function toolTodo(ctx: ToolContext, command: string): string {
  const todos = loadTodos(ctx);
  const [op, ...rest] = command.trim().split(/\s+/);
  const arg = rest.join(" ").trim();

  if (op === "add") {
    if (!arg) return "Error: TODO add requires text";
    const id = (todos.length ? Math.max(...todos.map((t) => t.id)) : 0) + 1;
    todos.push({ id, text: arg, done: false });
    saveTodos(ctx, todos);
    return `Added todo #${id}: ${arg}`;
  }
  if (op === "done") {
    const id = Number(arg);
    const item = todos.find((t) => t.id === id);
    if (!item) return `Error: no todo #${arg}`;
    item.done = true;
    saveTodos(ctx, todos);
    return `Completed todo #${id}: ${item.text}`;
  }
  if (op === "rm") {
    const id = Number(arg);
    const idx = todos.findIndex((t) => t.id === id);
    if (idx === -1) return `Error: no todo #${arg}`;
    const [removed] = todos.splice(idx, 1);
    saveTodos(ctx, todos);
    return `Removed todo #${id}: ${removed.text}`;
  }
  if (op === "list" || op === "") {
    if (!todos.length) return "(no todos)";
    return todos.map((t) => `${t.done ? "[x]" : "[ ]"} #${t.id} ${t.text}`).join("\n");
  }
  return `Error: unknown TODO op '${op}' (use add/done/rm/list)`;
}

/** Read the project todo list (for the /todos TUI command). */
export function listTodos(ctx: ToolContext): TodoItem[] {
  return loadTodos(ctx);
}

/** Render the todo list as a user-facing checklist. */
export function formatTodos(todos: TodoItem[]): string {
  if (!todos.length) return "(no todos — the agent adds them via TODO add)";
  return todos.map((t) => `${t.done ? "\u2611" : "\u2610"} #${t.id} ${t.text}`).join("\n");
}

/**
 * Expand `@path` mentions in a prompt into the referenced file's content.
 * A mention like `@src/foo.ts` is replaced with a fenced block of that file.
 * Unresolvable mentions are left as-is (so the model can still see the token).
 */
export function expandMentions(input: string, cwd: string): string {
  return input.replace(/@([^\s@]+)/g, (full, path: string) => {
    // Skip email-like tokens and bare @.
    if (!path || path.includes("@")) return full;
    try {
      const abs = safePath(cwd, path);
      if (!existsSync(abs) || statSync(abs).isDirectory()) return full;
      const content = readFileSync(abs, "utf-8");
      return `\`\`\`${path}\n${content}\n\`\`\``;
    } catch {
      return full;
    }
  });
}

export function listDir(ctx: ToolContext, dir = "."): string {
  const abs = safePath(ctx.cwd, dir);
  if (!existsSync(abs)) return `Error: not found: ${dir}`;
  return readdirSync(abs)
    .map((f) => {
      const s = statSync(join(abs, f));
      return `${s.isDirectory() ? "d" : "f"} ${f}`;
    })
    .join("\n");
}
