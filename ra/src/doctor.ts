import { existsSync } from "node:fs";
import { loadEnv } from "../../anubis/src/env.ts";
import { OllamaClient, pickOllamaEndpoint } from "../../anubis/src/ollama.ts";
import { ANUBIS_HOME } from "./paths.ts";

export async function runDoctor(): Promise<number> {
  const { RA_VERSION } = await import("../../anubis/src/version.ts");
  console.log(`RA doctor v${RA_VERSION}`);
  let ok = true;
  const check = (name: string, pass: boolean, fix: string) => {
    console.log(`${pass ? "✓" : "✗"} ${name}`);
    if (!pass) {
      console.log(`  → ${fix}`);
      ok = false;
    }
  };

  check("bun installed", !!Bun.version, "curl -fsSL https://bun.sh/install | bash");
  check("RA home", existsSync(ANUBIS_HOME), "re-run ./install");
  check("ra.json", existsSync(`${ANUBIS_HOME}/ra.json`), "missing config");

  loadEnv(ANUBIS_HOME);

  try {
    const { pingAll, formatPings } = await import("../../anubis/src/ping.ts");
    const pings = await pingAll(process.env as Record<string, string>);
    console.log(formatPings(pings));
    const lan = pings.find((p) => p.name === "251" || p.name === "local");
    check("Ollama small reachable", !!lan?.ok, "start ollama on 192.168.1.251 or localhost");
  } catch {
    check("Ollama ping", false, "network / ollama down");
  }

  try {
    const small = await pickOllamaEndpoint(process.env as Record<string, string>);
    const { hostTag } = await import("../../anubis/src/tui.ts");
    const host = hostTag(small.baseURL, small.kind);
    const hasQwen = small.availableModels.some((m) => /qwen3\.?8/i.test(m));
    check(
      `Small Ollama (@${host}, ${small.availableModels.length} models${hasQwen ? ", qwen3.8" : ""})`,
      small.availableModels.length > 0,
      "start ollama on 192.168.1.251 (qwen3.8) or localhost gemma",
    );
  } catch {
    check("Small Ollama .251 / localhost", false, "OLLAMA_LAN_URL=http://192.168.1.251:11434");
  }

  // Optional localhost gemma probe (only if LAN is different)
  const localUrl = process.env.OLLAMA_LOCAL_URL ?? "http://localhost:11434";
  const lanUrl = process.env.OLLAMA_LAN_URL ?? "http://192.168.1.251:11434";
  if (localUrl.replace(/\/$/, "") !== lanUrl.replace(/\/$/, "")) {
    try {
      const local = OllamaClient.fromLocal(localUrl);
      if (await local.probe(1500)) {
        const gemma = local.availableModels.filter((m) => /gemma/i.test(m));
        console.log(`○ localhost fallback OK (${gemma.length ? gemma.join(", ") : local.availableModels.length + " models"})`);
      } else {
        console.log("○ localhost gemma fallback not running (optional)");
      }
    } catch {
      console.log("○ localhost gemma fallback not running (optional)");
    }
  }

  if (process.env.OLLAMA_API_KEY) {
    try {
      const cloud = OllamaClient.fromEnv(process.env as Record<string, string>);
      const models = await cloud.listModels();
      check(`Ollama Cloud BIG (${models.length} models)`, models.length > 0, "check OLLAMA_API_KEY");
    } catch (e) {
      check("Ollama Cloud BIG", false, String(e));
    }
  } else {
    console.log("○ OLLAMA_API_KEY not set (needed for BIG / cloud models)");
  }

  if (!process.env.ZAI_API_KEY) console.log("○ ZAI_API_KEY not set (optional)");

  try {
    const { loadLastRun, formatLaneLine, formatIntentLine } = await import("../../anubis/src/last-run.ts");
    const last = loadLastRun();
    if (last?.timings?.length) {
      console.log(formatLaneLine(last));
      console.log(formatIntentLine(last));
      console.log("again: ra again --quick --verify");
    } else console.log("○ no RA lane yet (run ra demo or /quick)");
  } catch {
    /* ignore */
  }

  return ok ? 0 : 1;
}
