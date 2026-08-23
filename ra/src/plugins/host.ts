import { join } from "node:path";
import { PLUGINS_DIR } from "../paths.ts";
import { redact } from "../../../anubis/src/redact.ts";
import { truncate } from "../../../anubis/src/truncate.ts";
import { enhancePrompt } from "../tier.ts";

type HookFn = (input: Record<string, unknown>, output: Record<string, unknown>) => Promise<void>;

const PLUGIN_EXPORT: Record<string, string> = {
  horus: "HorusPlugin",
  vibeguard: "VibeguardPlugin",
  dcp: "DcpPlugin",
  "cost-tracker": "CostTrackerPlugin",
  notify: "NotifyPlugin",
  moa: "MoaPlugin",
  router: "RouterPlugin",
  lan: "LanPlugin",
  papyrus: "PapyrusPlugin",
};

export class PluginHost {
  private hooks = new Map<string, HookFn[]>();

  async load(pluginNames: string[]): Promise<void> {
    for (const name of pluginNames) {
      try {
        const mod = await import(join(PLUGINS_DIR, `${name}.ts`));
        const exportName = PLUGIN_EXPORT[name] ?? "default";
        const factory = mod[exportName] ?? mod.default;
        if (typeof factory !== "function") continue;
        const plugin = await factory({ client: {} });
        if (plugin && typeof plugin === "object") {
          for (const [hook, fn] of Object.entries(plugin)) {
            if (typeof fn === "function") this.on(hook, fn as HookFn);
          }
        }
      } catch {
        /* plugin optional */
      }
    }
    // Built-in compression hooks
    this.on("tui.prompt.append", async (input, output) => {
      const text = String((input as { text?: string }).text ?? "");
      (output as { text?: string }).text = enhancePrompt(text);
    });
    this.on("tool.execute.before", async (input, output) => {
      const tool = String((input as { tool?: string }).tool ?? "");
      if (tool !== "bash" && tool !== "read") return;
      const args = ((output as { args?: unknown }).args ?? (input as { args?: unknown }).args) as Record<string, string> | undefined;
      if (!args) return;
      const r = redact(JSON.stringify(args));
      if (r.count > 0) {
        try {
          (output as { args?: unknown }).args = JSON.parse(r.text);
        } catch {
          /* keep original */
        }
      }
    });
    this.on("message.part.updated", async (_input, output) => {
      const part = (output as { part?: { text?: string } }).part;
      if (part?.text) part.text = truncate(part.text, 20000);
    });
  }

  on(hook: string, fn: HookFn): void {
    if (!this.hooks.has(hook)) this.hooks.set(hook, []);
    this.hooks.get(hook)!.push(fn);
  }

  async emit(hook: string, input: Record<string, unknown>, output: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    for (const fn of this.hooks.get(hook) ?? []) {
      await fn(input, output);
    }
    return output;
  }

  async appendPrompt(text: string): Promise<string> {
    const out = await this.emit("tui.prompt.append", { text }, { text });
    return String(out.text ?? text);
  }
}
