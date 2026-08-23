/** Paths RA uses — bash-greppable */

export function formatRaHome(opts: {
  anubis: string;
  global: string;
  lastCwd?: string | null;
  lane?: string | null;
  intent?: string | null;
}): string {
  return [
    "RA home",
    `anubis: ${opts.anubis}`,
    `global: ${opts.global}`,
    opts.lastCwd ? `last-cwd: ${opts.lastCwd}` : "last-cwd: (none)",
    "RA prefer small@251 → big@cloud",
    opts.lane || null,
    opts.intent || null,
  ]
    .filter(Boolean)
    .join("\n");
}
