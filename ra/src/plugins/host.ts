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
    // Expanded hook surface: agent lifecycle events
    this.on("agent.turn.start", async (input, _output) => {
      const role = String((input as { role?: string }).role ?? "");
      const task = String((input as { task?: string }).task ?? "");
      if (role) console.error(`\x1b[2m[plugin] agent ${role} starting: ${task.slice(0, 60)}\x1b[0m`);
    });
    this.on("agent.turn.end", async (input, _output) => {
      const role = String((input as { role?: string }).role ?? "");
      const model = String((input as { model?: string }).model ?? "");
      if (role) console.error(`\x1b[2m[plugin] agent ${role} done (${model})\x1b[0m`);
    });
    // Hook: before file write — allows plugins to validate or transform content
    this.on("tool.write.before", async (input, output) => {
      const filename = String((input as { file?: string }).file ?? "");
      const content = String((input as { content?: string }).content ?? "");
      const r = redact(content);
      if (r.count > 0) {
        (output as { content?: string }).content = r.text;
        console.error(`\x1b[2m[plugin] vibeguard redacted ${r.count} secret(s) in ${filename}\x1b[0m`);
      }
    });
    // Hook: after file write — allows plugins to trigger diagnostics or indexing
    this.on("tool.write.after", async (input, _output) => {
      const filename = String((input as { file?: string }).file ?? "");
      if (filename) {
        // Could trigger diagnostics, reindex, etc. — kept lightweight for now.
      }
    });
    // Hook: session events
    this.on("session.save", async (input, _output) => {
      const cwd = String((input as { cwd?: string }).cwd ?? "");
      // Plugins can observe session saves (e.g. for backup/sync)
    });
    // Hook: model fallback
    this.on("model.fallback", async (input, _output) => {
      const from = String((input as { from?: string }).from ?? "");
      const to = String((input as { to?: string }).to ?? "");
      const reason = String((input as { reason?: string }).reason ?? "");
      if (from && to) console.error(`\x1b[2m[plugin] model fallback: ${from} → ${to} (${reason})\x1b[0m`);
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

  /** All known hook names that plugins can register for. */
  static readonly KNOWN_HOOKS = [
    "tui.prompt.append",       // before sending prompt to model
    "tui.command.execute",      // when a slash command is dispatched
    "tool.execute.before",      // before any tool runs
    "tool.write.before",        // before writing a file (can transform content)
    "tool.write.after",         // after writing a file (can trigger diagnostics)
    "tool.edit.before",         // before editing a file
    "tool.edit.after",          // after editing a file
    "message.part.updated",     // when a message part is updated (can truncate)
    "agent.turn.start",         // when an agent turn begins
    "agent.turn.end",           // when an agent turn ends
    "session.save",             // when a session is persisted
    "model.fallback",           // when a model falls back to another
  ] as const;

  /** List currently registered hooks. */
  registeredHooks(): string[] {
    return [...this.hooks.keys()];
  }
}
