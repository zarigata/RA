// Air-gapped mode — a single flag that forces 100% local operation and blocks
// external network access (cloud providers, webfetch, catalog).

import type { RaConfig } from "../../anubis/src/config.ts";

/** True when air-gapped mode is enabled via config or env. */
export function isAirgapped(config: RaConfig, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): boolean {
  return config.airgap === true || env.RA_AIRGAP === "1" || env.RA_AIRGAP === "true";
}

/**
 * Filter a configured model to a local-only equivalent when air-gapped.
 * Cloud models (ollama-cloud/*, or any non-ollama provider) are replaced with
 * the LAN/local small model.
 */
export function localizeModel(configured: string, smallModel: string): string {
  if (/^ollama-cloud\//.test(configured) || /^cloud\//.test(configured)) return smallModel;
  // Non-ollama custom providers (e.g. zai/, anthropic/) are cloud → localize.
  const slash = configured.indexOf("/");
  if (slash > 0 && !/^ollama/i.test(configured.slice(0, slash))) return smallModel;
  return configured;
}

/** Whether a URL is a local/LAN address (allowed in air-gapped mode). */
export function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./.test(url);
}
