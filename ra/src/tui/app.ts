import * as readline from "node:readline";
import { renderSplash, APP_NAME } from "../../../anubis/src/tui.ts";
import { getPalette, DEFAULT_UI_CONFIG, type UiConfig } from "../../../anubis/src/ui.ts";
import { loadRaConfig, ensureRaDirs, applyProjectOverride, applyEnvOverrides } from "../../../anubis/src/config.ts";
import { ANUBIS_HOME } from "../paths.ts";
import { loadEnv } from "../../../anubis/src/env.ts";
import { loadSession, saveSession, appendMessage, formatReattach, getActiveSession } from "../server/session.ts";
import { RemoteClient } from "../server/remote.ts";
import { SubagentTree } from "./tree.ts";
import { PluginHost } from "../plugins/host.ts";
import { dispatchCommand, PALETTE_COMMANDS } from "../commands/index.ts";
import { runOrchestratorTurn, onGlobalHook, setActiveSubagentTracker, getActiveSubagentTracker, setActiveStreamRenderer, abortActiveTurn } from "../agent.ts";
import { expandMentions } from "../tools/index.ts";
import { loadUsage, buildReport, formatReport, formatCost } from "../../../anubis/src/cost.ts";

export interface TuiOptions {
  cwd: string;
  headless?: boolean;
  remoteUrl?: string | null;
}

export async function startTui(opts: TuiOptions): Promise<void> {
  ensureRaDirs();
  loadEnv(ANUBIS_HOME);
  // Check for active session pointer (set by `ra sessions --switch`)
  const activeSession = getActiveSession();
  if (activeSession && !opts.remoteUrl) {
    opts.cwd = activeSession.cwd;
  }
  const config = applyEnvOverrides(applyProjectOverride(loadRaConfig(ANUBIS_HOME), opts.cwd));
  const remote = opts.remoteUrl ? new RemoteClient({ url: opts.remoteUrl }) : null;
  const remoteOk = remote ? await remote.health() : false;
  const session = remoteOk ? await remote.loadSession(opts.cwd) : loadSession(opts.cwd);
  const subagentTree = new SubagentTree();
  // Make the tree visible to agent.ts (spawn tracking) and /tree (rendering).
  setActiveSubagentTracker(subagentTree);
  const plugins = new PluginHost();
  await plugins.load(config.plugin ?? []);

  // Bridge agent global hooks to the plugin host
  onGlobalHook("agent.turn.start", (input) => { void plugins.emit("agent.turn.start", input, {}); });
  onGlobalHook("agent.turn.end", (input) => { void plugins.emit("agent.turn.end", input, {}); });

  // Phase 0.1 — stream tokens live. The final reply body is suppressed when
  // it matches what already streamed (only the footer/sidebar reprints).
  let streamedThisTurn = "";
  if (!opts.headless) {
    setActiveStreamRenderer((tok) => {
      streamedThisTurn += tok;
      process.stdout.write(tok);
    });
  }

  const ctx = { cwd: opts.cwd, get history() { return session.messages.slice(0, -1).slice(-8).map(m => ({ role: m.role, content: m.content.slice(-3000) })); } };
  const costSidebar = (): string => {
    const report = buildReport(loadUsage());
    if (!report.length) return "";
    const total = report.reduce((s, r) => s + r.cost, 0);
    const tokens = report.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
    const top = report
      .slice(0, 3)
      .map((r) => `  ${r.model}: ${r.inputTokens + r.outputTokens} tok · ${formatCost(r.model, r.cost)}`)
      .join("\n");
    return `\x1b[2m╭ context ─────────────\n${top}\n  TOTAL: ${tokens} tok · $${total.toFixed(4)}\n╰─\x1b[0m`;
  };
  const reply = (text: string) => {
    if (remoteOk) {
      void remote!.appendMessage(session, "assistant", text);
    } else {
      appendMessage(session, "assistant", text);
    }
    if (!opts.headless) {
      const norm = (s: string) => s.replace(/\s+/g, " ");
      const streamed = streamedThisTurn;
      streamedThisTurn = "";
      const bodyAlreadyStreamed = streamed.length > 40 && norm(text).includes(norm(streamed).slice(0, 200));
      if (bodyAlreadyStreamed) {
        console.log(`\n\x1b[33mRA\x1b[0m \x1b[2m(streamed above)\x1b[0m\n`);
      } else {
        console.log(`\n\x1b[33mRA\x1b[0m\n${text}\n`);
      }
      const sidebar = costSidebar();
      if (sidebar) console.log(sidebar);
      if (subagentTree.hasTree) {
        console.log(`\x1b[2m${subagentTree.render()}\x1b[0m`);
      }
    }
  };

  if (!opts.headless) {
    console.clear();
    console.log(renderSplash(config.theme));
    const remoteTag = remoteOk ? ` · connected to ${opts.remoteUrl}` : "";
    console.log(
      `\x1b[2mProject: ${opts.cwd} | Profile: ${config.profile ?? "default"} | Ctrl+P palette | /help${remoteTag}\x1b[0m\n`,
    );
    if (session.messages.length === 0) {
      const { loadLastRun, formatLaneLine, formatIntentLine } = await import("../../../anubis/src/last-run.ts");
      const last = loadLastRun();
      const lastLines =
        last?.timings?.length
          ? `\n  ${formatLaneLine(last)}\n  ${formatIntentLine(last)}${
              last.ms != null ? `\n  elapsed: ${(last.ms / 1000).toFixed(1)}s` : ""
            }`
          : "";
      console.log(
        `\x1b[36mWelcome to RA.\x1b[0m New here? Try:\n  /simple on\n  /quick write a hello world function\n  /again  (re-run last full-dev)\n  /verify  (re-check last artifacts)\n  /palette\n  small: ${config.small_model} · code: ${config.model}${lastLines}\n`,
      );
    } else {
      // Reattach: surface the prior conversation so the user has context.
      console.log(`\x1b[36m${formatReattach(session)}.\x1b[0m\n  /history to review · /clear to reset\n`);
    }
    // Phase 0.2 — background warm-up: load the small model on .251 so the
    // first turn doesn't pay the ~55s cold-load. Fire-and-forget.
    const warmEnv = loadEnv(ANUBIS_HOME);
    if (!config.small_model?.startsWith("ollama-cloud/")) void import("../../../anubis/src/ollama.ts").then(({ warmOllama }) =>
      warmOllama(warmEnv, config.small_model, warmEnv.OLLAMA_KEEP_ALIVE ?? "30m").catch(() => {})
    );
  }

  if (opts.headless) return;

  let paletteOpen = false;
  let busy = false;
  const queue: string[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: `\x1b[32m${APP_NAME}\x1b[0m › `,
  });

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin, rl);
    process.stdin.setRawMode(true);
    // Keybinds from config (default: ctrl+p → palette)
    const keybinds: Record<string, string> = { "ctrl+p": "palette", ...config.keybinds };
    process.stdin.on("keypress", (_str, key) => {
      if (!key) return;
      if (key.name === "escape" && busy) {
        if (abortActiveTurn()) console.log("\nCancelling…");
        queue.length = 0;
        return;
      }
      const combo = (key.ctrl ? "ctrl+" : "") + key.name;
      const action = keybinds[combo];
      if (action === "palette" || (key.ctrl && key.name === "p")) {
        paletteOpen = !paletteOpen;
        if (paletteOpen) {
          console.log("\n\x1b[36m── Command Palette (type number) ──\x1b[0m");
          PALETTE_COMMANDS.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
          rl.setPrompt("palette › ");
        } else {
          rl.setPrompt(`\x1b[32m${APP_NAME}\x1b[0m › `);
        }
        rl.prompt();
        return;
      }
      // Custom keybind actions: map to slash commands
      if (action && action.startsWith("/")) {
        queue.push(action);
        void drain();
        return;
      }
      if (key.ctrl && key.name === "c") {
        console.log("\nUse /exit or Ctrl+D to quit");
      }
    });
  }

  async function drain(): Promise<void> {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const input = queue.shift()!;
      if (input === "/exit" || input === "exit") {
        saveSession(session);
        rl.close();
        process.exit(0);
      }
      if (paletteOpen && /^\d+$/.test(input)) {
        paletteOpen = false;
        rl.setPrompt(`\x1b[32m${APP_NAME}\x1b[0m › `);
        const cmd = PALETTE_COMMANDS[parseInt(input, 10) - 1];
        if (cmd) {
          try { await handleInput(cmd, config, session, plugins, ctx, reply, remote, remoteOk, subagentTree); }
          catch (e) { reply(`Error: ${String(e)}`); }
        }
        continue;
      }
      paletteOpen = false;
      rl.setPrompt(`\x1b[32m${APP_NAME}\x1b[0m › `);
      try {
        await handleInput(input, config, session, plugins, ctx, reply, remote, remoteOk, subagentTree);
      } catch (e) { reply(`Error: ${String(e)}`); }
    }
    busy = false;
    rl.prompt();
  }

  rl.prompt();
  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    queue.push(input);
    void drain();
  });

  rl.on("close", () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    setActiveSubagentTracker(null);
    setActiveStreamRenderer(null);
    saveSession(session);
  });

  // Without a SIGINT listener, readline closes the interface on Ctrl+C and
  // the process exits — the refusal message below would be a lie. Registering
  // this handler keeps the app alive; Ctrl+D / /exit still quit cleanly.
  rl.on("SIGINT", () => {
    rl.prompt();
  });
}

