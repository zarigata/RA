// src/router.ts — role→model resolution (pure, testable). No model is ever locked.

export interface AgentConfig {
  model?: string;
}

export interface RouterConfig {
  agent: Record<string, AgentConfig>;
  model: string; // global default
}

export const ROLES = [
  "anubis",
  "thoth",
  "ptah",
  "maat",
  "sekhmet",
  "isis",
  "seshat",
  "horus",
] as const;

export type Role = (typeof ROLES)[number];

export interface RoleAssignment {
  role: string;
  model: string;
  source: "flag" | "config" | "default";
}

// Priority: flag > config (agent.<role>.model) > global default
export function resolveRoleModel(
  role: string,
  config: RouterConfig,
  flagModel?: string,
): RoleAssignment {
  if (flagModel) return { role, model: flagModel, source: "flag" };
  const agentCfg = config.agent?.[role];
  if (agentCfg?.model) return { role, model: agentCfg.model, source: "config" };
  return { role, model: config.model, source: "default" };
}

export function resolveAll(
  config: RouterConfig,
  flagModel?: string,
): RoleAssignment[] {
  return ROLES.map((r) => resolveRoleModel(r, config, flagModel));
}

export function formatAssignments(assignments: RoleAssignment[]): string {
  const header = "ROLE        MODEL                          SOURCE";
  const sep = "-".repeat(header.length);
  const rows = assignments.map((a) => {
    const role = a.role.padEnd(12);
    const model = a.model.padEnd(30);
    return `${role}${model}${a.source}`;
  });
  return [header, sep, ...rows].join("\n");
}

export function validateConfig(config: unknown): config is RouterConfig {
  if (typeof config !== "object" || config === null) return false;
  const c = config as Record<string, unknown>;
  if (typeof c.model !== "string") return false;
  if (typeof c.agent !== "object" || c.agent === null) return false;
  return true;
}
