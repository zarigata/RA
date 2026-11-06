/** Live model inventory for bash + TUI `/models` */
import { OllamaClient, pickOllamaEndpoint } from "./ollama.ts";
import { hostTag } from "./tui.ts";
import { profileNotableRegex } from "./ping.ts";

export async function formatRaModels(
  cfg: { model?: string; small_model?: string; provider?: Record<string, { models?: Record<string, unknown> }> },
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
    const notable = profileNotableRegex(cfg);
    const notables = small.availableModels.filter((m) => notable.test(m));
    lines.push(
      `small @${host} (${small.availableModels.length}): ${small.availableModels.slice(0, 10).join(", ")}`,
    );
    if (notables.length) lines.push(`  notable: ${notables.join(", ")}`);
    const wanted = cfg.small_model?.includes("/") ? cfg.small_model.split("/").pop()! : cfg.small_model;
    if (wanted && !small.availableModels.includes(wanted)) {
      lines.push(`  ⚠ configured small model "${wanted}" is not on this host — pull it (ollama pull ${wanted}) or set small_model in ra.json to a listed model`);
    }
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
