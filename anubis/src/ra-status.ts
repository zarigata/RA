/** Bash/TUI `ra status` snapshot */
import { formatLastRun, formatLaneLine, formatPreferLine, type LastRun } from "./last-run.ts";

export function formatRaStatus(opts: {
  cwd: string;
  profile?: string;
  model?: string;
  small?: string;
  simple?: boolean;
  messages?: number;
  last: LastRun | null;
  usage: string;
}): string {
  return [
    "RA status",
    `cwd: ${opts.cwd}`,
    `profile: ${opts.profile ?? "default"}`,
    `model: ${opts.model ?? "(unset)"}`,
    `small: ${opts.small ?? "(unset)"}`,
    opts.simple != null ? `simple: ${opts.simple ? "on" : "off"}` : null,
    opts.messages != null ? `messages: ${opts.messages}` : null,
    formatLastRun(opts.last),
    opts.last?.timings?.length ? formatLaneLine(opts.last) : null,
    opts.last?.intent ? `RA intent ${opts.last.intent}` : null,
    formatPreferLine(opts.last),
    opts.last?.ms != null ? `elapsed: ${(opts.last.ms / 1000).toFixed(1)}s` : null,
    opts.last?.task ? "again: ra again --quick --verify" : null,
    opts.usage,
  ]
    .filter(Boolean)
    .join("\n");
}
