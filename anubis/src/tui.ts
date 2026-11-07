// src/tui.ts — RA-branded terminal UI (pure render + task display)

import { formatBox, HIEROGLYPHS, getPalette, DEFAULT_UI_CONFIG } from "./ui.ts";
import { RA_VERSION } from "./version.ts";

export const APP_NAME = "RA";
export const APP_TAGLINE = "Relic Agent — Mixture-of-Agents Terminal Dev";

/**
 * Host tag for display and bash greps: "cloud", "local", the last octet of an
 * IPv4 LAN address (192.168.1.N → "N"), or the hostname. Derived from the
 * endpoint URL — never a hardcoded address.
 */
export function hostTag(baseURL: string, kind: "cloud" | "local"): string {
  if (kind === "cloud") return "cloud";
  const host = baseURL.replace(/^\w+:\/\//, "").split(/[/:?#]/)[0] ?? "";
  if (/^(localhost|127\.0\.0\.1)$/.test(host)) return "local";
  const m = host.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.(\d{1,3})$/);
  if (m) return m[1]!;
  return host || "lan";
}

/** LAN host tag from the environment (OLLAMA_LAN_URL). */
export function lanTagFromEnv(env: Record<string, string | undefined> = process.env): string {
  return hostTag(env.OLLAMA_LAN_URL ?? "http://localhost:11434", "local");
}

/** One-line prefer policy; host tag derived from OLLAMA_LAN_URL. */
export function preferLine(env: Record<string, string | undefined> = process.env): string {
  return `RA prefer small@${lanTagFromEnv(env)} → big@cloud  (localhost fallback)`;
}

export function renderSplash(themeOverride?: string): string {
  const palette = getPalette(themeOverride ?? DEFAULT_UI_CONFIG.palette);
  const banner = [
    `${HIEROGLYPHS.ANUBIS}  ${APP_NAME}  ${HIEROGLYPHS.ANUBIS}`,
    APP_TAGLINE,
    `v${RA_VERSION}  ·  theme: ${palette.name}`,
    preferLine(),
  ].join("\n");
  return formatBox(`${APP_NAME} TUI`, banner);
}

export function renderRolesTable(table: string): string {
  return formatBox(`${APP_NAME} /roles`, table);
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
      : /^ollama\//.test(model)
        ? "small/local"
        : "small/LAN";
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
