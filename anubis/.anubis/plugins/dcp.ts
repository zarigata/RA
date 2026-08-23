// .anubis/plugins/dcp.ts — dynamic context pruning of oversized tool outputs
import { truncate } from "../../src/truncate.ts";

type AnyCtx = Record<string, unknown>;

export const DcpPlugin = async () => {
  return {
    "message.part.updated": async (input: AnyCtx) => {
      const part = (input as { part?: AnyCtx }).part;
      if (!part) return;
      if (part.type !== "tool") return;
      const state = part.state as { output?: string; status?: string } | undefined;
      if (!state || state.status !== "completed") return;
      const text = state.output ?? "";
      if (text.length > 20000) {
        state.output = truncate(text, 20000);
      }
    },
  };
};

export default DcpPlugin;
