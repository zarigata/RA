import * as readline from "node:readline";
import { renderSplash, APP_NAME } from "../../../anubis/src/tui.ts";
import { loadRaConfig, ensureRaDirs, applyProjectOverride } from "../../../anubis/src/config.ts";
import { ANUBIS_HOME } from "../paths.ts";
import { loadEnv } from "../../../anubis/src/env.ts";
import { loadSession, saveSession, appendMessage } from "../server/session.ts";
import { PluginHost } from "../plugins/host.ts";
import { dispatchCommand, PALETTE_COMMANDS } from "../commands/index.ts";
import { runOrchestratorTurn } from "../agent.ts";

export interface TuiOptions {
  cwd: string;
  headless?: boolean;
}

export async function startTui(opts: TuiOptions): Promise<void> {
  ensureRaDirs();
  loadEnv(ANUBIS_HOME);
  const config = applyProjectOverride(loadRaConfig(ANUBIS_HOME), opts.cwd);
  const session = loadSession(opts.cwd);
  const plugins = new PluginHost();
  await plugins.load(config.plugin ?? []);

  const ctx = { cwd: opts.cwd };
  const reply = (text: string) => {
    appendMessage(session, "assistant", text);
    if (!opts.headless) {
      console.log(`\n\x1b[33mRA\x1b[0m\n${text}\n`);
    }
  };

  if (!opts.headless) {
    console.clear();
    console.log(renderSplash());
    console.log(
      `\x1b[2mProject: ${opts.cwd} | Profile: ${config.profile ?? "default"} | Ctrl+P palette | /help\x1b[0m\n`,
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
        `\x1b[36mWelcome to RA.\x1b[0m New here? Try:\n  /simple on\n  /quick write a hello world function\n  /again  (re-run last full-dev)\n  /verify  (re-check last artifacts)\n  /palette\n  small: qwen3.8 @251 · gemma @local · BIG glm @cloud${lastLines}\n`,
      );
    }
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
    process.stdin.on("keypress", (_str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "p") {
        paletteOpen = !paletteOpen;
        if (paletteOpen) {
          console.log("\n\x1b[36m── Command Palette (type number) ──\x1b[0m");
          PALETTE_COMMANDS.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
          rl.setPrompt("palette › ");
        } else {
          rl.setPrompt(`\x1b[32m${APP_NAME}\x1b[0m › `);
        }
        rl.prompt();
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
        if (cmd) await handleInput(cmd, config, session, plugins, ctx, reply);
        continue;
      }
      paletteOpen = false;
      rl.setPrompt(`\x1b[32m${APP_NAME}\x1b[0m › `);
      await handleInput(input, config, session, plugins, ctx, reply);
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
    saveSession(session);
  });
}

async function handleInput(
  input: string,
  config: ReturnType<typeof loadRaConfig>,
  session: ReturnType<typeof loadSession>,
  plugins: PluginHost,
  ctx: { cwd: string },
  reply: (t: string) => void,
): Promise<void> {
  appendMessage(session, "user", input);

  if (input.trim().startsWith("/")) {
    const handled = await dispatchCommand(input.trim(), { config, session, plugins, ctx, reply });
    if (handled) {
      saveSession(session);
      return;
    }
  }

  const enhanced = await plugins.appendPrompt(input);

  if (session.simpleMode && !input.startsWith("/")) {
    reply("Try /plan first, then /code — or type /help");
    return;
  }

  try {
    const out = await runOrchestratorTurn(enhanced, config, ctx);
    reply(out);
  } catch (e) {
    reply(`Error: ${String(e)}`);
  }
  saveSession(session);
}
