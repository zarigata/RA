/** Human-readable small@251 / BIG@cloud lane map for bash + TUI */

export function formatLanes(
  cfg: { model?: string; small_model?: string },
  env: Record<string, string | undefined> = process.env,
): string {
  const lan = env.OLLAMA_LAN_URL ?? "http://192.168.1.251:11434";
  const local = env.OLLAMA_LOCAL_URL ?? "http://localhost:11434";
  const small = cfg.small_model ?? "ollama-lan/qwen3.8:latest";
  const big = cfg.model ?? "ollama-cloud/glm-5.2";
  return [
    "RA lanes",
    `small  ${small}  → @251 (${lan})`,
    `        fallback → @local gemma (${local})`,
    `BIG    ${big}  → @cloud`,
    `RA prefer small@251 → big@cloud`,
  ].join("\n");
}
