import { withAgentRun, withAgentScope, currentScope, checkRun, runSignal, reserveCall, scopedRenderer, cancelRuns } from "./execution.ts";
import { normalizeToolText } from "../../anubis/src/tool-call.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR, ANUBIS_HOME } from "./paths.ts";
import { pickOllamaEndpoint, pickModel, pickClientForModel, resolveModelFallbacks, isAuthError, isUserCancel, isContextOverflowError } from "../../anubis/src/ollama.ts";
import { recordChatUsage } from "../../anubis/src/cost.ts";
import { contextPolicy, modelMaxContext, modelMaxContextLive, usableContext, modelKind, ContextLedger, type ContextInfo, type ContextPressure } from "../../anubis/src/context-limits.ts";
import { resolveRoleModel } from "../../anubis/src/router.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import type { ToolContext } from "./tools/index.ts";
import * as tools from "./tools/index.ts";
import { loadEnv } from "../../anubis/src/env.ts";
import { classifyTier, tierModel } from "./tier.ts";
import { canRunTool, resolveCapabilities, assertTool, assertBash } from "./permission.ts";
import { isAirgapped, localizeModel } from "./airgap.ts";
import { loadMcpTools, McpClient, McpHttpClient, isHttpConfig } from "./mcp.ts";
import type { McpServerEntry, McpTool } from "./mcp.ts";
import { resolveAgentFile, taskCatalogHint } from "./agents/catalog.ts";
import { toolSkill } from "./skills.ts";
import { toolRepoMap } from "./repomap.ts";
import { applyRoutingMode, downshiftForBudget, escalationChain } from "../../anubis/src/routing.ts";
import { jobForRole } from "../../anubis/src/profiles.ts";
import { pickForJobLive } from "../../anubis/src/capability.ts";
import { isQuotaError, markExhausted } from "../../anubis/src/quota.ts";
import { buildHandoff, saveHandoff, buildContinuationTask, resumeStepBudget, lowContextNotice, pickContextEscalation, todoState, type ContextStats, type HandoffReason } from "./resume.ts";

/** Global hook registry — allows agent code to emit events without a PluginHost reference. */
type GlobalHookFn = (input: Record<string, unknown>) => void;
const globalHooks = new Map<string, GlobalHookFn[]>();

export function onGlobalHook(event: string, fn: GlobalHookFn): void {
  if (!globalHooks.has(event)) globalHooks.set(event, []);
  globalHooks.get(event)!.push(fn);
}

export function emitGlobalHook(event: string, input: Record<string, unknown>): void {
  for (const fn of globalHooks.get(event) ?? []) {
    try { fn(input); } catch { /* ignore hook errors */ }
  }
}

export interface TaskResult {
  role: string;
  model: string;
  output: string;
  host?: string;
  /** Populated when the primary model failed on a provider error and an explicit fallback candidate completed the work. */
  fallbacks?: FallbackEvent[];
  /**
   * Adaptive low-context runs (ra.78): "done" (default) | "resumable" (handoff
   * ready — runTaskAgent continues it) | "partial" (context exhausted, no
   * bigger model available — output says so honestly).
   */
  status?: "done" | "resumable" | "partial";
  /** Handoff packet carried onto the continuation run. */
  handoff?: string;
  /** Where the handoff packet was persisted (~/.ra/handoffs/...). */
  handoffPath?: string;
  /** Context telemetry for /context, eval and benchmark reports. */
  context?: ContextStats;
  /** Context-pressure escalations to a bigger-window model (reason recorded). */
  escalations?: Array<{ from: string; to: string; reason: string }>;
}

export interface FallbackEvent {
  from: string;
  to: string;
  reason: string;
  ms: number;
}

/**
 * Build the tool-grammar hint appended to every agent system prompt.
 * - `allowed`: frontmatter `tools:` whitelist (lowercase tool names); verbs
 *   outside the list are omitted from the hint.
 * - `mcpTools`: MCP tools discovered from config; advertised in their own
 *   section so the model knows it can call them via `MCP <server.tool>`.
 */
export function buildToolHint(
  allowed?: string[],
  mcpTools?: Array<McpTool & { server: string }>,
): string {
  const want = (verb: string) => !allowed || allowed.includes(verb.toLowerCase());
  const sections: string[] = [];
  if (want("WRITE")) {
    sections.push(`WRITE path/to/file
\`\`\`
file contents
\`\`\``);
  }
  if (want("EDIT")) {
    sections.push(`EDIT path/to/file
<<<<<<< OLD
exact old text
=======
exact new text
>>>>>>> NEW`);
  }
  if (want("MULTIEDIT")) {
    sections.push(`Or: MULTIEDIT path/to/file
<<<<<<< OLD
old text 1
=======
new text 1
>>>>>>> NEW
<<<<<<< OLD
old text 2
=======
new text 2
>>>>>>> NEW`);
  }
  if (want("READ")) sections.push("Or: READ path/to/file");
  if (want("OUTLINE")) sections.push("Or: OUTLINE path/to/file");
  if (want("DIAGNOSE")) sections.push("Or: DIAGNOSE path/to/file");
  if (want("GLOB")) sections.push("Or: GLOB **/*.py");
  if (want("GREP")) sections.push("Or: GREP pattern [optional/glob]");
  if (want("BASH")) sections.push("Or: BASH command here");
  if (want("WEBFETCH")) sections.push("Or: WEBFETCH https://example.com");
  if (want("WEBSEARCH")) sections.push("Or: WEBSEARCH <query>   (web search; needs BRAVE_SEARCH_API_KEY or TAVILY_API_KEY)");
  if (want("SKILL")) sections.push("Or: SKILL name|list   (load a skill's instructions)");
  if (want("REPOMAP")) sections.push("Or: REPOMAP   (ranked repo overview: files + symbols)");
  if (want("TEST")) sections.push("Or: TEST [target]   (run the project test suite in the sandbox)");
  if (want("TODO")) sections.push("Or: TODO add <text> / TODO done <id> / TODO list");
  if (want("TASK")) sections.push(`Or: TASK <role> <task>   (spawn a subagent)
Agents: ${taskCatalogHint()}`);
  if (mcpTools && mcpTools.length) {
    const lines = mcpTools
      .slice(0, 20)
      .map((t) => `  ${t.server}.${t.name}${t.description ? ` — ${t.description.slice(0, 100)}` : ""}`);
    sections.push(`Or: MCP <server.tool> <json-args>   (configured MCP tools:\n${lines.join("\n")})`);
  }
  if (want("DONE")) sections.push("Or: DONE — when finished, with a short summary.");
  const footer = [
    ...(want("WRITE") || want("EDIT") ? ["Use WRITE for new files and EDIT for changes, so edits are tracked and undoable. Do not create or edit files with BASH."] : []),
    "Return exactly one tool call, then stop and wait for the real result. Never simulate tool results or claim a file was written before the tool confirms it.",
    "Always produce real content.",
  ].join(" ");
  return `
You may call tools with this exact format (one at a time):
${sections.join("\n\n")}

${footer}
`;
}

