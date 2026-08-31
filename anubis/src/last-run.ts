// src/last-run.ts — persist latest full-dev result for /status and bash greps
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StageTiming {
  stage: string;
  model: string;
  host: string;
  ms: number;
}

export interface LastRun {
  status?: "completed" | "failed";
  error?: string;
  verification?: { ok: boolean; lines: string[] };
  outputs?: Array<{ stage: string; model: string; content: string }>;
  task: string;
  stages: string[];
  models: string[];
  filesWritten: string[];
  hosts?: string[];
  ms?: number;
  /** horus intent tag for scripting / ra last --json */
  intent?: string;
  /** workdir where files were written */
  cwd?: string;
  /** per-stage model/host/ms for RA TUI audits */
  timings?: StageTiming[];
  at: number;
}

export function lastRunPath(): string {
  return join(homedir(), ".ra", "last-run.json");
}

export function saveLastRun(run: Omit<LastRun, "at">): LastRun {
  const full: LastRun = { ...run, at: Date.now() };
  mkdirSync(join(homedir(), ".ra"), { recursive: true });
  writeFileSync(lastRunPath(), JSON.stringify(full, null, 2), "utf-8");
  return full;
}

export function loadLastRun(): LastRun | null {
  const p = lastRunPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as LastRun;
  } catch {
    return null;
  }
}

export function formatLastRun(run: LastRun | null): string {
  if (!run) return "No previous RA full-dev run.";
  const when = new Date(run.at).toISOString();
  return [
    `last: ${when}`,
    `task: ${run.task.slice(0, 80)}`,
    `stages: ${run.stages.join(" → ")}`,
    `models: ${run.models.join(", ")}`,
    run.hosts?.length ? `hosts: ${run.hosts.join(", ")}` : null,
    run.intent ? `intent: ${run.intent}` : null,
    run.cwd ? `cwd: ${run.cwd}` : null,
    run.timings?.length ? `timings: ${formatTimings(run.timings)}` : null,
    `files: ${run.filesWritten.join(", ") || "(none)"}`,
    run.ms != null ? `elapsed: ${(run.ms / 1000).toFixed(1)}s` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatTimings(timings: StageTiming[]): string {
  return timings
    .map((t) => `${t.stage}@${t.host}=${(t.ms / 1000).toFixed(1)}s`)
    .join(" → ");
}

/** Bash/TUI block for last-run stage timings */
export function formatRaTimings(run: LastRun | null): string {
  if (!run?.timings?.length) return "RA timings: no stage timings yet. Run a full-dev first.";
  const lines = [
    "RA timings",
    formatTimings(run.timings),
    ...run.timings.map(
      (t) => `  ${t.stage}: ${t.model} @${t.host} ${t.ms}ms`,
    ),
    formatLaneLine(run),
    formatIntentLine(run),
    formatPreferLine(run),
  ];
  return lines.join("\n");
}

/** One-line summary for bash gates */
export function formatResultLine(run: LastRun): string {
  const ms = run.ms != null ? ` ms=${run.ms}` : "";
  const hosts = run.hosts?.length ? ` hosts=${run.hosts.join(",")}` : "";
  const intent = run.intent ? ` intent=${run.intent}` : "";
  const cwd = run.cwd ? ` cwd=${run.cwd}` : "";
  const n = run.timings?.length ? ` stages_n=${run.timings.length}` : "";
  return `RA RESULT status=${run.status ?? "unknown"} stages=${run.stages.join("→")} models=${run.models.join(",")} files=${run.filesWritten.join(",") || "none"}${hosts}${ms}${intent}${cwd}${n}`;
}

/** Compact post–full-dev snapshot for bash greps */
export function formatLaneLine(run: LastRun): string {
  const small = run.timings?.find((t) => t.stage === "thoth");
  const big = run.timings?.find((t) => t.stage === "ptah");
  const a = small ? `${small.stage}@${small.host}` : "small@?";
  const b = big ? `${big.stage}@${big.host}` : run.hosts?.includes("cloud") ? "ptah@cloud" : "big@?";
  return `RA lane ${a} → ${b}`;
}

/** Bash/TUI one-liner for last-run intent */
export function formatIntentLine(run: LastRun | null): string {
  if (!run?.intent) return "RA intent: no full-dev yet. Try ra demo or /quick.";
  return `RA intent ${run.intent}`;
}

/** Prefer line from actual last-run hosts (falls back to policy defaults) */
export function formatPreferLine(run: LastRun | null): string {
  const small = run?.timings?.find((t) => t.stage === "thoth");
  const big = run?.timings?.find((t) => t.host === "cloud");
  const a = small ? `small@${small.host}` : run?.hosts?.includes("251")
    ? "small@251"
    : run?.hosts?.includes("local")
      ? "small@local"
      : "small@251";
  const b = big ? `big@${big.host}` : run?.hosts?.includes("cloud") ? "big@cloud" : "big@cloud";
  return `RA prefer ${a} → ${b}`;
}

export function formatRaSummary(run: LastRun | null): string {
  if (!run) return "RA summary: no full-dev yet. Try ra demo or /quick.";
  return [
    "RA summary",
    formatLastRun(run),
    formatResultLine(run),
    formatLaneLine(run),
    run.timings?.length ? `lane: ${formatTimings(run.timings)}` : null,
    formatPreferLine(run),
    run.ms != null ? `elapsed: ${(run.ms / 1000).toFixed(1)}s` : null,
    "again: ra again --quick --verify",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Print last artifact for bash/TUI `/show` */
export function formatShow(run: LastRun | null, which = 0): string {
  if (!run?.filesWritten.length) return "RA show: no files from last full-dev.";
  const path = run.filesWritten[which] ?? run.filesWritten[0]!;
  if (!existsSync(path)) return `RA show: missing ${path}`;
  const body = readFileSync(path, "utf-8");
  const preview = body.length > 4000 ? body.slice(0, 4000) + "\n…(truncated)" : body;
  const footer = [
    formatLaneLine(run),
    formatIntentLine(run),
    formatPreferLine(run),
    run.ms != null ? `elapsed: ${(run.ms / 1000).toFixed(1)}s` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `RA show ${path}\n──\n${preview}\n──\n${footer}`;
}

/** List last full-dev artifacts for bash/TUI `/files` */
export function formatRaFiles(run: LastRun | null): string {
  if (!run?.filesWritten.length) {
    return "RA files: no files from last full-dev. Try ra demo or /quick.";
  }
  return [
    "RA files",
    ...run.filesWritten.map((f) => `  ${f}`),
    formatLaneLine(run),
    formatIntentLine(run),
    formatPreferLine(run),
    run.ms != null ? `elapsed: ${(run.ms / 1000).toFixed(1)}s` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
