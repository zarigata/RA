/** Live model inventory for bash + TUI `/models` */
import { OllamaClient, pickOllamaEndpoint } from "./ollama.ts";
import { hostTag } from "./tui.ts";

export async function formatRaModels(
  cfg: { model?: string; small_model?: string },
  env: Record<string, string | undefined>,
): Promise<string> {
  const lines = [
    "RA models",
    `config BIG: ${cfg.model ?? "(unset)"}`,
    `config small: ${cfg.small_model ?? "(unset)"}`,
  ];
  let smallHost = "?";
  try {
    const small = await pickOllamaEndpoint(env);
    const host = hostTag(small.baseURL, small.kind);
    smallHost = host;
    const notables = small.availableModels.filter((m) => /qwen3\.?8|gemma/i.test(m));
    lines.push(
      `small @${host} (${small.availableModels.length}): ${small.availableModels.slice(0, 10).join(", ")}`,
    );
    if (notables.length) lines.push(`  notable: ${notables.join(", ")}`);
  } catch (e) {
    lines.push(`small probe failed: ${String(e)}`);
  }
  if (env.OLLAMA_API_KEY) {
    try {
      const cloud = OllamaClient.fromEnv(env);
      const ids = await cloud.listModels();
      lines.push(`BIG @cloud (${ids.length}): ${ids.slice(0, 10).join(", ")}`);
    } catch (e) {
      lines.push(`cloud probe failed: ${String(e)}`);
    }
  } else {
    lines.push("BIG @cloud: (OLLAMA_API_KEY unset)");
  }
  lines.push(`RA prefer small@${smallHost} → ${env.OLLAMA_API_KEY ? "big@cloud" : "big@down"}`);
  return lines.join("\n");
}
