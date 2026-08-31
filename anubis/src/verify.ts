/** Re-run checks on last full-dev artifacts (no LLM) */
import { existsSync, readFileSync } from "node:fs";
import type { LastRun } from "./last-run.ts";
import { formatIntentLine, formatLaneLine, formatPreferLine } from "./last-run.ts";
import { runCommand } from "../../ra/src/sandbox.ts";
import { safePath } from "../../ra/src/tools/index.ts";
import { loadRaConfig } from "./config.ts";
import { ANUBIS_HOME } from "../../ra/src/paths.ts";

export interface VerifyLine {
  path: string;
  ok: boolean;
  detail: string;
}

export async function verifyLastRun(run: LastRun | null): Promise<{ ok: boolean; lines: string[] }> {
  if (run?.status === "failed") return { ok: false, lines: [`RA verify: last run failed: ${run.error ?? "unknown error"}`] };
  if (!run?.filesWritten.length) {
    return { ok: false, lines: ["RA verify: no files from last full-dev."] };
  }
  const lines: string[] = ["RA verify"];
  let ok = true;
  for (const f of run.filesWritten) {
    try { safePath(run.cwd ?? process.cwd(), f); }
    catch (error) { ok = false; lines.push(`✗ unsafe artifact ${f}: ${String(error)}`); continue; }
    if (!existsSync(f)) {
      lines.push(`✗ missing ${f}`);
      ok = false;
      continue;
    }
    if (f.endsWith(".py")) {
      try {
        const result = await runCommand({ cwd: run.cwd ?? process.cwd(), sandbox: loadRaConfig(ANUBIS_HOME).sandbox }, ["python3", f], { tool: "verify", timeoutMs: 30000 });
        const body = (result.stdout || result.stderr).trim();
        const pass = result.code === 0;
        lines.push(`${pass ? "✓" : "✗"} python3 ${f} → exit ${result.code} [${result.sandbox}]`);
        if (body) lines.push(body.slice(0, 200));
        if (!pass) ok = false;
      } catch (error) { ok = false; lines.push(`✗ python3 ${f}: ${String(error)}`); }
    } else if (f.endsWith(".html")) {
      const { readFileSync } = await import("node:fs");
      const body = readFileSync(f, "utf-8");
      const hasDoc = /<!DOCTYPE\s+html/i.test(body);
      lines.push(`${hasDoc ? "✓" : "✗"} html ${f}${hasDoc ? "" : " (missing <!DOCTYPE html>)"}`);
      if (!hasDoc) ok = false;
    } else if (/\.(?:mjs|cjs|js|ts)$/.test(f)) {
      try {
        new Bun.Transpiler({ loader: f.endsWith(".ts") ? "ts" : "js" }).transformSync(readFileSync(f, "utf-8"));
        lines.push(`✓ syntax ${f} (application tests not run)`);
      } catch (e) { ok = false; lines.push(`✗ syntax ${f}: ${String(e)}`); }
    } else {
      lines.push(`✓ exists ${f}`);
    }
  }
  lines.push(ok ? "RA verify OK" : "RA verify FAIL");
  if (run.timings?.length) lines.push(formatLaneLine(run));
  if (run.intent) lines.push(formatIntentLine(run));
  lines.push(formatPreferLine(run));
  if (run.ms != null) lines.push(`elapsed: ${(run.ms / 1000).toFixed(1)}s`);
  lines.push("again: ra again --quick --verify");
  return { ok, lines };
}
