/** Splash + ping + which + lanes + models — no LLM */
import { renderSplash } from "./tui.ts";
import { pingAll, formatPings } from "./ping.ts";
import { formatLanes } from "./lanes.ts";
import { formatRaModels } from "./models-list.ts";
import { formatRaWhich } from "./which.ts";
import { loadLastRun, formatLaneLine, formatPreferLine } from "./last-run.ts";

export async function formatSelfcheck(
  cfg: { model?: string; small_model?: string; provider?: Record<string, { models?: Record<string, unknown> }> },
  env: Record<string, string | undefined>,
): Promise<{ ok: boolean; text: string }> {
  const pings = await pingAll(env, cfg);
  const parts = [
    renderSplash(),
    formatPings(pings),
    await formatRaWhich(env, cfg),
    formatLanes(cfg, env),
    await formatRaModels(cfg, env),
  ];
  const last = loadLastRun();
  if (last?.timings?.length) {
    parts.push(formatLaneLine(last));
    parts.push(formatPreferLine(last));
  }
  const smallOk = pings.some((p) => p.name !== "cloud" && p.ok);
  parts.push(smallOk ? "RA selfcheck OK" : "RA selfcheck FAIL — no small Ollama");
  return { ok: smallOk, text: parts.join("\n") };
}
