/** Re-run checks on last full-dev artifacts (no LLM) */
import { existsSync } from "node:fs";
import type { LastRun } from "./last-run.ts";
import { formatIntentLine, formatLaneLine, formatPreferLine } from "./last-run.ts";

export interface VerifyLine {
  path: string;
  ok: boolean;
  detail: string;
}

export async function verifyLastRun(run: LastRun | null): Promise<{ ok: boolean; lines: string[] }> {
  if (!run?.filesWritten.length) {
    return { ok: false, lines: ["RA verify: no files from last full-dev."] };
  }
  const lines: string[] = ["RA verify"];
  let ok = true;
  for (const f of run.filesWritten) {
    if (!existsSync(f)) {
      lines.push(`✗ missing ${f}`);
      ok = false;
      continue;
    }
    if (f.endsWith(".py")) {
      const proc = Bun.spawn(["python3", f], { stdout: "pipe", stderr: "pipe" });
      const out = await new Response(proc.stdout).text();
      const err = await new Response(proc.stderr).text();
      const code = await proc.exited;
      const body = (out || err).trim();
      const pass = code === 0 && /hello/i.test(out);
      lines.push(`${pass ? "✓" : "✗"} python3 ${f} → exit ${code}`);
      if (body) lines.push(body.slice(0, 200));
      if (!pass) ok = false;
    } else if (f.endsWith(".html")) {
      const { readFileSync } = await import("node:fs");
      const body = readFileSync(f, "utf-8");
      const hasDoc = /<!DOCTYPE\s+html/i.test(body);
      lines.push(`${hasDoc ? "✓" : "✗"} html ${f}${hasDoc ? "" : " (missing <!DOCTYPE html>)"}`);
      if (!hasDoc) ok = false;
    } else if (f.endsWith(".js") || f.endsWith(".ts")) {
      lines.push(`✓ exists ${f}`);
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
