// src/validation.ts — Configuration and environment validation

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateEnvironment(): ConfigValidationResult {
  const errors: ValidationError[] = [];
  const env = process.env;

  // Check for at least one provider key
  const hasAnthropicKey = !!env.ANTHROPIC_API_KEY;
  const hasOpenAiKey = !!env.OPENAI_API_KEY;
  const hasGoogleKey = !!env.GOOGLE_GENERATIVE_AI_API_KEY;
  const hasOllamaKey = !!env.OLLAMA_API_KEY;
  const hasZaiKey = !!env.ZAI_API_KEY;
  const hasDeepseekKey = !!env.DEEPSEEK_API_KEY;
  const hasGroqKey = !!env.GROQ_API_KEY;
  const hasLanUrl = !!env.OLLAMA_LAN_URL;
  const hasLocalUrl = !!env.OLLAMA_LOCAL_URL;

  if (!hasAnthropicKey && !hasOpenAiKey && !hasGoogleKey && !hasOllamaKey && !hasZaiKey && !hasDeepseekKey && !hasGroqKey && !hasLanUrl && !hasLocalUrl) {
    errors.push({
      field: "API_KEYS",
      message: "No provider API keys found in .env. At least one is required.",
      severity: "error",
    });
  }

  // Warn about incomplete keys
  if (env.ANTHROPIC_API_KEY === "sk-ant-" || env.ANTHROPIC_API_KEY === "sk-ant-...") {
    errors.push({
      field: "ANTHROPIC_API_KEY",
      message: "Placeholder value detected. Replace with actual key.",
      severity: "warning",
    });
  }

  return {
    valid: errors.filter((e) => e.severity === "error").length === 0,
    errors,
  };
}

export function validateAgentConfig(config: Record<string, any>): ConfigValidationResult {
  const errors: ValidationError[] = [];

  if (!config.agent || typeof config.agent !== "object") {
    errors.push({
      field: "config.agent",
      message: "Agent configuration missing or invalid",
      severity: "error",
    });
    return { valid: false, errors };
  }

  const roles = ["anubis", "thoth", "ptah", "maat", "sekhmet", "isis", "seshat", "horus"];
  const assignedRoles = Object.keys(config.agent);

  // Warn if no roles are assigned
  if (assignedRoles.length === 0) {
    errors.push({
      field: "config.agent",
      message: "No roles have model assignments. Using defaults.",
      severity: "warning",
    });
  }

  // Check for invalid role names
  for (const role of assignedRoles) {
    if (!roles.includes(role)) {
      errors.push({
        field: `config.agent.${role}`,
        message: `Unknown role "${role}". Valid roles: ${roles.join(", ")}`,
        severity: "warning",
      });
    }

    const agentCfg = config.agent[role];
    if (!agentCfg.model) {
      errors.push({
        field: `config.agent.${role}.model`,
        message: `No model assigned to role "${role}". Will use default.`,
        severity: "warning",
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity === "error").length === 0,
    errors,
  };
}

export function formatValidationErrors(result: ConfigValidationResult): string {
  if (result.errors.length === 0) return "";

  const errorLines = result.errors.map(
    (e) => `[${e.severity.toUpperCase()}] ${e.field}: ${e.message}`
  );

  return `Configuration Validation:\n${errorLines.join("\n")}`;
}

export function logValidationResult(result: ConfigValidationResult, label = "Config"): void {
  const msg = formatValidationErrors(result);
  if (msg) {
    console.warn(`\n${label}\n${msg}\n`);
  }
}
