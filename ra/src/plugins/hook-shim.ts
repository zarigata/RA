// hook-shim.ts — runtime for imported Claude-Code-style command hooks.
// SECURITY: default-deny. Nothing here runs until (a) the user imported the
// entry with `--with-hooks` (or re-imported after opting in) AND (b) ra.json
// says `plugin_runtime.hooks: "on"` (or RA_PLUGIN_HOOKS=on). Every handler
// runs via the shell with a per-hook timeout (default 30 s, kill on expiry)
// and receives a secret-redacted JSON session context on stdin.
//
// Claude Code decision protocol:
//   exit 0                → allow / continue
//   exit 2                → block (stderr feeds back to the model)
//   stdout JSON {"decision":"block","reason"} → block
//   stdout JSON hookSpecificOutput.permissionDecision "deny"|"ask"|"allow"
//   anything else         → non-blocking error (logged, execution continues)

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";
import { redact } from "../../../anubis/src/redact.ts";

/** One command handler inside a Claude hooks block. */
export interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}

/** A matcher group as written in settings.json / plugin.json hooks. */
export interface HookMatcherGroup {
  matcher?: string;
  hooks?: HookCommand[];
}

export interface RegisteredHook {
  id: string;
  /** RA hook name this handler is bound to (e.g. "tool.execute.before"). */
  raHook: string;
  /** Original Claude event name (e.g. "PreToolUse"). */
  event: string;
  /** Regex source matched against the tool name (from Claude `matcher`). */
  matcher?: string;
  handler: HookCommand;
  /** Plugin root substituted for $CLAUDE_PLUGIN_ROOT in the command. */
  pluginRoot?: string;
}

export type HookDecisionAction = "allow" | "block" | "ask" | "deny";
export interface HookDecision {
  action: HookDecisionAction;
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Extract command handlers from a Claude hooks JSON value, keeping matchers. */
export function extractHookCommands(hooksJson: Record<string, unknown>): RegisteredHook[] {
  const out: RegisteredHook[] = [];
  for (const [event, groups] of Object.entries(hooksJson)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const group = g as HookMatcherGroup;
      if (!group || !Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) {
        if (!h || h.type !== "command" || typeof h.command !== "string" || !h.command.trim()) continue;
        out.push({ id: "", raHook: "", event, matcher: typeof group.matcher === "string" && group.matcher ? group.matcher : undefined, handler: h });
      }
    }
  }
  return out;
}

/** Claude event + matcher → RA hook name (null = RA has no such surface). */
export function claudeEventToRaHook(event: string, matcher?: string): string | null {
  switch (event) {
    case "PreToolUse": return "tool.execute.before";
    case "PostToolUse": return "tool.execute.after";
    case "UserPromptSubmit": return "tui.prompt.append";
    case "Stop":
    case "SubagentStop": return "agent.turn.end";
    case "SessionStart": return "session.start";
    case "SessionEnd": return "session.end";
    case "PreCompact": return "context.compact";
    default: return null; // Notification — Wave B left unmapped (TUI seam)
  }
}