async function handleInput(
  input: string,
  config: ReturnType<typeof loadRaConfig>,
  session: ReturnType<typeof loadSession>,
  plugins: PluginHost,
  ctx: { cwd: string },
  reply: (t: string) => void,
  remote: RemoteClient | null,
  remoteOk: boolean,
  _subagentTree: SubagentTree,
): Promise<void> {
  if (remoteOk) {
    void remote!.appendMessage(session, "user", input);
  } else {
    appendMessage(session, "user", input);
  }

  if (input.trim().startsWith("/")) {
    const handled = await dispatchCommand(input.trim(), { config, session, plugins, ctx, reply });
    if (handled) {
      saveSession(session);
      return;
    }
  }

  // Local file commands take paths, not prompts; plugin instructions must not
  // become part of a filename (or shell-like listing argument).
  const direct = /^(?:read\s|ls(?:\s|$)|list$)/.test(input);
  const enhanced = direct ? input : await plugins.appendPrompt(input);

  if (session.simpleMode && !input.startsWith("/")) {
    reply("Try /plan first, then /code — or type /help");
    return;
  }

  try {
    // @-mention file picker: inline referenced files into the prompt.
    const withFiles = expandMentions(enhanced, ctx.cwd);
    const out = await runOrchestratorTurn(withFiles, config, ctx);
    reply(out);
  } catch (e) {
    reply(`Error: ${String(e)}`);
  }
  saveSession(session);
}
