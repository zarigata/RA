/** Paths RA uses — bash-greppable */
import { preferLine } from "./tui.ts";

export function formatRaHome(opts: {
  anubis: string;
  global: string;
  lastCwd?: string | null;
  lane?: string | null;
  intent?: string | null;
  env?: Record<string, string | undefined>;
}): string {
  return [
    "RA home",
    `anubis: ${opts.anubis}`,
    `global: ${opts.global}`,
    opts.lastCwd ? `last-cwd: ${opts.lastCwd}` : "last-cwd: (none)",
    preferLine(opts.env),
    opts.lane || null,
    opts.intent || null,
  ]
    .filter(Boolean)
    .join("\n");
}
