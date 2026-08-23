// src/history.ts — append-only full-dev history (last N runs)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LastRun } from "./last-run.ts";
import { formatLaneLine, formatPreferLine } from "./last-run.ts";

const MAX = 20;

export function historyPath(): string {
  return join(homedir(), ".ra", "history.jsonl");
}

export function appendHistory(run: LastRun): void {
  mkdirSync(join(homedir(), ".ra"), { recursive: true });
  appendFileSync(historyPath(), JSON.stringify(run) + "\n", "utf-8");
  // Trim to last MAX lines (ponytail: rewrite whole file)
  const lines = loadHistoryRaw();
  if (lines.length > MAX) {
    writeFileSync(historyPath(), lines.slice(-MAX).map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  }
}

function loadHistoryRaw(): LastRun[] {
  const p = historyPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LastRun;
      } catch {
        return null;
      }
    })
    .filter((x): x is LastRun => !!x);
}

export function loadHistory(limit = 10): LastRun[] {
  return loadHistoryRaw().slice(-limit).reverse();
}

export function formatHistory(runs: LastRun[]): string {
  if (runs.length === 0) return "No RA full-dev history yet.";
  const latest = runs[0]!;
  const head = [
    latest.timings?.length ? formatLaneLine(latest) : null,
    formatPreferLine(latest),
  ].filter(Boolean);
  const body = runs
    .map((r, i) => {
      const when = new Date(r.at).toISOString().slice(0, 19);
      const files = r.filesWritten.map((f) => f.split("/").pop()).join(",") || "none";
      const ms = r.ms != null ? ` ${(r.ms / 1000).toFixed(1)}s` : "";
      const hosts = r.hosts?.length ? ` [${r.hosts.join(",")}]` : "";
      const intent = r.intent ? ` {${r.intent}}` : "";
      const small = r.timings?.find((t) => t.host === "251" || t.host === "local");
      const lane = small ? ` ${small.stage}@${small.host}` : "";
      return `${i + 1}. ${when}${ms}${hosts}${intent}${lane} ${r.stages.join("→")} → ${files}\n   ${r.task.slice(0, 60)}`;
    })
    .join("\n");
  return [...head, body].join("\n");
}