/** Claude tool matcher (e.g. "Bash", "Write|Edit") → RA tool name or null. */
export function matcherToRaTool(matcher?: string): string | null {
  if (!matcher) return null;
  const m = matcher.trim();
  if (!m) return null;
  const map: Record<string, string> = { bash: "bash", write: "write", edit: "edit", multiedit: "multiedit", read: "read", glob: "glob", grep: "grep", webfetch: "webfetch", websearch: "websearch", todo: "todo", task: "task", mcp: "mcp", skill: "skill", repomap: "repomap", test: "test", outline: "outline", diagnose: "diagnose" };
  for (const part of m.split("|")) {
    const hit = map[part.trim().toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

function hookApplies(hook: RegisteredHook, inputTool: string): boolean {
  const tool = matcherToRaTool(hook.matcher);
  return tool === null || tool === inputTool;
}

/** Redact secrets from a value before it crosses into hook stdin. */
function redactValue<T>(value: T): T {
  if (typeof value === "string") return redact(value).text as unknown as T;
  if (Array.isArray(value)) return value.map(redactValue) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v);
    return out as unknown as T;
  }
  return value;
}

export interface RunHookResult {
  decision: HookDecision;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

/**
 * Run one command hook: shell + JSON stdin + timeout + decision parsing.
 * Never throws — a failed spawn is a non-blocking error (allow, logged).
 */
export async function runHookCommand(
  hook: RegisteredHook,
  input: Record<string, unknown>,
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RunHookResult> {
  const ctx = { ...input, hook_event_name: hook.event };
  const stdin = JSON.stringify(redactValue(ctx));
  const raw = hook.handler.command;
  const command = hook.pluginRoot ? raw.replaceAll("$CLAUDE_PLUGIN_ROOT", hook.pluginRoot) : raw;
  let timedOut = false;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  try {
    // Windows has no /bin/sh — Bun.spawn on win32 resolves `sh` via Git-Bash
    // (present on every runner with git); PATH lookup covers both platforms.
    const shell = process.platform === "win32" ? "sh" : "/bin/sh";
    proc = Bun.spawn([shell, "-c", command], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      // GAP-19: $CLAUDE_PLUGIN_ROOT must resolve inside the hook's shell —
      // exported as an env var so both $VAR and ${VAR} forms expand natively
      // (the string replaceAll below only covers the bare form).
      ...(hook.pluginRoot ? { env: { ...process.env, CLAUDE_PLUGIN_ROOT: hook.pluginRoot } } : {}),
    });
    const timeoutMs2 = Math.max(1, hook.handler.timeout ? hook.handler.timeout * 1000 : timeoutMs);
    // Hard cap on the post-kill drain: killing a shell doesn't necessarily
    // close its pipes on every bun/platform combo (orphaned children hold
    // them open) — never let a hook hang the agent past timeout + grace.
    const graceMs = 500;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      proc?.kill(); // TERM first …
      // … escalate to KILL: some sh/bun combos leave a TERM'd child's pipes
      // open, hanging the Response readers past every deadline (seen on
      // linux/bun-1.4 CI). KILL after a grace period keeps hooks non-blocking.
      killTimer = setTimeout(() => { try { proc?.kill(9); } catch { /* already gone */ } }, 250);
    }, timeoutMs2);
    const drain = async (readable: ReadableStream<Uint8Array> | "pipe" | undefined, what: string): Promise<string> => {
      try {
        return await Promise.race([
          new Response(readable as ReadableStream<Uint8Array>).text(),
          // Full timeout window + grace: normal hooks keep their whole budget;
          // only killed hooks hit this cap when pipes stay open.
          new Promise<string>((resolve) => setTimeout(() => resolve(`<<hook ${what} unreadable>>`), timeoutMs2 + graceMs)),
        ]);
      } catch {
        return "";
      }
    };
    try {
      // Fast-exiting hooks (e.g. bare `exit 3`) can close stdin before this
      // write lands — EPIPE is not an error, the hook just didn't read stdin.
      try {
        proc.stdin!.write(stdin);
        proc.stdin!.end();
      } catch { /* stdin closed early — proceed to drain output */ }
      const [stdout, stderr] = await Promise.all([
        drain(proc.stdout, "stdout"),
        drain(proc.stderr, "stderr"),
      ]);
      await Promise.race([
        proc.exited,
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs2 + 2 * graceMs)),
      ]);
      const code = proc.exitCode;
      if (timedOut) {
        return { decision: { action: "allow", reason: "hook timed out (non-blocking)" }, stdout: "", stderr, timedOut: true };
      }
      if (code === 2) {
        return { decision: { action: "block", reason: stderr.trim() || `hook ${hook.id} blocked via exit 2` }, stdout, stderr };
      }
      // JSON stdout decision output (documented CC protocol extension).
      const parsed = parseStdoutDecision(stdout);
      if (parsed) return { decision: parsed, stdout, stderr };
      if (code !== 0) {
        return { decision: { action: "allow", reason: `hook exited ${code} (non-blocking error)` }, stdout, stderr };
      }
      return { decision: { action: "allow" }, stdout, stderr };
    } finally {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    }
  } catch (e) {
    return { decision: { action: "allow", reason: `hook spawn failed (non-blocking): ${String(e)}` }, stdout: "", stderr: String(e) };
  }
}