/** Default hint with every built-in tool (no MCP, no restrictions). */
export const TOOL_HINT = buildToolHint();

function loadAgentPrompt(role: string, cwd = process.cwd()): string {
  const p = resolveAgentFile(role, cwd) ?? join(AGENTS_DIR, `${role}.md`);
  if (!existsSync(p)) return `You are ${role}.`;
  const raw = readFileSync(p, "utf-8");
  const body = raw.split("---").slice(2).join("---").trim();
  return body || `You are ${role}.`;
}

export interface BashPatternRule {
  pattern: string;
  level: "allow" | "ask" | "deny";
}

/**
 * Parse an agent's frontmatter `permission` block (e.g. thoth: edit/bash deny).
 * Returns a map of tool → allow/ask/deny, or null if no frontmatter permission.
 * Nested maps (e.g. `bash:` with `"git diff*": allow` entries) collapse to
 * their `"*"` default — or the most restrictive entry when no `"*"` exists —
 * with the full pattern list available via `loadAgentBashPatterns`.
 */
export function loadAgentPermissions(role: string): Record<string, "allow" | "ask" | "deny"> | null {
  const detail = loadAgentPermissionDetail(role);
  return detail ? detail.tools : null;
}

/** Full permission detail including per-command bash pattern rules. */
export function loadAgentPermissionDetail(role: string, cwd = process.cwd()): {
  tools: Record<string, "allow" | "ask" | "deny">;
  bashPatterns: BashPatternRule[];
} | null {
  const p = resolveAgentFile(role, cwd) ?? join(AGENTS_DIR, `${role}.md`);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf-8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const RANK: Record<string, number> = { deny: 0, ask: 1, allow: 2 };
  const out: Record<string, "allow" | "ask" | "deny"> = {};
  const bashPatterns: BashPatternRule[] = [];
  const lines = fm[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^permission:\s*$/);
    if (!m) continue;
    // Parse the permission block until the next top-level key.
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^[a-zA-Z]/.test(l)) break; // next top-level key ends the block
      const flat = l.match(/^\s*([a-zA-Z]+):\s*(allow|ask|deny)\s*$/);
      if (flat) {
        out[flat[1]] = flat[2] as "allow" | "ask" | "deny";
        continue;
      }
      const nested = l.match(/^\s*([a-zA-Z]+):\s*$/);
      if (nested) {
        // Nested map (e.g. bash: with "pattern": level entries).
        const tool = nested[1];
        const rules: BashPatternRule[] = [];
        for (let k = j + 1; k < lines.length; k++) {
          const nl = lines[k];
          if (!/^\s+"/.test(nl)) {
            j = k - 1;
            break;
          }
          const rm = nl.match(/^\s*"([^"]+)":\s*(allow|ask|deny)\s*$/);
          if (rm) rules.push({ pattern: rm[1], level: rm[2] as BashPatternRule["level"] });
        }
        if (rules.length) {
          if (tool === "bash") bashPatterns.push(...rules);
          const star = rules.find((r) => r.pattern === "*");
          out[tool] = star
            ? star.level
            : rules.reduce((min, r) => (RANK[r.level] < RANK[min.level] ? r : min)).level;
        }
      }
    }
    break;
  }
  if (!Object.keys(out).length && !bashPatterns.length) return null;
  return { tools: out, bashPatterns };
}

/** Shell-style glob match (`*` wildcard) for bash permission patterns. */
export function bashPatternMatches(pattern: string, command: string): boolean {
  const re = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return re.test(command.trim());
}

/** Resolve the effective bash level for a command: first matching pattern wins
 *  (`"*"` acts as the default, not a pattern, so it can't shadow the rest). */
export function resolveBashLevel(
  command: string,
  patterns: BashPatternRule[],
  fallback: "allow" | "ask" | "deny" | undefined,
): "allow" | "ask" | "deny" | undefined {
  for (const r of patterns) {
    if (r.pattern === "*") continue;
    if (bashPatternMatches(r.pattern, command)) return r.level;
  }
  return fallback;
}

export interface AgentMeta {
  steps?: number;
  temperature?: number;
  /** Override the model for this agent role. */
  model?: string;
  /** Restrict available tools (comma-separated list in frontmatter). */
  tools?: string[];
  /** Library category from frontmatter (research/review/ops/…). */
  category?: string;
}

/**
 * Parse an agent's frontmatter `steps` and `temperature` (used to bound the
 * tool loop and set sampling). Returns empty object if absent.
 */
