/** Sanitize env display — never print API keys */
import { preferLine } from "./tui.ts";

export function formatRaEnv(env: Record<string, string | undefined> = process.env): string {
  const mask = (v?: string) => {
    if (!v) return "(unset)";
    if (v.length < 8) return "***";
    return `${v.slice(0, 4)}…${v.slice(-4)}`;
  };
  return [
    "RA env",
    `OLLAMA_LAN_URL=${env.OLLAMA_LAN_URL ?? "http://localhost:11434"}`,
    `OLLAMA_LOCAL_URL=${env.OLLAMA_LOCAL_URL ?? "http://localhost:11434"}`,
    `OLLAMA_BASE_URL=${env.OLLAMA_BASE_URL ?? "https://ollama.com/v1"}`,
    `OLLAMA_API_KEY=${mask(env.OLLAMA_API_KEY)}`,
    `ZAI_API_KEY=${env.ZAI_API_KEY ? mask(env.ZAI_API_KEY) : "(unset)"}`,
    preferLine(env),
  ].join("\n");
}
