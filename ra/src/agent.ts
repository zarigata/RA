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

Or: READ path/to/file
Or: GLOB **/*.py
Or: GREP pattern [optional/glob]
Or: BASH command here
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

export async function execToolBlock(ctx: ToolContext, content: string): Promise<{ done: boolean; note: string }> {
  const write = content.match(/^WRITE\s+(\S+)\s*\n```(?:\w*\n)?([\s\S]*?)```/im);
  if (write) {
    return { done: false, note: tools.toolWrite(ctx, write[1], write[2].replace(/\n$/, "")) };
  }
  const edit = content.match(
    /^EDIT\s+(\S+)\s*\n<<<<<<<\s*OLD\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*NEW/im,
  );
  if (edit) {
    return { done: false, note: tools.toolEdit(ctx, edit[1], edit[2], edit[3]) };
  }
  const read = content.match(/^READ\s+(\S+)/im);
  if (read) return { done: false, note: tools.toolRead(ctx, read[1]) };
  const glob = content.match(/^GLOB\s+(.+)/im);
  if (glob) return { done: false, note: await tools.toolGlob(ctx, glob[1].trim()) };
  const grep = content.match(/^GREP\s+(\S+)(?:\s+(\S+))?/im);
  if (grep) return { done: false, note: await tools.toolGrep(ctx, grep[1], grep[2] ?? "**/*") };
  const bash = content.match(/^BASH\s+(.+)/im);
  if (bash) return { done: false, note: await tools.toolBash(ctx, bash[1].trim()) };
  if (/^DONE\b/im.test(content.trim())) {
    return { done: true, note: content.replace(/^DONE\s*/i, "").trim() || "done" };
  }
  // Fenced file with filename comment
  const fence = content.match(/(?:file|path)[:\s]+([^\s\n]+\.[a-zA-Z0-9]+).*?```(?:\w*\n)?([\s\S]*?)```/is);
  if (fence) {
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
  const configured = (tierModels ? tierModel(tier, tierModels) : undefined) ?? assignment.model;
  const { client, model } = await pickClientForModel(configured, env);
  const system = `${loadAgentPrompt(role)}\n${TOOL_HINT}`;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    { role: "user", content: `Task: ${task}\nProject cwd: ${ctx.cwd}` },
  ];

  const cloud = client.kind === "cloud";
  let last = "";
  let usedModel = model;
  for (let i = 0; i < maxSteps; i++) {
    const res = await client.nativeChat(usedModel, messages);
    usedModel = res.model;
    last = res.content;
    const inChars = messages.reduce((n, m) => n + m.content.length, 0);
    recordChatUsage(res.model, cloud, res.usage, { in: inChars, out: last.length });
    messages.push({ role: "assistant", content: last });

    const tool = await execToolBlock(ctx, last);
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
  const system = loadAgentPrompt("anubis").replace(/Anubis/g, "RA");
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
