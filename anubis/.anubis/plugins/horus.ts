// .anubis/plugins/horus.ts — prompt enhancement plugin
// Uses pure logic from ../../src/intent.ts
import { enhancePrompt, detectIntent, isAmbiguousCode } from "../../src/intent.ts";

type AnyCtx = Record<string, unknown>;

export const HorusPlugin = async (ctx: AnyCtx) => {
  const client = (ctx as { client?: AnyCtx }).client;
  const log = async (level: string, message: string) => {
    try {
      await client?.app?.log?.({ body: { service: "horus", level, message } });
    } catch {
      /* no-op */
    }
  };
  return {
    "tui.prompt.append": async (input: AnyCtx, output: AnyCtx) => {
      const text = (input.prompt as string) ?? "";
      if (!text.trim()) return;
      const intent = detectIntent(text);
      (output as { prompt?: string }).prompt = enhancePrompt(text);
      if (isAmbiguousCode(text)) {
        (output as { prompt?: string }).prompt +=
          "\n\n[horus] Which language/framework? What are the acceptance criteria?";
      }
      await log("debug", `enhanced prompt (intent=${intent})`);
    },
  };
};

export default HorusPlugin;
