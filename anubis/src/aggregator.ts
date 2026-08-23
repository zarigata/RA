// src/aggregator.ts — moa output aggregation (pure, testable)

export interface RoleResult {
  role: string;
  model: string;
  output: string;
}

export interface MoaConfig {
  roles: string[];
  parallel: boolean;
}

export const DEFAULT_MOA_CONFIG: MoaConfig = {
  roles: ["thoth", "ptah", "maat", "sekhmet"],
  parallel: true,
};

export function buildAggregatePrompt(task: string, results: RoleResult[]): string {
  const parts = results
    .map((r) => `## ${r.role} (model: ${r.model})\n${r.output}`)
    .join("\n\n");
  return `Task: ${task}

The following role agents worked on this task. Aggregate their outputs into one coherent, correct answer.

${parts}

Aggregation rules:
- Resolve conflicts; prefer the most defensible answer.
- Keep the best of each role's contribution.
- Flag anything the roles disagreed on.
- Report which roles ran and which models they used.`;
}

export function parseRoleOverride(arg: string): string[] | null {
  // accepts "@thoth @ptah @maat" trailing tokens
  const matches = arg.match(/@([a-z][a-z0-9-]*)/g);
  if (!matches || matches.length === 0) return null;
  return matches.map((m) => m.slice(1));
}

export function stripRoleOverride(arg: string): string {
  return arg.replace(/@[a-z][a-z0-9-]*/g, "").trim();
}
