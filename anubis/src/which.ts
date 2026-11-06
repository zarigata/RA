/** Resolve which small host RA would use right now (no chat) */
import { pickOllamaEndpoint } from "./ollama.ts";
import { hostTag } from "./tui.ts";
import { profileNotableRegex } from "./ping.ts";

export async function formatRaWhich(
  env: Record<string, string | undefined>,
  configured?: { small_model?: string; model?: string; provider?: Record<string, { models?: Record<string, unknown> }> },
): Promise<string> {
  try {
    const small = await pickOllamaEndpoint(env);
    const host = hostTag(small.baseURL, small.kind);
    const notable = profileNotableRegex(configured);
    const picks = small.availableModels.filter((m) => notable.test(m));
    return [
      "RA which",
      `small → @${host}  ${small.baseURL.replace(/\/v1\/?$/, "")}`,
      picks.length
        ? `  models: ${picks.slice(0, 4).join(", ")}`
        : `  models: (none of the configured profile models on this host — first 4: ${small.availableModels.slice(0, 4).join(", ") || "none"})`,
      `RA prefer small@${host} → ${env.OLLAMA_API_KEY ? "big@cloud" : "big@down"}`,
    ].join("\n");
  } catch (e) {
    return `RA which\nsmall → unreachable (${String(e)})`;
  }
}
