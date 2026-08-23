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
 * - ask   → false (interactive approval not yet wired; treated as deny in headless)
 */
export function canRunTool(config: RaConfig, tool: string): boolean {
  return toolPermission(config, tool) === "allow";
}

/** List tools that are explicitly denied or require approval. */
export function restrictedTools(config: RaConfig): string[] {
  const rules = config.permission?.tool ?? {};
  return Object.entries(rules)
    .filter(([, v]) => v !== "allow")
    .map(([k]) => k);
}
