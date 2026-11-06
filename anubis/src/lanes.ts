/** Human-readable small@LAN / BIG@cloud lane map for bash + TUI */
import { lanTagFromEnv } from "./tui.ts";

export function formatLanes(
  cfg: { model?: string; small_model?: string },
  env: Record<string, string | undefined> = process.env,
): string {
  const lan = env.OLLAMA_LAN_URL ?? "http://localhost:11434";
  const local = env.OLLAMA_LOCAL_URL ?? "http://localhost:11434";
  const small = cfg.small_model ?? "ollama-lan/qwen3.8:latest";
  const big = cfg.model ?? "ollama-cloud/glm-5.2";
  const tag = lanTagFromEnv(env);
  return [
    "RA lanes",
    `small  ${small}  → @${tag} (${lan})`,
    `        fallback → @local (${local})`,
    `BIG    ${big}  → @cloud`,
    `RA prefer small@${tag} → big@cloud`,
  ].join("\n");
}
