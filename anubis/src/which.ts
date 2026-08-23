/** Resolve which small host RA would use right now (no chat) */
import { pickOllamaEndpoint } from "./ollama.ts";
import { hostTag } from "./tui.ts";

export async function formatRaWhich(
  env: Record<string, string | undefined>,
): Promise<string> {
  try {
    const small = await pickOllamaEndpoint(env);
    const host = hostTag(small.baseURL, small.kind);
    const qwen = small.availableModels.filter((m) => /qwen3\.?8/i.test(m));
    const gemma = small.availableModels.filter((m) => /gemma/i.test(m));
    return [
      "RA which",
      `small → @${host}  ${small.baseURL.replace(/\/v1\/?$/, "")}`,
      qwen.length ? `  qwen: ${qwen.join(", ")}` : "  qwen: (none on this host)",
      gemma.length ? `  gemma: ${gemma.slice(0, 4).join(", ")}` : "  gemma: (none on this host)",
      `RA prefer small@${host} → ${env.OLLAMA_API_KEY ? "big@cloud" : "big@down"}`,
    ].join("\n");
  } catch (e) {
    return `RA which\nsmall → unreachable (${String(e)})`;
  }
}
