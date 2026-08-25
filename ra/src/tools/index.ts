import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { redact } from "../../../anubis/src/redact.ts";
import { snapshotFile } from "../server/checkpoint.ts";
import { outlineSymbols, formatOutline } from "../symbols.ts";
import { diagnoseFile, formatDiagnostics } from "../diagnostics.ts";
import { isLocalUrl } from "../airgap.ts";

export interface ToolContext {
  cwd: string;
}

export function safePath(cwd: string, p: string): string {
  const root = resolve(cwd);
  const abs = resolve(cwd, p);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes project: ${p}`);
  }
  return abs;
}

/** Run diagnostics (compiler/linter) on a file and return errors/warnings. */
export async function toolDiagnose(ctx: ToolContext, path: string): Promise<string> {
  const diags = await diagnoseFile(ctx.cwd, path);
  return `Diagnostics for ${path}:\n${formatDiagnostics(diags)}`;
}

/** Symbol outline of a file (functions/classes/imports) for code navigation. */
export function toolOutline(ctx: ToolContext, path: string): string {
  const abs = safePath(ctx.cwd, path);
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  const src = readFileSync(abs, "utf-8");
  return `Outline of ${path}:\n${formatOutline(outlineSymbols(src))}`;
}

export function toolRead(ctx: ToolContext, path: string, offset = 1, limit = 200): string {
  const abs = safePath(ctx.cwd, path);
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  const st = statSync(abs);
  if (st.isDirectory()) return listDir(ctx, path);
  const lines = readFileSync(abs, "utf-8").split("\n");
  const slice = lines.slice(Math.max(0, offset - 1), offset - 1 + limit);
  return slice.map((l, i) => `${offset + i}|${l}`).join("\n");
}

export function toolWrite(ctx: ToolContext, path: string, content: string): string {
  const abs = safePath(ctx.cwd, path);
  mkdirSync(dirname(abs), { recursive: true });
  // Snapshot before overwrite so the change is undoable.
  snapshotFile(ctx.cwd, path);
  // vibeguard: never write raw secrets into the project tree
  const safe = redact(content).text;
  writeFileSync(abs, safe, "utf-8");
  return `Wrote ${relative(ctx.cwd, abs)} (${safe.length} bytes)`;
}

export function toolEdit(ctx: ToolContext, path: string, oldStr: string, newStr: string): string {
  const abs = safePath(ctx.cwd, path);
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  const content = readFileSync(abs, "utf-8");
  if (!content.includes(oldStr)) return `Error: old_string not found in ${path}`;
  snapshotFile(ctx.cwd, path);
  writeFileSync(abs, content.split(oldStr).join(newStr), "utf-8");
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
  if (!existsSync(abs)) return `Error: file not found: ${path}`;
  let content = readFileSync(abs, "utf-8");
  for (const op of ops) {
    if (!content.includes(op.old)) return `Error: old_string not found: ${op.old.slice(0, 40)}`;
    content = content.split(op.old).join(op.new);
  }
  snapshotFile(ctx.cwd, path);
  writeFileSync(abs, content, "utf-8");
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
    const proc = Bun.spawn(["rg", "-l", pattern, "--glob", globPat], {
      cwd: ctx.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim() || "(no matches)";
  } catch {
    const hits: string[] = [];
    const glob = new Bun.Glob(globPat === "**/*" ? "**/*" : globPat);
    for await (const m of glob.scan({ cwd: ctx.cwd, onlyFiles: true })) {
      try {
        if (readFileSync(join(ctx.cwd, m), "utf-8").includes(pattern)) hits.push(m);
      } catch {
        /* skip */
      }
      if (hits.length >= 50) break;
    }
    return hits.join("\n") || "(no matches)";
  }
}

export async function toolBash(ctx: ToolContext, command: string, timeoutMs = 60000): Promise<string> {
  // Strip secrets from the executed command (vibeguard)
  const safe = redact(command).text;
  const proc = Bun.spawn(["bash", "-c", safe], { cwd: ctx.cwd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return `$ ${safe}\nexit ${code}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`.trim();
}

export async function toolWebFetch(url: string, timeoutMs = 15000, airgap = false): Promise<string> {
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
    const res = await fetch(u.toString(), { signal: ctrl.signal, redirect: "follow" });
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
