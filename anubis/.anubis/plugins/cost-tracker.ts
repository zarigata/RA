// .anubis/plugins/cost-tracker.ts — per-role token/cost tracking
import { estimateCost, formatReport, buildReport, type UsageEntry } from "../../src/cost.ts";

type AnyCtx = Record<string, unknown>;

export const CostTrackerPlugin = async (ctx: AnyCtx) => {
  const client = (ctx as { client?: AnyCtx }).client;
  const usage: Record<string, UsageEntry> = {};
  const log = async (message: string) => {
    try {
      await client?.app?.log?.({ body: { service: "cost-tracker", level: "info", message } });
    } catch {
      /* no-op */
    }
  };
  return {
    "message.part.updated": async (input: AnyCtx) => {
      const part = (input as { part?: AnyCtx }).part;
      if (!part || part.type !== "text") return;
      const u = part.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const model = (part.model as string) ?? "unknown";
      if (!u) return;
      usage[model] = usage[model] ?? { model, inputTokens: 0, outputTokens: 0 };
      usage[model].inputTokens += u.inputTokens ?? 0;
      usage[model].outputTokens += u.outputTokens ?? 0;
    },
    "session.idle": async () => {
      if (Object.keys(usage).length === 0) return;
      await log(formatReport(buildReport(usage)));
    },
    "tui.command.execute": async (input: AnyCtx, output: AnyCtx) => {
      if ((input.command as string)?.startsWith("/cost")) {
        (output as { handled?: boolean }).handled = true;
        await log(formatReport(buildReport(usage)));
      }
    },
  };
};

export { estimateCost };
export default CostTrackerPlugin;
