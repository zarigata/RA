// Self-healing loop — on test failure, auto-diagnose and retry with diagnostics
// injected (max 3 attempts), then log to BUGS.md if still failing.

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { diagnoseFile, formatDiagnostics } from "./diagnostics.ts";

export interface HealResult {
  attempts: number;
  passed: boolean;
  diagnostics: string[];
  log: string;
}

export interface HealOptions {
  cwd: string;
  /** Files to diagnose when a test fails (relative to cwd). */
  files: string[];
  /** Run the test; return true on pass, false on fail. */
  runTest: () => Promise<boolean>;
  /** Attempt a fix given diagnostics; return true if a change was made. */
  attemptFix: (diagnostics: string) => Promise<boolean>;
  maxAttempts?: number;
  bugsFile?: string;
}

/**
 * Run the test; on failure, diagnose the given files, attempt a fix, and retry.
 * Stops after maxAttempts (default 3). If still failing, appends to BUGS.md.
 */
export async function selfHeal(opts: HealOptions): Promise<HealResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const diagnostics: string[] = [];
  let passed = false;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    if (await opts.runTest()) {
      passed = true;
      break;
    }
    // Diagnose the changed files.
    const diags: string[] = [];
    for (const f of opts.files) {
      const d = await diagnoseFile(opts.cwd, f);
      if (d.length) diags.push(formatDiagnostics(d));
    }
    const diagText = diags.join("\n");
    diagnostics.push(diagText || "(no diagnostics)");
    if (!diagText) break; // nothing to act on
    const changed = await opts.attemptFix(diagText);
    if (!changed) break; // fix made no change → stop retrying
  }

  let log = "";
  if (!passed) {
    const bugsFile = opts.bugsFile ?? join(opts.cwd, "BUGS.md");
    log = `## Self-heal failure\n\n- attempts: ${attempts}\n- files: ${opts.files.join(", ")}\n- diagnostics:\n${diagnostics.map((d) => `  ${d}`).join("\n")}\n`;
    try {
      appendFileSync(bugsFile, `\n${log}\n`, "utf-8");
    } catch {
      /* BUGS.md may not be writable; log is still returned */
    }
  }

  return { attempts, passed, diagnostics, log };
}
