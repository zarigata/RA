// .anubis/plugins/vibeguard.ts — secret/PII redaction before LLM calls
import { redact, restore } from "../../src/redact.ts";

type AnyCtx = Record<string, unknown>;

export const VibeguardPlugin = async () => {
  const stash = new Map<string, string>();
  let counter = 0;
  const ph = () => `__VIBEGUARD_${counter++}__`;
  return {
    "tool.execute.before": async (input: AnyCtx, output: AnyCtx) => {
      const tool = input.tool as string;
      if (tool !== "read" && tool !== "bash") return;
      const args = (output as { args?: unknown }).args;
      const text = JSON.stringify(args ?? "");
      const r = redact(text);
      for (const [k, v] of r.stash) stash.set(k, v);
      void ph;
      if (r.count > 0) {
        try {
          (output as { args?: unknown }).args = JSON.parse(r.text);
        } catch {
          /* keep original */
        }
      }
    },
    "tool.execute.after": async (input: AnyCtx, output: AnyCtx) => {
      if (stash.size === 0) return;
      let text = JSON.stringify(output ?? "");
      let changed = false;
      for (const [k, v] of stash) {
        if (text.includes(k)) {
          text = text.split(k).join(v);
          changed = true;
        }
      }
      if (changed) {
        try {
          Object.assign(output as object, JSON.parse(restore(text, new Map())));
        } catch {
          /* no-op */
        }
      }
    },
  };
};

export default VibeguardPlugin;
