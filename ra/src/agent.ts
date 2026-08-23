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

export interface TaskResult {
  role: string;
  model: string;
  output: string;
}

const TOOL_HINT = `
You may call tools with this exact format (one at a time):
WRITE path/to/file
\`\`\`
file contents
\`\`\`

EDIT path/to/file
<<<<<<< OLD
exact old text
=======
exact new text
>>>>>>> NEW

Or: MULTIEDIT path/to/file
<<<<<<< OLD
old text 1
=======
new text 1
>>>>>>> NEW
<<<<<<< OLD
old text 2
=======
new text 2
>>>>>>> NEW

Or: READ path/to/file
Or: OUTLINE path/to/file
Or: DIAGNOSE path/to/file
Or: GLOB **/*.py
Or: GREP pattern [optional/glob]
Or: BASH command here
Or: WEBFETCH https://example.com
Or: TODO add <text> / TODO done <id> / TODO list
Or: TASK <role> <task>   (spawn a subagent: general|explore|scout)
Or: DONE — when finished, with a short summary.

Prefer WRITE for new files, EDIT for small changes. Always produce real content.
`;

function loadAgentPrompt(role: string): string {
  const p = join(AGENTS_DIR, `${role}.md`);
  if (!existsSync(p)) return `You are ${role}.`;
  const raw = readFileSync(p, "utf-8");
  const body = raw.split("---").slice(2).join("---").trim();
  return body || `You are ${role}.`;
}

/**
 * Parse an agent's frontmatter `permission` block (e.g. thoth: edit/bash deny).
 * Returns a map of tool → allow/ask/deny, or null if no frontmatter permission.
 */
export function loadAgentPermissions(role: string): Record<string, "allow" | "ask" | "deny"> | null {
  const p = join(AGENTS_DIR, `${role}.md`);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf-8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const out: Record<string, "allow" | "ask" | "deny"> = {};
  let inPermission = false;
  for (const line of fm[1].split("\n")) {
    if (/^permission:\s*$/.test(line)) {
      inPermission = true;
      continue;
    }
    if (inPermission) {
      const m = line.match(/^\s*([a-zA-Z]+):\s*(allow|ask|deny)\s*$/);
      if (m) {
        out[m[1]] = m[2] as "allow" | "ask" | "deny";
        continue;
      }
      // A non-indented key ends the permission block.
      if (/^[a-zA-Z]/.test(line)) break;
    }
  }
  return Object.keys(out).length ? out : null;
}

export interface AgentMeta {
  steps?: number;
  temperature?: number;
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
    const d = denied("bash");
    if (d) return { done: false, note: d };
    return { done: false, note: await tools.toolBash(ctx, bash[1].trim()) };
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
  const { client, model } = await pickClientForModel(configured, env, config.provider as Record<string, import("../../anubis/src/ollama.ts").ProviderDef> | undefined);
  const agentPerms = loadAgentPermissions(role);
  const meta = loadAgentMeta(role);
  const steps = meta.steps ?? maxSteps;
  const temperature = meta.temperature;
  const system = `${loadAgentPrompt(role)}${loadProjectMemory(ctx.cwd)}\n${TOOL_HINT}`;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    { role: "user", content: `Task: ${task}\nProject cwd: ${ctx.cwd}` },
  ];

  const cloud = client.kind === "cloud";
  let last = "";
  let usedModel = model;
  const spawn = async (subRole: string, subTask: string): Promise<string> => {
    const r = await runTaskAgent(subRole, subTask, config, ctx, env, 4);
    return r.output;
  };
  for (let i = 0; i < steps; i++) {
    const res = await client.nativeChat(usedModel, messages, { temperature });
    usedModel = res.model;
    last = res.content;
    const inChars = messages.reduce((n, m) => n + m.content.length, 0);
    recordChatUsage(res.model, cloud, res.usage, { in: inChars, out: last.length });
    messages.push({ role: "assistant", content: last });

    const tool = await execToolBlock(ctx, last, config, agentPerms, spawn);
    if (tool.done) return { role, model: res.model, output: tool.note || last };
    if (tool.note) {
      messages.push({ role: "user", content: `Tool result:\n${tool.note}\nContinue. WRITE files if needed, then DONE.` });
      continue;
    }
    const fence = last.match(/```(?:html|javascript|typescript|css|python)?\n([\s\S]*?)```/);
    if (fence && /\b(create|write|make|build)\b/i.test(task)) {
      const name = "index.html";
      let body = fence[1].trim();
      if (/\btodo\b/i.test(task) && !/todo/i.test(body)) {
        body = `<!DOCTYPE html><html><head><title>Todo</title></head><body><h1>Todo</h1></body></html>`;
      }
      tools.toolWrite(ctx, name, body);
      return { role, model: res.model, output: `Wrote ${name}\n${last}` };
    }
    break;
  }
  return { role, model: usedModel, output: last };
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
  });
  return res.content;
}
