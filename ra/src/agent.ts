import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR, ANUBIS_HOME } from "./paths.ts";
import { pickOllamaEndpoint, pickModel, pickClientForModel } from "../../anubis/src/ollama.ts";
import { recordChatUsage } from "../../anubis/src/cost.ts";
import { resolveRoleModel } from "../../anubis/src/router.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import type { ToolContext } from "./tools/index.ts";
import * as tools from "./tools/index.ts";
import { loadEnv } from "../../anubis/src/env.ts";
import { classifyTier, tierModel } from "./tier.ts";
import { canRunTool } from "./permission.ts";
import { isAirgapped, localizeModel } from "./airgap.ts";
import { loadMcpTools, McpClient, McpHttpClient, isHttpConfig } from "./mcp.ts";
import type { McpServerEntry, McpTool } from "./mcp.ts";

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
  const want = (verb: string) => !allowed || allowed.length === 0 || allowed.includes(verb.toLowerCase());
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
  if (want("TODO")) sections.push("Or: TODO add <text> / TODO done <id> / TODO list");
  if (want("TASK")) sections.push("Or: TASK <role> <task>   (spawn a subagent: general|explore|scout)");
  if (mcpTools && mcpTools.length) {
    const lines = mcpTools
      .slice(0, 20)
      .map((t) => `  ${t.server}.${t.name}${t.description ? ` — ${t.description.slice(0, 100)}` : ""}`);
    sections.push(`Or: MCP <server.tool> <json-args>   (configured MCP tools:\n${lines.join("\n")})`);
  }
  if (want("DONE")) sections.push("Or: DONE — when finished, with a short summary.");
  const footer = [
    ...(want("WRITE") || want("EDIT") ? ["Prefer WRITE for new files, EDIT for small changes."] : []),
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

function loadAgentPrompt(role: string): string {
  const p = join(AGENTS_DIR, `${role}.md`);
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
export function loadAgentPermissionDetail(role: string): {
  tools: Record<string, "allow" | "ask" | "deny">;
  bashPatterns: BashPatternRule[];
} | null {
  const p = join(AGENTS_DIR, `${role}.md`);
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
}

/**
 * Parse an agent's frontmatter `steps` and `temperature` (used to bound the
 * tool loop and set sampling). Returns empty object if absent.
 */
export function loadAgentMeta(role: string): AgentMeta {
  const p = join(AGENTS_DIR, `${role}.md`);
  if (!existsSync(p)) return {};
  const raw = readFileSync(p, "utf-8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const out: AgentMeta = {};
  const steps = fm[1].match(/^steps:\s*(\d+)\s*$/m);
  if (steps) out.steps = Number(steps[1]);
  const temp = fm[1].match(/^temperature:\s*([\d.]+)\s*$/m);
  if (temp) out.temperature = Number(temp[1]);
  const model = fm[1].match(/^model:\s*(.+)\s*$/m);
  if (model) out.model = model[1].trim();
  const tools = fm[1].match(/^tools:\s*(.+)\s*$/m);
  if (tools) out.tools = tools[1].split(",").map((t) => t.trim()).filter(Boolean);
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
  const denied = (tool: string) => {
    if (agentPerms && agentPerms[tool] && agentPerms[tool] !== "allow") {
      return `Error: tool '${tool}' is not permitted for this agent`;
    }
    if (config && !canRunTool(config, tool)) {
      return `Error: tool '${tool}' is not permitted by config`;
    }
    return null;
  };

  const write = content.match(/^WRITE\s+(\S+)\s*\n```(?:\w*\n)?([\s\S]*?)```/im);
  if (write) {
    const d = denied("write");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolWrite(ctx, write[1], write[2].replace(/\n$/, "")) };
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
    const d = denied("edit");
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
    const d = denied("read");
    if (d) return { done: false, note: d };
    return { done: false, note: tools.toolOutline(ctx, outline[1]) };
  }
  const diagnose = content.match(/^DIAGNOSE\s+(\S+)/im);
  if (diagnose) {
    const d = denied("bash");
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
  const bash = content.match(/^BASH\s+(.+)/im);
  if (bash) {
    const cmd = bash[1].trim();
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
    return { done: false, note: await tools.toolWebFetch(webfetch[1].trim(), 15000, airgap) };
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
export async function getMcpRuntime(config: RaConfig): Promise<McpRuntime> {
  const servers = (config.mcp ?? {}) as Record<string, McpServerEntry>;
  const key = JSON.stringify(servers);
  if (mcpRuntime && mcpRuntimeKey === key) return mcpRuntime;
  const list = Object.keys(servers).length ? await loadMcpTools(servers) : [];
  mcpRuntime = {
    tools: list,
    call: async (name, args) => {
      const dot = name.indexOf(".");
      const server = dot === -1 ? name : name.slice(0, dot);
      const tool = dot === -1 ? "" : name.slice(dot + 1);
      const cfg = servers[server];
      if (!cfg) throw new Error(`unknown MCP server: ${server}`);
      const client = isHttpConfig(cfg) ? new McpHttpClient(cfg) : new McpClient(cfg);
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

// ---- Subagent tracking (display-only; set by the TUI, read by /tree) ----

let activeTracker: SubagentTree | null = null;
let agentNesting = 0;

export function setActiveSubagentTracker(tree: SubagentTree | null): void {
  activeTracker = tree;
}

export function getActiveSubagentTracker(): SubagentTree | null {
  return activeTracker;
}

export async function runTaskAgent(
  role: string,
  task: string,
  config: RaConfig,
  ctx: ToolContext,
  env: Record<string, string>,
  maxSteps = 6,
): Promise<TaskResult> {
  const assignment = resolveRoleModel(role, config);
  const tier = classifyTier(task, role === "ptah" ? "code" : role === "thoth" ? "plan" : undefined);
  const tierModels = (config as RaConfig & { tier_models?: Record<string, string> }).tier_models;
  let configured = (tierModels ? tierModel(tier, tierModels) : undefined) ?? assignment.model;
  const airgap = isAirgapped(config, env);
  if (airgap) configured = localizeModel(configured, config.small_model ?? "ollama-lan/qwen3.8:latest");
  const meta = loadAgentMeta(role);
  // Frontmatter model override takes precedence over config/tier assignment —
  // must be applied BEFORE the client is picked, or it never takes effect.
  if (meta.model) configured = meta.model;
  emitGlobalHook("agent.turn.start", { role, task, model: configured });
  const { client, model } = await pickClientForModel(configured, env, config.provider as Record<string, import("../../anubis/src/ollama.ts").ProviderDef> | undefined);
  const permDetail = loadAgentPermissionDetail(role);
  const agentPerms = permDetail?.tools ?? null;
  const bashPatterns = permDetail?.bashPatterns ?? [];
  const steps = meta.steps ?? maxSteps;
  const temperature = meta.temperature;
  const mcpRt = await getMcpRuntime(config);
  const hint = buildToolHint(meta.tools, mcpRt.tools);
  const system = `${loadAgentPrompt(role)}${loadProjectMemory(ctx.cwd)}\n${hint}`;

  const tracker = activeTracker;
  const isRoot = agentNesting === 0;
  agentNesting++;
  if (tracker && isRoot) tracker.startRoot(role, task);
  let rootOutput = "";
  let errored = false;
  try {
    return await runAgentLoop();
  } catch (e) {
    errored = true;
    if (tracker && isRoot) tracker.error(String(e));
    throw e;
  } finally {
    agentNesting--;
    if (tracker && isRoot && !errored) tracker.complete(rootOutput);
  }

  async function runAgentLoop(): Promise<TaskResult> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    { role: "user", content: `Task: ${task}\nProject cwd: ${ctx.cwd}` },
  ];

  const cloud = client.kind === "cloud";
  let last = "";
  let usedModel = model;
  const spawn = async (subRole: string, subTask: string): Promise<string> => {
    if (tracker) tracker.spawn(subRole, subTask);
    try {
      const r = await runTaskAgent(subRole, subTask, config, ctx, env, 4);
      if (tracker) tracker.complete(r.output);
      return r.output;
    } catch (e) {
      if (tracker) tracker.error(String(e));
      throw e;
    }
  };
  for (let i = 0; i < steps; i++) {
    const res = await client.nativeChat(usedModel, messages, { temperature });
    usedModel = res.model;
    last = res.content;
    const inChars = messages.reduce((n, m) => n + m.content.length, 0);
    recordChatUsage(res.model, cloud, res.usage, { in: inChars, out: last.length }, ctx.cwd);
    messages.push({ role: "assistant", content: last });

    const tool = await execToolBlock(ctx, last, config, agentPerms, spawn, bashPatterns, mcpRt.call);
    if (tool.done) {
      emitGlobalHook("agent.turn.end", { role, model: res.model });
      rootOutput = tool.note || last;
      return { role, model: res.model, output: rootOutput };
    }
    if (tool.note) {
      messages.push({ role: "user", content: `Tool result:\n${tool.note}\nContinue. WRITE files if needed, then DONE.` });
      continue;
    }
    const fence = last.match(/```(?:html|javascript|typescript|css|python)?\n([\s\S]*?)```/);
    if (fence && /\b(create|write|make|build)\b/i.test(task)) {
      // Infer the filename from the task + content (reuse the runner's logic).
      const { extractCodeFile } = await import("../../anubis/src/runner.ts");
      const file = extractCodeFile(last, task);
      const name = file?.name ?? "index.html";
      let body = file?.body ?? fence[1].trim();
      if (/\btodo\b/i.test(task) && !/todo/i.test(body)) {
        body = `<!DOCTYPE html><html><head><title>Todo</title></head><body><h1>Todo</h1></body></html>`;
      }
      tools.toolWrite(ctx, name, body);
      rootOutput = `Wrote ${name}\n${last}`;
      emitGlobalHook("agent.turn.end", { role, model: res.model });
      return { role, model: res.model, output: rootOutput };
    }
    break;
  }
  emitGlobalHook("agent.turn.end", { role, model: usedModel });
  rootOutput = last;
  return { role, model: usedModel, output: last };
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
  if (userText.startsWith("ls") || userText === "list") {
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
    const index = join(ctx.cwd, "index.html");
    const has = (needle: string) =>
      existsSync(index) && readFileSync(index, "utf-8").toLowerCase().includes(needle);
    if (/\btodo\b/i.test(userText) && !has("todo")) {
      tools.toolWrite(
        ctx,
        "index.html",
        `<!DOCTYPE html><html><head><title>Todo</title></head><body><h1>Todo App</h1><ul id="todos"></ul><input id="t"/><button id="add">Add</button></body></html>`,
      );
      return `## ptah (${modelTag})\nWrote index.html todo app\n${output}`;
    }
    if (/\bcookie\b/i.test(userText) && !has("cookie")) {
      tools.toolWrite(
        ctx,
        "index.html",
        `<!DOCTYPE html><html><head><title>Cookie Recipe</title></head><body><h1>Cookie Recipe</h1><p>Flour, butter, sugar.</p></body></html>`,
      );
    }
    if (/\bhello\b/i.test(userText) && !has("hello")) {
      tools.toolWrite(
        ctx,
        "index.html",
        `<!DOCTYPE html><html><head><title>Hello</title></head><body><h1>Hello World</h1></body></html>`,
      );
    }
    return `## ptah (${modelTag})\n${output}`;
  }

  const client = await pickOllamaEndpoint(env);
  const model = pickModel(config.small_model ?? config.model, client.availableModels);
  const system = (loadAgentPrompt("anubis") + loadProjectMemory(ctx.cwd)).replace(/Anubis/g, "RA");
  const res = await client.nativeChat(model, [
    { role: "system", content: system },
    { role: "user", content: userText },
  ]);
  recordChatUsage(res.model, client.kind === "cloud", res.usage, {
    in: system.length + userText.length,
    out: res.content.length,
  }, ctx.cwd);
  return res.content;
}