function parseStdoutDecision(stdout: string): HookDecision | null {
  const text = stdout.trim();
  if (!text.startsWith("{")) return null;
  try {
    const j = JSON.parse(text) as {
      decision?: string;
      reason?: string;
      hookSpecificOutput?: { permissionDecision?: string; reason?: string };
    };
    if (j.decision === "block") return { action: "block", reason: j.reason ?? "hook blocked (JSON decision)" };
    if (j.hookSpecificOutput?.permissionDecision) {
      const pd = String(j.hookSpecificOutput.permissionDecision).toLowerCase();
      if (pd === "deny" || pd === "ask" || pd === "allow") return { action: pd, reason: j.hookSpecificOutput.reason ?? j.reason };
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Opt-in policy + registration ----------------------------------------------------
//
// The registry lives in the import manifest (`~/.ra/imports.json`): each
// plugin record with hooksEnabled=true carries runnable hook definitions.
// At runtime `runImportedHooksFor` reads the manifest once (cached) and only
// executes when the ra.json `plugin_runtime.hooks` policy (or
// RA_PLUGIN_HOOKS=on env override) says so — default is "opt-in" (= off).

interface ManifestWithRuntime {
  imports?: Array<{ id?: string; name?: string; source?: string; kind?: string; originPath?: string; hooksEnabled?: boolean; hookDefs?: HookRecord[] }>;
}

interface HookRecord {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
}

/** Load every runnable (enabled) imported hook from the manifest. */
export function loadEnabledHooks(home = homedir()): Array<RegisteredHook & { importId: string }> {
  const manifestPath = join(home, ".ra", "imports.json");
  let manifest: ManifestWithRuntime;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ManifestWithRuntime;
  } catch {
    return [];
  }
  const out: Array<RegisteredHook & { importId: string }> = [];
  for (const rec of manifest.imports ?? []) {
    if (!rec.hooksEnabled || !Array.isArray(rec.hookDefs)) continue;
    // hookDefs may come from the manifest (plain) or from importEntry (full).
    for (const d of rec.hookDefs) {
      const raHook = claudeEventToRaHook(d.event, d.matcher);
      if (!raHook) continue;
      out.push({
        id: `${rec.id ?? rec.name}:${d.event}`,
        importId: String(rec.id ?? rec.name ?? ""),
        raHook,
        event: d.event,
        matcher: d.matcher,
        handler: { type: "command", command: d.command, timeout: d.timeout },
        pluginRoot: rec.kind === "plugin" ? rec.originPath : undefined,
      });
    }
  }
  return out;
}

/** Read the project ra.json plugin_runtime policy without loadRaConfig's throw. */
export function readHooksPolicy(cwd = process.cwd()): { hooks?: string } {
  const candidates = [process.env.RA_CONFIG, join(cwd, "ra.json"), join(cwd, "..", "ra.json"), join(cwd, "..", "..", "ra.json")];
  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf-8")) as { plugin_runtime?: { hooks?: string } };
      return cfg.plugin_runtime ?? {};
    } catch { /* next candidate */ }
  }
  return {};
}

// ---- Agent-side wiring ----------------------------------------------------------------

// ponytail: process-wide cache keyed by (manifest path, mtime) — one stat per
// tool call; manifest rewrites (tests, re-imports) invalidate automatically.
let cacheKey = "";
let cachedRunnables: Array<RegisteredHook & { importId: string }> = [];

/**
 * Run every enabled imported hook bound to `raHook` (e.g. "tool.execute.before").
 * Default-deny: returns { blocked: false } immediately (one stat) when no
 * hooks are enabled or the global opt-in is off. Never throws.
 */
export async function runImportedHooksFor(
  raHook: string,
  input: Record<string, unknown>,
  cwd: string,
  // ponytail: RA_PLUGIN_HOME is a test seam (os.homedir ignores env on macOS);
  // prod callers never set it.
  home = process.env.RA_PLUGIN_HOME ?? homedir(),
): Promise<{ blocked: boolean; reason?: string }> {
  if (process.env.RA_PLUGIN_HOOKS === "0" || process.env.RA_PLUGIN_HOOKS === "off" || process.env.RA_PLUGIN_HOOKS === "opt-in") return { blocked: false };
  const path = join(home, ".ra", "imports.json");
  let key = "";
  try {
    key = `${path}:${statSync(path).mtimeMs}`;
  } catch {
    return { blocked: false }; // no manifest → nothing runnable
  }
  if (key !== cacheKey) {
    try {
      cachedRunnables = loadEnabledHooks(home);
      cacheKey = key;
    } catch {
      cachedRunnables = [];
    }
  }
  const hooks = cachedRunnables.filter((h) => h.raHook === raHook);
  if (!hooks.length) return { blocked: false };
  const policy = readHooksPolicy(cwd);
  if ((policy.hooks ?? "opt-in") !== "on" && process.env.RA_PLUGIN_HOOKS !== "on") return { blocked: false };
  for (const hook of hooks) {
    if (raHook === "tool.execute.before" && !hookApplies(hook, String(input.tool ?? ""))) continue;
    const res = await runHookCommand(hook, input, cwd);
    if (res.decision.action === "block" || res.decision.action === "deny") {
      return { blocked: true, reason: res.decision.reason ?? `hook ${hook.id} denied` };
    }
  }
  return { blocked: false };
}

/** Reset the process-local registry cache (tests re-import into fresh HOMEs). */
export function resetHookRuntimeCache(): void {
  cacheKey = "";
  cachedRunnables = [];
}

