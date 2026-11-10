// tests/help-drift.test.ts — guard against help-text drift (D4/row 45).
// Two-way static contract against the real `ra help` output:
//   1. every help-listed subcommand has a dispatch branch in cli.ts;
//   2. every dispatched subcommand (`args[0] === "x"` / array-includes form)
//      is listed in help — minus an explicit allowlist.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

/** Subcommands implemented on purpose without a help line (internals). */
const UNLISTED = new Set(["task"]); // `ra task "…"` is the long-form alias of --task

function runHelp(): string {
  // process.execPath = the running bun binary — Windows-safe (no .exe PATH lookup).
  const r = spawnSync(process.execPath, [CLI, "help"], { encoding: "utf-8" });
  expect(r.status).toBe(0);
  return r.stdout ?? "";
}

/** `ra <name>` tokens from the help body (skips flags/usage prose). */
function listedSubcommands(help: string): string[] {
  return [...help.matchAll(/^  ra ([a-z][a-z0-9-]*)\b/gm)].map((m) => m[1]!);
}

/** Subcommand names cli.ts dispatches on. */
function dispatchedSubcommands(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/args\[0\] === "([a-z][a-z0-9-]*)"/g)) out.add(m[1]!);
  for (const m of source.matchAll(/\[("([a-z-]+)"(?:, ?"[a-z-]+")+)\]\.includes\(args\[0\]\)/g)) {
    for (const q of m[1]!.matchAll(/"([a-z-]+)"/g)) out.add(q[1]!);
  }
  return out;
}

describe("help drift guard", () => {
  test("help exits 0 and lists commands", () => {
    const help = runHelp();
    expect(help).toContain("ra run");
    expect(listedSubcommands(help).length).toBeGreaterThan(20);
  });

  test("every help-listed subcommand has a handler in cli.ts", () => {
    const source = readFileSync(CLI, "utf-8");
    const dispatched = dispatchedSubcommands(source);
    // Long forms implemented as flags instead of args[0] branches.
    const flagForms = new Set(["--task", "--remote"]);
    const missing = listedSubcommands(runHelp()).filter(
      (name) => !dispatched.has(name) && !flagForms.has(name),
    );
    expect(missing).toEqual([]); // drift: help lists a command nobody handles
  });

  test("every dispatched subcommand is listed in help (allowlist for internals)", () => {
    const help = runHelp();
    const listed = new Set(listedSubcommands(help));
    const source = readFileSync(CLI, "utf-8");
    const unlisted = [...dispatchedSubcommands(source)].filter(
      (name) => !listed.has(name) && !UNLISTED.has(name),
    );
    expect(unlisted).toEqual([]); // drift: handler exists but is invisible in help
  });

  test("the audited drift stays fixed: warm and roles are listed", () => {
    const help = runHelp();
    expect(help).toMatch(/^  ra warm /m);
    expect(help).toMatch(/^  ra roles /m);
  });
});
