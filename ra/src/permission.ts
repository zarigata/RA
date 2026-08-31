// Permission engine — per-tool allow/ask/deny rules from config.

import type { RaConfig } from "../../anubis/src/config.ts";

export type Permission = "allow" | "ask" | "deny";

export const TOOL_VERBS = ["write", "edit", "multiedit", "read", "outline", "diagnose", "glob", "grep", "bash", "webfetch", "todo", "task", "mcp", "done"] as const;
export interface BashRule { pattern: string; level: Permission }
export interface AgentCapabilities {
  readonly tools: ReadonlySet<string>;
  readonly readOnly: boolean;
  readonly bashLayers: ReadonlyArray<{ rules: ReadonlyArray<BashRule>; fallback: Permission }>;
}
const permissionVerb = (verb: string) => verb === "multiedit" ? "edit" : verb === "outline" ? "read" : verb === "diagnose" ? "bash" : verb;

/** A child can narrow its inherited capabilities, never expand them. */
export function resolveCapabilities(config: RaConfig, role: Record<string, Permission> = {}, whitelist?: string[], bashRules: BashRule[] = [], parent?: AgentCapabilities): AgentCapabilities {
  const level = (tool: string) => role[tool] ?? (tool === "write" ? role.edit : undefined) ?? role["*"] ?? "allow";
  const roleAllows = (verb: string) => {
    const permission = permissionVerb(verb);
    const allowed = verb !== "diagnose" && permission === "bash" && bashRules.some(r => r.level === "allow") ? true : level(permission) === "allow";
    return allowed && canRunTool(config, permission) && canRunTool(config, verb);
  };
  const readOnly = parent?.readOnly === true || process.env.RA_SANDBOX === "read-only" || config.sandbox?.mode === "read-only" ||
    ((!canRunTool(config, "write") || level("write") !== "allow") && (!canRunTool(config, "edit") || level("edit") !== "allow"));
  const names = whitelist?.map(t => t.toLowerCase());
  const tools = new Set(TOOL_VERBS.filter(verb => verb === "done" ||
    ((!names || names.includes(verb)) && roleAllows(verb) && (!parent || parent.tools.has(verb)) &&
      !(readOnly && ["write", "edit", "multiedit", "todo", "mcp"].includes(verb)))));
  return { tools, readOnly, bashLayers: [...(parent?.bashLayers ?? []), { rules: bashRules, fallback: level("bash") }] };
}

export function assertTool(capabilities: AgentCapabilities | undefined, verb: string): void {
  if (capabilities && !capabilities.tools.has(verb)) throw new Error(`Tool '${verb}' is not permitted by inherited agent capabilities`);
}

export function assertBash(capabilities: AgentCapabilities | undefined, command: string): void {
  if (!capabilities) return;
  for (const layer of capabilities.bashLayers) {
    const match = layer.rules.find(r => r.pattern !== "*" && new RegExp("^" + r.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(command.trim()));
    if ((match?.level ?? layer.fallback) !== "allow") throw new Error("Shell command is not permitted by inherited agent capabilities");
  }
}

/** Map a tool name to its permission rule. Defaults to "allow" when unset. */
export function toolPermission(config: RaConfig, tool: string): Permission {
  const rules = config.permission?.tool ?? {};
  return rules[tool] ?? (tool === "write" ? rules.edit : undefined) ?? rules["*"] ?? "allow";
}

/**
 * Decide whether a tool call may proceed.
 * - allow → true
 * - deny  → false
 * - ask   → depends on `autoApprove`: if true, proceed; if false (headless), deny.
 *
 * When `onAsk` is provided, it's called for `ask` rules to get interactive
 * approval. In TUI mode this can prompt the user; in headless mode it auto-denies.
 */
export function canRunTool(
  config: RaConfig,
  tool: string,
  opts?: { autoApprove?: boolean; onAsk?: (tool: string) => boolean },
): boolean {
  const perm = toolPermission(config, tool);
  if (perm === "allow") return true;
  if (perm === "deny") return false;
  // ask mode
  if (opts?.onAsk) return opts.onAsk(tool);
  return opts?.autoApprove ?? false;
}

/** List tools that are explicitly denied or require approval. */
export function restrictedTools(config: RaConfig): string[] {
  const rules = config.permission?.tool ?? {};
  return Object.entries(rules)
    .filter(([, v]) => v !== "allow")
    .map(([k]) => k);
}
