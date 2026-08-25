// Permission engine — per-tool allow/ask/deny rules from config.

import type { RaConfig } from "../../anubis/src/config.ts";

export type Permission = "allow" | "ask" | "deny";

/** Map a tool name to its permission rule. Defaults to "allow" when unset. */
export function toolPermission(config: RaConfig, tool: string): Permission {
  const rules = config.permission?.tool ?? {};
  return rules[tool] ?? "allow";
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