export function loadAgentMeta(role: string, cwd = process.cwd()): AgentMeta {
  const p = resolveAgentFile(role, cwd) ?? join(AGENTS_DIR, `${role}.md`);
  if (!existsSync(p)) return {};
  const raw = readFileSync(p, "utf-8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const out: AgentMeta = {};
  const steps = fm[1].match(/^steps:\s*(\d+)\s*$/m);
  if (steps) out.steps = Number(steps[1]);
  const temp = fm[1].match(/^temperature:\s*([\d.]+)\s*$/m);
  if (temp) out.temperature = Number(temp[1]);
  const model = fm[1].match(/^model:[ \t]*([^\r\n]+)[ \t]*$/m);
  if (model) out.model = model[1].trim();
  const tools = fm[1].match(/^tools:[ \t]*([^\r\n]*)$/m);
  if (tools) out.tools = tools[1].split(",").map((t) => t.trim()).filter(Boolean);
  const category = fm[1].match(/^category:[ \t]*(\S+)[ \t]*$/m);
  if (category) out.category = category[1];
  return out;
}

/**
 * Load project memory (AGENTS.md or RA.md) from the project cwd, if present.
 * Injected into the system prompt so the agent follows project conventions.
 */
export function loadProjectMemory(cwd: string): string {
  for (const name of ["AGENTS.md", "RA.md"]) {
    const p = join(cwd, name);
    if (existsSync(p)) {
      const body = readFileSync(p, "utf-8").trim();
      if (body) return `\n\nProject memory (${name}):\n${body}`;
    }
  }
  return "";
}

export async function execToolBlock(
  ctx: ToolContext,
  content: string,
  config?: RaConfig,
  agentPerms?: Record<string, "allow" | "ask" | "deny"> | null,
  spawn?: (role: string, task: string) => Promise<string>,
  bashPatterns?: BashPatternRule[],
  mcpCall?: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<{ done: boolean; note: string }> {
  ctx.signal?.throwIfAborted();
  checkRun();
  content = normalizeToolText(content);
  if (/^UNSUPPORTED_TOOL|<tool_calls>/i.test(content.trim())) return { done: false, note: "Error: unsupported tool call. Use the exact tool grammar from the system prompt." };
  const requestedVerb = content.trim().match(/^(WRITE|EDIT|MULTIEDIT|READ|OUTLINE|DIAGNOSE|GLOB|GREP|BASH|WEBFETCH|WEBSEARCH|TODO|TASK|MCP|SKILL|REPOMAP|TEST)\b/i)?.[1]?.toLowerCase();
  if (requestedVerb) {
    try { assertTool(ctx.capabilities, requestedVerb); }
    catch (error) { console.error(`RA permission denied: ${String(error)}`); return { done: false, note: `Error: ${String(error)}` }; }
  }
  const denied = (tool: string, verb = tool) => {
    try { assertTool(ctx.capabilities, verb); } catch (e) { console.error(`RA permission denied: ${String(e)}`); return `Error: ${String(e)}`; }
    const agentLevel = agentPerms?.[tool] ?? (tool === "write" ? agentPerms?.edit : undefined);
    if (agentLevel && agentLevel !== "allow") {
      return `Error: tool '${tool}' is not permitted for this agent`;
    }
    if (config && !canRunTool(config, tool)) {
      return `Error: tool '${tool}' is not permitted by config`;
    }
    return null;
  };

  const write = content.match(/^WRITE[ \t]+([^\n]+)\n(`{3,})[^\n]*\n([\s\S]*)^\2[ \t]*$/im);
  if (write) {
    const d = denied("write");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolWrite(ctx, write[1].trim().replace(/^["\']|["\']$/g, ""), write[3].replace(/\n$/, "")) };
  }
  const edit = content.match(
    /^EDIT\s+(\S+)\s*\n<<<<<<<\s*OLD\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*NEW/im,
  );
  if (edit) {
    const d = denied("edit");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolEdit(ctx, edit[1], edit[2], edit[3]) };
  }
  const multiedit = content.match(/^MULTIEDIT\s+(\S+)\s*\n([\s\S]*)/im);
  if (multiedit) {
    const d = denied("edit", "multiedit");
    if (d) return { done: false, note: d };
    const ops: tools.EditOp[] = [];
    const re = /<<<<<<<\s*OLD\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*NEW/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(multiedit[2])) !== null) {
      ops.push({ old: m[1], new: m[2] });
    }
    if (!ops.length) return { done: false, note: "Error: MULTIEDIT had no edit blocks" };
    return { done: false, note: tools.toolMultiEdit(ctx, multiedit[1], ops) };
  }
  const read = content.match(/^READ\s+(\S+)/im);
  if (read) {
    const d = denied("read");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolRead(ctx, read[1]) };
  }
  const outline = content.match(/^OUTLINE\s+(\S+)/im);
  if (outline) {
    const d = denied("read", "outline");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolOutline(ctx, outline[1]) };
  }
  const diagnose = content.match(/^DIAGNOSE\s+(\S+)/im);
  if (diagnose) {
    const d = denied("bash", "diagnose");
    if (d) return { done: false, note: d };
    return { done: false, note: await tools.toolDiagnose(ctx, diagnose[1]) };
  }
  const glob = content.match(/^GLOB\s+(.+)/im);
  if (glob) {
    const d = denied("glob");
    if (d) return { done: false, note: d };
    return { done: false, note: await tools.toolGlob(ctx, glob[1].trim()) };
  }
  const grep = content.match(/^GREP\s+(\S+)(?:\s+(\S+))?/im);
  if (grep) {
    const d = denied("grep");
    if (d) return { done: false, note: d };
    return { done: false, note: await tools.toolGrep(ctx, grep[1], grep[2] ?? "**/*") };
  }
  const bash = content.match(/^BASH[ \t]+([\s\S]+)/im);
  if (bash) {
    const cmd = bash[1].trim();
    try { assertTool(ctx.capabilities, "bash"); assertBash(ctx.capabilities, cmd); }
    catch (e) { return { done: false, note: `Error: ${String(e)}` }; }
    const patterns = bashPatterns ?? [];
    // Pattern rules (when present) decide the agent layer; an explicit
    // pattern allow overrides the flat `bash: ask` default from `"*"`.
    const patternLevel = patterns.length ? resolveBashLevel(cmd, patterns) : undefined;
    if (patterns.length && patternLevel !== "allow") {
      return { done: false, note: `Error: bash '${cmd}' is not permitted for this agent (${patternLevel ?? "no matching rule"})` };
    }
    if (patternLevel !== "allow") {
      const d = denied("bash");
      if (d) return { done: false, note: d };
    } else if (config && !canRunTool(config, "bash")) {
      return { done: false, note: "Error: tool 'bash' is not permitted by config" };
    }
    return { done: false, note: await tools.toolBash(ctx, cmd) };
  }
  const mcp = content.match(/^MCP\s+(\S+)(?:[ \t]+([\s\S]+?))?\s*$/im);
  if (mcp) {
    const d = denied("mcp");
    if (d) return { done: false, note: d };
    if (!mcpCall) return { done: false, note: "Error: MCP tools not available" };
    try {
      const args = mcp[2] ? (JSON.parse(mcp[2]) as Record<string, unknown>) : {};
      return { done: false, note: await mcpCall(mcp[1], args) };
    } catch (e) {
      return { done: false, note: `Error: MCP call failed: ${String(e)}` };
    }
  }
  const webfetch = content.match(/^WEBFETCH\s+(\S+)/im);
  if (webfetch) {
    const d = denied("webfetch");
    if (d) return { done: false, note: d };
    const airgap = config ? isAirgapped(config) : false;
    return { done: false, note: await tools.toolWebFetch(webfetch[1].trim(), 15000, airgap, ctx.signal) };
  }
  const websearch = content.match(/^WEBSEARCH\s+([\s\S]+)/im);
  if (websearch) {
    const d = denied("websearch");
    if (d) return { done: false, note: d };
    const airgap = config ? isAirgapped(config) : false;
    return { done: false, note: await tools.toolWebSearch(websearch[1].trim(), process.env, airgap) };
  }
  const skill = content.match(/^SKILL\s+(.+)/im);
  if (skill) {
    const d = denied("skill");
    if (d) return { done: false, note: d };
    return { done: false, note: toolSkill(ctx, skill[1].trim(), config) };
  }
  const repomap = /^REPOMAP\s*$/im.test(content.trim());
  if (repomap) {
    const d = denied("read", "repomap");
    if (d) return { done: false, note: d };
    return { done: false, note: toolRepoMap(ctx) };
  }
  const testRun = content.match(/^TEST\s*(.*)/im);
  if (testRun) {
    const d = denied("bash", "test");
    if (d) return { done: false, note: d };
    try { assertTool(ctx.capabilities, "test"); }
    catch (e) { return { done: false, note: `Error: ${String(e)}` }; }
    return { done: false, note: await tools.toolTest(ctx, testRun[1].trim() || undefined) };
  }
  const todo = content.match(/^TODO\s+(.+)/im);
  if (todo) {
    const d = denied("todo");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolTodo(ctx, todo[1].trim()) };
  }
  const task = content.match(/^TASK\s+(\S+)\s+([\s\S]+)/im);
  if (task) {
    const d = denied("task");
    if (d) return { done: false, note: d };
    if (!spawn) return { done: false, note: "Error: subagent spawn not available" };
    const role = task[1].trim();
    const sub = task[2].trim();
    const out = await spawn(role, sub);
    return { done: false, note: `Subagent ${role} result:\n${out}` };
  }
  if (/^DONE\b/im.test(content.trim())) {
    return { done: true, note: content.replace(/^DONE\s*/i, "").trim() || "done" };
  }
  // Fenced file with filename comment
  const fence = content.match(/(?:file|path)[:\s]+([^\s\n]+\.[a-zA-Z0-9]+).*?```(?:\w*\n)?([\s\S]*?)```/is);
  if (fence) {
    const d = denied("write");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolWrite(ctx, fence[1], fence[2].trim()) };
  }
  if (requestedVerb) return { done: false, note: `Error: malformed ${requestedVerb.toUpperCase()} call. Follow the exact tool format, including fences or edit markers.` };
  return { done: false, note: "" };
}

// ---- MCP runtime (module-cached; connects only when servers are configured) ----

export interface McpRuntime {
  tools: Array<McpTool & { server: string }>;
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
}

let mcpRuntime: McpRuntime | null = null;
let mcpRuntimeKey: string | null = null;

/** Connect configured MCP servers once and cache the tool list + caller. */
export async function getMcpRuntime(config: RaConfig, context: ToolContext = { cwd: process.cwd() }): Promise<McpRuntime> {
  const servers = (config.mcp ?? {}) as Record<string, McpServerEntry>;
  const key = JSON.stringify([servers, context.cwd, context.sandbox]);
  const list = mcpRuntime && mcpRuntimeKey === key ? mcpRuntime.tools : Object.keys(servers).length ? await loadMcpTools(servers, context) : [];
  mcpRuntime = {
    tools: list,
    call: async (name, args) => {
      const dot = name.indexOf(".");
      const server = dot === -1 ? name : name.slice(0, dot);
      const tool = dot === -1 ? "" : name.slice(dot + 1);
      const cfg = servers[server];
      if (!cfg) throw new Error(`unknown MCP server: ${server}`);
      assertTool(context.capabilities, "mcp");
      const client = isHttpConfig(cfg) ? new McpHttpClient(cfg, context.signal) : new McpClient(cfg, context);
      try {
        await client.start();
        return await client.callTool(tool, args);
      } finally {
        await client.close();
      }
    },
  };
  mcpRuntimeKey = key;
  return mcpRuntime;
}

// ---- Streaming + interruption plumbing ----

let activeStreamRenderer: ((token: string) => void) | null = null;

/** Install a token renderer (the TUI prints tokens as they arrive). */
export function setActiveStreamRenderer(fn: ((token: string) => void) | null): void {
  activeStreamRenderer = fn;
}

export function getActiveStreamRenderer(): ((token: string) => void) | null { return activeStreamRenderer; }

// ---- Live context state (for the /context TUI command) ----

export interface LiveContextState {
  model: string;
  windowTokens: number;
  budgetTokens: number;
  usedTokens: number;
  pressure: ContextPressure;
}

let liveContextState: LiveContextState | null = null;

/** Most recent agent-loop context telemetry, or null outside a run. */
export function getLiveContextState(): LiveContextState | null {
  return liveContextState;
}

/** Abort the in-flight model turn (Phase 1 wires this to Esc). */
export function abortActiveTurn(): boolean {
  return cancelRuns();
}

/** Transient failures worth one automatic retry (timeouts, resets, 5xx). */
export function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /timeout|empty response/i.test(msg) ||
    /econnreset|econnrefused|socket hang up/i.test(msg) ||
    /\b(?:50[0234])\b/.test(msg) ||
    /internal server error|service unavailable|bad gateway|gateway timeout/i.test(msg) ||
    /fetch failed/i.test(msg)
  );
}

/** One retry with backoff on transient errors; permanent errors pass through. */
export async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 600): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (retries > 0 && isTransientError(e)) {
      await new Promise((r) => setTimeout(r, delayMs));
      return withRetry(fn, retries - 1, delayMs * 2);
    }
    throw e;
  }
}

// ---- Subagent tracking (display-only; set by the TUI, read by /tree) ----

let activeTracker: SubagentTree | null = null;

export function setActiveSubagentTracker(tree: SubagentTree | null): void {
  activeTracker = tree;
}

export function getActiveSubagentTracker(): SubagentTree | null {
  return activeTracker;
}

// ---- Context compaction (hidden `compaction` system agent) ----

/** Prompt-size ceiling before the middle of the conversation gets compacted. */
export const COMPACTION_THRESHOLD_CHARS = 60_000;

export interface CompactionPlan {
  keep: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  summarize: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Pure: pick which middle messages to compact once the prompt is too large.
 * Always keeps the system message, the original task exchange area start, and
 * the last exchange (tool result + reply). Returns null when under threshold.
 */
export function planCompaction(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  thresholdChars = COMPACTION_THRESHOLD_CHARS,
): CompactionPlan | null {
  const total = messages.reduce((n, m) => n + m.content.length, 0);
  if (total <= thresholdChars || messages.length < 5) return null;
  const keep = [messages[0], messages[messages.length - 2], messages[messages.length - 1]].filter(Boolean);
  const keepSet = new Set(keep);
  const summarize = messages.slice(1, -2).filter((m) => !keepSet.has(m));
  if (!summarize.length) return null;
  return { keep, summarize };
}

/** Best-effort: run the hidden compaction agent on the small lane. */
async function compactConversation(plan: CompactionPlan, config: RaConfig): Promise<string> {
  const env = loadEnv(ANUBIS_HOME);
  const { client, model } = await pickClientForModel(config.small_model ?? config.model, env, config.provider as Record<string, import("../../anubis/src/ollama.ts").ProviderDef> | undefined);
  // The summarizer is a small model with its own (small!) window — cap the
  // transcript to what IT can read, and reserve num_ctx so it actually can.
  const policy = contextPolicy(config);
  const smallId = config.small_model ?? config.model;
  const smallUsable = usableContext(modelMaxContext(smallId, config), smallId, modelKind(smallId, config), policy).windowTokens;
  const cap = Math.min(40_000, Math.floor(smallUsable * 0.6 * 4));
  const transcript = plan.summarize.map((m) => `${m.role}: ${m.content}`).join("\n\n").slice(0, cap);
  const res = await withRetry(() => client.nativeChatStream(model, [
    { role: "system", content: loadAgentPrompt("compaction") },
    { role: "user", content: `Summarize this agent conversation so work can continue with full fidelity:\n\n${transcript}` },
  ], { signal: reserveCall(), contextTokens: smallUsable }));
  recordChatUsage(res.model, client.kind === "cloud", res.usage, { in: transcript.length, out: res.content.length });
  return res.content;
}

export async function runTaskAgent(
  role: string, task: string, config: RaConfig, ctx: ToolContext,
  env: Record<string, string>, maxSteps = 16,
): Promise<TaskResult> {
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(role)) throw new Error(`Invalid agent role: ${role}`);
  return withAgentRun({ limits: config.agent_limits, tree: activeTracker, renderer: activeStreamRenderer, signal: ctx.signal }, () =>
    withAgentScope(role, task, () => runAdaptive(role, task, config, ctx, env, maxSteps)));
}

/**
 * Adaptive run manager (ra.78): a run that ends "resumable" (context low,
 * overflow, or pressured step-limit) is continued by a fresh, SHORTER run
 * seeded with the handoff packet — the original objective restated verbatim.
 * After `context.resume_limit` continuations the task escalates once to a
 * bigger-window model with the reason recorded, or returns partial honestly.
 * Kill switch: RA_NO_ADAPTIVE=1 restores the old single-run behavior.
 */
async function runAdaptive(
  role: string, task: string, config: RaConfig, ctx: ToolContext,
  env: Record<string, string>, maxSteps: number,
): Promise<TaskResult> {
  const policy = contextPolicy(config);
  const adaptive = policy.adaptive && process.env.RA_NO_ADAPTIVE !== "1";
  if (!adaptive) return executeTaskAgent(role, task, config, ctx, env, maxSteps);
  const stats: ContextStats = { windowTokens: 0, usedTokens: 0, source: "", resumes: 0, compactions: 0, escalations: 0 };
  let result = await executeTaskAgent(role, task, config, ctx, env, maxSteps, { continuation: 0, objective: task, stats });
  const attachStats = (r: TaskResult): TaskResult => ({ ...r, context: { ...stats } });
  let resumes = 0;
  while (result.status === "resumable" && resumes < policy.resumeLimit) {
    resumes++;
    stats.resumes = resumes;
    const contTask = buildContinuationTask(task, result.handoff ?? "", resumes, policy.resumeLimit);
    result = await executeTaskAgent(role, contTask, config, ctx, env, resumeStepBudget(maxSteps, resumes), { continuation: resumes, objective: task, stats });
  }
  if (result.status === "resumable") {
    // Context exhausted even after continuations: escalate once to a model
    // with a larger usable window (reason recorded — the design pack's
    // "required context exceeds the practical local-server budget" trigger),
    // or return the partial result honestly when nothing bigger is reachable.
    const tier = classifyTier(task, role === "ptah" ? "code" : role === "thoth" ? "plan" : undefined);
    const currentWindow = stats.windowTokens || modelMaxContext(result.model, config).windowTokens;
    const esc = await pickContextEscalation(jobForRole(role, tier), config, env, result.model, currentWindow);
    if (esc) {
      stats.escalations++;
      const reason = `context exhausted after ${resumes} continuation${resumes === 1 ? "" : "s"}`;
      emitGlobalHook("model.fallback", { from: result.model, to: esc, reason });
      const escTask = buildContinuationTask(task, result.handoff ?? "", resumes, policy.resumeLimit);
      const escalated = await executeTaskAgent(role, escTask, config, ctx, env, maxSteps, { continuation: resumes + 1, objective: task, modelOverride: esc, stats });
      return attachStats({ ...escalated, escalations: [...(result.escalations ?? []), { from: result.model, to: esc, reason }] });
    }
    return attachStats({
      ...result,
      status: "partial",
      output: `${result.output}\n\n[RA: context exhausted after ${resumes} continuation${resumes === 1 ? "" : "s"} — partial result. Handoff saved: ${result.handoffPath ?? "not saved"}]`,
    });
  }
  return attachStats(result);
}

async function executeTaskAgent(
  role: string, task: string, config: RaConfig, ctx: ToolContext,
  env: Record<string, string>, maxSteps: number,
  opts: { continuation?: number; modelOverride?: string; objective?: string; stats?: ContextStats } = {},
): Promise<TaskResult> {
  ctx = { ...ctx, filesWritten: ctx.filesWritten ?? [], mutations: ctx.mutations ?? { count: 0 }, signal: runSignal() };
  const initialWrites = ctx.mutations!.count;
  // Continuation runs inherit edits from earlier runs — the no-edits guard
  // only applies when nothing has been written for this task yet.
  let needsEdit = (opts.continuation ?? 0) === 0 && role === "ptah" && (canRunTool(config, "write") || canRunTool(config, "edit")) && /\b(create|write|update|fix|implement|build|change)\b/i.test(task) && !/no (?:tools|files)/i.test(task);
  let completionRepairs = 0;
  const assignment = resolveRoleModel(role, config);
  const tier = classifyTier(task, role === "ptah" ? "code" : role === "thoth" ? "plan" : undefined);
  const tierModels = (config as RaConfig & { tier_models?: Record<string, string> }).tier_models;
  // Hybrid routing (ra.76): the mode adjusts the tier decision before
  // airgap/frontmatter overrides — an agent that pins its model always wins.
  let configured = applyRoutingMode((tierModels ? tierModel(tier, tierModels) : undefined) ?? assignment.model, tier, config);
  const airgap = isAirgapped(config, env);
  if (airgap) configured = localizeModel(configured, config.small_model ?? "ollama-lan/gpt-oss:20b");
  const meta = loadAgentMeta(role, ctx.cwd);
  // Frontmatter model override takes precedence over config/tier assignment —
  // must be applied BEFORE the client is picked, or it never takes effect.
  if (meta.model) configured = meta.model;
  // Provider Mosaic (ra.77): benchmark-driven capability routing. Picks the
  // best-profiled model for this agent's job across every configured
  // provider (local-biased), and returns a failover chain. Frontmatter pins
  // win; the budget guard keeps the last word on cost.
  let capabilityChain: string[] = [];
  if (!meta.model && config.capability_router?.enabled !== false && !airgap) {
    const routing = await pickForJobLive(jobForRole(role, tier), config, env);
    if (routing) {
      configured = routing.primary.model;
      capabilityChain = routing.chain;
    }
  }
  // Budget guard: past budget.session_usd, cloud work downshifts to the local lane.
  const budgetDownshift = downshiftForBudget(configured, config);
  if (budgetDownshift) {
    configured = budgetDownshift;
    emitGlobalHook("model.fallback", { from: meta.model ?? "tier", to: budgetDownshift, reason: "session budget breached" });
  }
  // Context escalation (ra.78) pins the bigger-window model above all routing.
  if (opts.modelOverride) configured = opts.modelOverride;
  if (currentScope()?.node) currentScope()!.node!.model = configured;
  emitGlobalHook("agent.turn.start", { role, task, model: configured });
  const { client, model } = await pickClientForModel(configured, env, config.provider as Record<string, import("../../anubis/src/ollama.ts").ProviderDef> | undefined);
  const permDetail = loadAgentPermissionDetail(role, ctx.cwd);
  const agentPerms = permDetail?.tools ?? null;
  const bashPatterns = permDetail?.bashPatterns ?? [];
  const steps = Math.min(meta.steps ?? maxSteps, maxSteps);
  const temperature = meta.temperature;
  ctx = { ...ctx, capabilities: resolveCapabilities(config, agentPerms ?? {}, meta.tools, bashPatterns, ctx.capabilities), sandbox: config.sandbox };
  needsEdit = needsEdit && (ctx.capabilities!.tools.has("write") || ctx.capabilities!.tools.has("edit"));
  const mcpRt = ctx.capabilities!.tools.has("mcp") ? await getMcpRuntime(config, ctx) : { tools: [], call: async () => "Error: MCP is not permitted" };
  const allowed = [...ctx.capabilities!.tools];
  const hint = buildToolHint(allowed, mcpRt.tools);
  const accessMode = ctx.capabilities!.readOnly ? "\nThis operation is read-only, including all delegated agents. Inspect and propose; do not modify files." : "";
  const system = `${loadAgentPrompt(role, ctx.cwd)}${accessMode}${loadProjectMemory(ctx.cwd)}\nProject files (top level):\n${tools.listDir(ctx, ".").slice(0, 4000)}\n${hint}`;

  let rootOutput = "";
  // The active client can change mid-loop: cross-provider failover (quota,
  // capability chain) re-picks per candidate. Used for the final host tag.
  let activeClient = client;
  // Adaptive context ledger (ra.78): plan against the model's USABLE window
  // (probed/tabled max clamped by the host's num_ctx cap), never the nominal
  // one. Registry failure disables adaptation for this run, never breaks it.
  const policy = contextPolicy(config);
  const adaptive = policy.adaptive && process.env.RA_NO_ADAPTIVE !== "1";
  let ledger: ContextLedger | null = null;
  const refreshLedger = async (m: string) => {
    try {
      const max = await modelMaxContextLive(activeClient, m, config);
      const usable: ContextInfo = usableContext(max, m, activeClient.kind, policy);
      ledger = new ContextLedger(m, usable.windowTokens, policy);
      if (opts.stats) {
        opts.stats.windowTokens = usable.windowTokens;
        opts.stats.source = usable.source;
      }
    } catch {
      ledger = null;
    }
  };
  if (adaptive) await refreshLedger(configured);
  const result = await runAgentLoop();
  if (currentScope()?.node) currentScope()!.node!.model = result.model;
  return { ...result, host: activeClient.kind === "cloud" ? "cloud" : activeClient.baseURL.includes("192.168.1.251") ? "251" : "local" };

  async function runAgentLoop(): Promise<TaskResult> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...(currentScope()?.depth === 0 ? ctx.history ?? [] : []),
    { role: "user", content: `Task: ${task}\nProject cwd: ${ctx.cwd}` },
  ];

  let last = "";
  let compacted = false; // legacy single-shot compaction latch (non-adaptive)
  let lastCompactStep = -10; // adaptive: minimum 3 steps between compactions
  let lowWarned = false;
  let spawnDisabled = false;
  let effectiveSteps = steps;
  let usedModel = model;
  // Same-kind user chain first, then cross-kind escalation (balanced mode
  // local→cloud; budget breach cloud→local), then the Provider-Mosaic
  // capability chain (next-best models for this job, any provider).
  // fallbackChain itself stays same-kind by contract — escalation and
  // capability candidates are appended here, at the agent layer.
  const fallbackModels = [...new Set([
    ...resolveModelFallbacks(configured, config.fallbacks),
    ...escalationChain(configured, config),
    ...capabilityChain,
  ])];
  const fallbackEvents: FallbackEvent[] = [];
  const withFallbacks = (r: TaskResult): TaskResult =>
    fallbackEvents.length > 0 ? { ...r, fallbacks: [...fallbackEvents] } : r;
  const spawn = async (subRole: string, subTask: string): Promise<string> => {
    if (spawnDisabled) return "Subagent spawn skipped: context is low — finish the current sub-step yourself with direct tools.";
    const result = await runTaskAgent(subRole, subTask, config, ctx, env, 4);
    return result.output;
  };
  // Checkpoint: end this run cleanly carrying a handoff packet (objective,
  // progress, TODO state, next steps); the adaptive loop in runTaskAgent
  // resumes a fresh, shorter run seeded with it.
  const checkpoint = (reason: HandoffReason): TaskResult => {
    const used = ledger?.usedTokens(messages) ?? 0;
    const handoff = buildHandoff({
      role,
      objective: opts.objective ?? task,
      reason,
      continuation: opts.continuation ?? 0,
      model: usedModel,
      windowTokens: ledger?.windowTokens ?? 0,
      usedTokens: used,
      filesWritten: [...(ctx.filesWritten ?? [])],
      todos: todoState(ctx.cwd),
      lastAssistant: last,
      recent: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const handoffPath = saveHandoff(ctx.cwd, role, opts.continuation ?? 0, handoff);
    emitGlobalHook("agent.turn.end", { role, model: usedModel, checkpoint: reason });
    return withFallbacks({
      role,
      model: usedModel,
      output: last || `Run checkpointed (${reason}) — a continuation run resumes from the handoff packet.`,
      status: "resumable",
      handoff,
      handoffPath,
    });
  };
  for (let i = 0; i < effectiveSteps; i++) {
    // Stream only at the root turn — subagent/parallel outputs would interleave.
    checkRun();
    const renderer = scopedRenderer();
    // Context compaction: fold the middle of the conversation into a summary
    // so long tool loops stay inside the small-model window. Adaptive runs
    // re-fire on window pressure (min 3 steps apart) with a per-model
    // threshold; legacy runs keep the single-shot fixed 60k-char behavior.
    if (adaptive && ledger) {
      const pressure = ledger.pressure(messages);
      liveContextState = {
        model: usedModel,
        windowTokens: ledger.windowTokens,
        budgetTokens: ledger.budgetTokens,
        usedTokens: ledger.usedTokens(messages),
        pressure,
      };
      const thresholdChars = Math.max(8_000, Math.floor(ledger.budgetTokens * policy.lowWatermark * 4));
      const plan = planCompaction(messages, thresholdChars);
      if (plan && i - lastCompactStep >= 3) {
        lastCompactStep = i;
        try {
          const summary = await compactConversation(plan, config);
          messages.splice(0, messages.length,
            plan.keep[0],
            { role: "user", content: `[Earlier conversation compacted by the compaction agent]\n${summary}` },
            ...plan.keep.slice(1));
          if (opts.stats) opts.stats.compactions++;
          renderer?.(`\n\x1b[2m[RA compaction: ${plan.summarize.length} messages folded into a summary]\x1b[0m\n`);
        } catch { /* compaction is best-effort */ }
      }
      const after = ledger.pressure(messages);
      if (after === "critical") return checkpoint("low-context");
      if (after === "low" && !lowWarned) {
        // Shorter runs under pressure: wrap up within 2 steps, no subagents,
        // and tell the model to restate the objective + TODO state.
        lowWarned = true;
        spawnDisabled = true;
        effectiveSteps = Math.min(effectiveSteps, i + 2);
        const remaining = ledger.remaining(messages);
        messages.push({ role: "user", content: lowContextNotice(remaining) });
        renderer?.(`\n\x1b[2m[RA context low: ~${remaining} tokens left — wrapping up for a continuation run]\x1b[0m\n`);
      }
    } else if (!compacted) {
      const plan = planCompaction(messages);
      if (plan) {
        compacted = true;
        try {
          const summary = await compactConversation(plan, config);
          messages.splice(0, messages.length,
            plan.keep[0],
            { role: "user", content: `[Earlier conversation compacted by the compaction agent]\n${summary}` },
            ...plan.keep.slice(1));
          renderer?.(`\n\x1b[2m[RA compaction: ${plan.summarize.length} messages folded into a summary]\x1b[0m\n`);
        } catch { /* compaction is best-effort */ }
      }
    }
    const keepAlive = env.OLLAMA_KEEP_ALIVE ?? "30m";
    const chat = async () => {
      const signal = reserveCall();
      const response = await activeClient.nativeChatStream(usedModel, messages, {
        temperature,
        keepAlive,
        signal,
        onToken: renderer,
        // Reserve the window the registry promised (num_ctx) — without it
        // native Ollama silently truncates to its small server default.
        ...(adaptive && ledger ? { contextTokens: ledger.windowTokens } : {}),
      });
      if (!response.content.trim()) throw new Error(`Empty response from ${usedModel}`);
      return response;
    };
    // Explicit model fallback: provider errors try the chains. Auth failures
    // and user cancellations never fall back; quota errors mark the provider
    // exhausted (cooldown) and keep failing over — never silently abort work.
    const chatWithFallback = async () => {
      try {
        return await withRetry(chat);
      } catch (e) {
        // Context overflow is not an outage and the fallback chain can't fix
        // an unsendable prompt — checkpoint + resume instead (ra.78).
        if (adaptive && isContextOverflowError(e)) throw e;
        const quotaHit = isQuotaError(e) && !isAuthError(e);
        if (quotaHit) markExhausted(usedModel, String(e instanceof Error ? e.message : e).slice(0, 120));
        const chain = fallbackModels;
        if (chain.length === 0 || isAuthError(e) || isUserCancel(e)) throw e;
        const primary = usedModel;
        const reason = (quotaHit ? "quota exhausted — " : "") + String(e instanceof Error ? e.message : e).slice(0, 160);
        let lastErr: unknown = e;
        for (const candidate of chain) {
          if (candidate === usedModel) continue;
          const t0 = Date.now();
          try {
            // Cross-provider candidates need their own client (own host/key).
            const picked = await pickClientForModel(candidate, env, config.provider as Record<string, import("../../anubis/src/ollama.ts").ProviderDef> | undefined);
            usedModel = picked.model;
            activeClient = picked.client;
            const r = await withRetry(chat);
            fallbackEvents.push({ from: primary, to: candidate, reason, ms: Date.now() - t0 });
            renderer?.(`\n\x1b[2m[RA fallback: ${primary} unavailable (${reason}) — using ${candidate}]\x1b[0m\n`);
            return r;
          } catch (candErr) {
            lastErr = candErr;
            if (isAuthError(candErr) || isUserCancel(candErr)) break;
            if (isQuotaError(candErr)) markExhausted(candidate, String(candErr instanceof Error ? candErr.message : candErr).slice(0, 120));
          }
        }
        throw new Error(`Model ${primary} failed (${reason}); fallbacks [${chain.join(", ")}] did not recover. Last error: ${String(lastErr instanceof Error ? lastErr.message : lastErr).slice(0, 200)}`);
      }
    };
    let res;
    try {
      res = await chatWithFallback();
    } catch (e) {
      // The provider refused the prompt as too large: checkpoint and let the
      // adaptive loop resume with a compact handoff instead of dying.
      if (adaptive && isContextOverflowError(e)) return checkpoint("context-overflow");
      throw e;
    }
    checkRun();
    renderer?.("\n");
    usedModel = res.model;
    last = res.content;
    if (!last.trim()) throw new Error(`Model ${usedModel} returned an empty response`);
    if (adaptive && ledger) {
      // Re-resolve the window when the model changed mid-run (failover), then
      // calibrate the ledger with real token counts (messages.length here is
      // the prompt size the provider just reported on).
      if (ledger.model !== usedModel) await refreshLedger(usedModel);
      ledger.noteUsage(res.usage, messages.length);
      if (opts.stats) opts.stats.usedTokens = ledger.usedTokens([...messages, { role: "assistant", content: last }]);
    }
    const inChars = messages.reduce((n, m) => n + m.content.length, 0);
    recordChatUsage(res.model, activeClient.kind === "cloud", res.usage, { in: inChars, out: last.length }, ctx.cwd);
    messages.push({ role: "assistant", content: last });

    const tool = await execToolBlock(ctx, last, config, agentPerms, spawn, bashPatterns, mcpRt.call);
    if ((tool.done || !tool.note) && needsEdit && ctx.mutations!.count === initialWrites) {
      if (completionRepairs++ >= 1 || i === steps - 1) throw new Error(`Agent ${role} ended without applying the requested edits. Last response: ${last.slice(0, 1200)}`);
      messages.push({ role: "user", content: "No file edits were performed. Complete the requested change using WRITE or EDIT now; a description or simulated tool call is not completion." });
      continue;
    }
    if (tool.done) {
      emitGlobalHook("agent.turn.end", { role, model: res.model });
      rootOutput = tool.note || last;
      return withFallbacks({ role, model: res.model, output: rootOutput });
    }
    if (tool.note) {
      messages.push({ role: "user", content: `Tool result:\n${tool.note}\nContinue your assigned role using only permitted tools. Return DONE with your summary when finished.` });
      if (i === effectiveSteps - 1) {
        // Adaptive runs under context pressure checkpoint instead of dying —
        // a continuation run picks up from the handoff packet.
        const pressured = lowWarned || (ledger?.pressure(messages) ?? "ok") !== "ok";
        if (adaptive && pressured) return checkpoint("step-limit");
        throw new Error(`Agent ${role} reached its ${effectiveSteps}-step limit before finishing. Last tool result: ${tool.note.slice(0, 200)}`);
      }
      continue;
    }
    break;
  }
  emitGlobalHook("agent.turn.end", { role, model: usedModel });
  rootOutput = last;
  return withFallbacks({ role, model: usedModel, output: last });
  }
}

import { SubagentTree } from "./tui/tree.ts";

/** Track subagent spawns for TUI tree display. */
export function createSubagentTracker(): SubagentTree {
  return new SubagentTree();
}

export async function runOrchestratorTurn(
  userText: string,
  config: RaConfig,
  ctx: ToolContext,
): Promise<string> {
  const env = loadEnv(ANUBIS_HOME);

  if (userText.startsWith("read ")) return tools.toolRead(ctx, userText.slice(5).trim());
  if (/^ls(?:\s|$)/.test(userText) || userText === "list") {
    return tools.listDir(ctx, userText.replace(/^ls\s*/, "") || ".");
  }

  // Coding / create tasks → ptah tool loop
  if (/\b(create|write|make|build|implement|add)\b/i.test(userText)) {
    let modelTag = "local";
    let output = "";
    try {
      const r = await runTaskAgent("ptah", userText, config, ctx, env);
      modelTag = r.model;
      output = r.output;
    } catch (e) {
      output = `Error: ${String(e)}`;
    }
    return `## ptah (${modelTag})\n${output}`;
  }

  return withAgentRun({ limits: config.agent_limits, signal: ctx.signal, renderer: activeStreamRenderer }, async () => {
  const { client, model } = await pickClientForModel(config.small_model ?? config.model, env, config.provider as Record<string, import("../../anubis/src/ollama.ts").ProviderDef> | undefined);
  const system = "You are RA, a concise coding assistant. This is a direct conversation: no role agents or tools ran for this reply. Answer the user directly; never invent tool execution, model names, or delegated work." + loadProjectMemory(ctx.cwd);
  const res = await withRetry(() => client.nativeChatStream(model, [
    { role: "system", content: system }, ...(ctx.history ?? []), { role: "user", content: userText },
  ], { signal: reserveCall(), onToken: scopedRenderer() }));
  recordChatUsage(res.model, client.kind === "cloud", res.usage, {
    in: system.length + userText.length,
    out: res.content.length,
  }, ctx.cwd);
  return res.content;
  });
}

// ---- MoA aggregation (Phase 0.6) ----

export interface MoAResult {
  role: string;
  model: string;
  output: string;
}

const FILE_RE = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|html|css|ya?ml)\b/g;

/**
 * Heuristic disagreement detection across role outputs: conflicting file
 * targets, or some roles erroring while others succeed. Pure — unit-tested.
 */
export function surfaceDisagreements(results: MoAResult[]): string[] {
  const notes: string[] = [];
  const fileSets = results.map((r) => ({
    role: r.role,
    files: [...new Set((r.output.match(FILE_RE) ?? []).map((f) => f.replace(/^\.\//, "")))],
    errored: /\b(error|failed|cannot|unable)\b/i.test(r.output),
  }));
  const allFiles = new Set(fileSets.flatMap((f) => f.files));
  const contested = [...allFiles].filter((file) => {
    const touchers = fileSets.filter((f) => f.files.includes(file)).map((f) => f.role);
    return touchers.length > 0 && touchers.length < results.length && results.length > 1;
  });
  for (const file of contested.slice(0, 5)) {
    const touchers = fileSets.filter((f) => f.files.includes(file)).map((f) => f.role);
    notes.push(`${file}: only ${touchers.join(", ")} considered it`);
  }
  const errored = fileSets.filter((f) => f.errored).map((f) => f.role);
  const ok = fileSets.filter((f) => !f.errored).map((f) => f.role);
  if (errored.length && ok.length) {
    notes.push(`${errored.join(", ")} reported failures while ${ok.join(", ")} succeeded`);
  }
  return notes;
}

/** Synthesize MOA role outputs into one answer via the small model. */
export async function aggregateMoa(task: string, results: MoAResult[], config: RaConfig): Promise<string> {
  return withAgentRun({ limits: config.agent_limits, tree: activeTracker }, () => withAgentScope("synthesis", task, async scope => {
  const env = loadEnv(ANUBIS_HOME);
  const { client, model } = await pickClientForModel(config.small_model ?? config.model, env, config.provider as Record<string, import("../../anubis/src/ollama.ts").ProviderDef> | undefined);
  const { buildAggregatePrompt } = await import("../../anubis/src/aggregator.ts");
  const prompt = buildAggregatePrompt(
    task,
    results.map((r) => ({ role: r.role, model: r.model, output: r.output })),
  );
  scope.node && (scope.node.model = model);
  const res = await withRetry(() => client.nativeChatStream(model, [
    {
      role: "system",
      content:
        "You are the RA Mixture-of-Agents aggregator. Merge the role outputs into one coherent, correct answer to the task. Resolve conflicts by preferring the most defensible output. Be concise; do not mention the aggregation process.",
    },
    { role: "user", content: prompt },
  ], { signal: reserveCall() }));
  recordChatUsage(res.model, client.kind === "cloud", res.usage, {
    in: prompt.length,
    out: res.content.length,
  });
  const disagreements = surfaceDisagreements(results);
  const notes = disagreements.length
    ? `\n\nDisagreements:\n${disagreements.map((d) => `- ${d}`).join("\n")}`
    : "";
  return `## MoA synthesis (${res.model})\n${res.content}${notes}`;
  }));
}
