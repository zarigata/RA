// .anubis/plugins/papyrus.ts — papyrus compression mode injector
type AnyCtx = Record<string, unknown>;

const PAPYRUS_SUFFIX = `
[PAPYRUS MODE] Respond ultra-compressed. Drop articles, filler, pleasantries, hedging. Fragments OK. Short synonyms. Technical terms exact. Code unchanged. Pattern: [thing] [action] [reason]. [next step].`;

export const PapyrusPlugin = async (ctx: AnyCtx) => {
  const client = (ctx as { client?: AnyCtx }).client;
  const log = async (message: string) => {
    try {
      await client?.app?.log?.({ body: { service: "papyrus", level: "debug", message } });
    } catch {
      /* no-op */
    }
  };
  return {
    "tui.prompt.append": async (input: AnyCtx, output: AnyCtx) => {
      const text = (input.prompt as string) ?? "";
      if (/papyrus|talk like papyrus|use papyrus|less tokens|be brief/i.test(text)) {
        (output as { prompt?: string }).prompt = text + PAPYRUS_SUFFIX;
        await log("papyrus mode engaged");
      }
    },
  };
};

export default PapyrusPlugin;
