// src/tui.ts — RA-branded terminal UI (pure render + task display)

import { formatBox, HIEROGLYPHS, getPalette, DEFAULT_UI_CONFIG } from "./ui.ts";
import { RA_VERSION } from "./version.ts";

export const APP_NAME = "RA";
export const APP_TAGLINE = "Relic Agent — Mixture-of-Agents Terminal Dev";

export function renderSplash(): string {
  const palette = getPalette(DEFAULT_UI_CONFIG.palette);
  const banner = [
    `${HIEROGLYPHS.ANUBIS}  ${APP_NAME}  ${HIEROGLYPHS.ANUBIS}`,
    APP_TAGLINE,
    `v${RA_VERSION}  ·  theme: ${palette.name}`,
    `RA prefer small@251 → big@cloud  (gemma @local fallback)`,
  ].join("\n");
  return formatBox(`${APP_NAME} TUI`, banner);
}

export function renderRolesTable(table: string): string {
  return formatBox(`${APP_NAME} /roles`, table);
}

export function hostTag(baseURL: string, kind: "cloud" | "local"): string {
  if (kind === "cloud") return "cloud";
  if (/192\.168\.1\.251|:\s*251\b/.test(baseURL) || baseURL.includes("192.168.1.251")) return "251";
  if (/localhost|127\.0\.0\.1/.test(baseURL)) return "local";
  return "lan";
}

export function renderStageProgress(
  stage: string,
  model: string,
  preview: string,
  opts?: { host?: string; ms?: number },
): string {
  const lane =
    /glm-|cloud/i.test(model) || model.startsWith("ollama-cloud/")
      ? "BIG/cloud"
      : /qwen|gemma/i.test(model)
        ? "small/LAN"
        : "ollama";
  const host = opts?.host ? ` @${opts.host}` : "";
  const took = opts?.ms != null ? `  took ${opts.ms}ms` : "";
  const body = [
    `stage: ${stage}`,
    `model: ${model}  [${lane}${host}]${took}`,
    "",
    preview.slice(0, 200),
  ].join("\n");
  return formatBox(`${APP_NAME} pipeline`, body);
}

export function renderTaskComplete(
  task: string,
  stages: string[],
  summary: string,
  meta?: { lane?: string; prefer?: string; intent?: string; elapsed?: string; files?: string },
): string {
  const body = [
    `task: ${task}`,
    `stages: ${stages.join(" → ")}`,
    meta?.lane,
    meta?.intent,
    meta?.prefer,
    meta?.elapsed,
    meta?.files,
    "",
    summary.slice(0, 500),
    "",
    `${APP_NAME} dev cycle complete.`,
  ]
    .filter((l) => l != null)
    .join("\n");
  return formatBox(`${APP_NAME} ✓ done`, body);
}
