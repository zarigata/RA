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
  let config: import("../../anubis/src/config.ts").RaConfig | null = null;
  try { config = (await import("../../anubis/src/config.ts")).loadRaConfig(ANUBIS_HOME); } catch { config = null; }
  const { profileNotableRegex } = await import("../../anubis/src/ping.ts");
  const notable = profileNotableRegex(config ?? undefined);

  try {
    const { pingAll, formatPings } = await import("../../anubis/src/ping.ts");
    const pings = await pingAll(process.env as Record<string, string>, config ?? undefined);
    console.log(formatPings(pings, config?.small_model));
    const lan = pings.find((p) => p.name !== "local" && p.name !== "cloud");
    const local = pings.find((p) => p.name === "local");
    // Small is reachable if EITHER the LAN box or localhost is up (fallback chain).
    check("Ollama small reachable", !!(lan?.ok || local?.ok), "start ollama on your LAN server (OLLAMA_LAN_URL) or localhost");
  } catch {
    check("Ollama ping", false, "network / ollama down");
  }

  try {
    const small = await pickOllamaEndpoint(process.env as Record<string, string>);
    const { hostTag } = await import("../../anubis/src/tui.ts");
    const host = hostTag(small.baseURL, small.kind);
    const hasSmall = small.availableModels.some((m) => notable.test(m));
    check(
      `Small Ollama (@${host}, ${small.availableModels.length} models${hasSmall ? ", profile model present" : ""})`,
      small.availableModels.length > 0,
      "start ollama on your LAN server (see OLLAMA_LAN_URL in anubis/.env) or localhost",
    );
    if (config?.small_model && hasSmall && !small.availableModels.includes(config.small_model.split("/").pop()!)) {
      console.log(`  ⚠ configured small model "${config.small_model}" not seen on @${host} — pull it or point small_model at a listed model`);
    }
    // Context registry (ra.78): show each model's USABLE window (probed max
    // clamped by the num_ctx server cap), not the nominal marketing number.
    try {
      const { contextPolicy, formatContext, modelMaxContextLive, usableContext } = await import("../../anubis/src/context-limits.ts");
      const policy = contextPolicy(config ?? {});
      console.log(`○ adaptive context ${policy.adaptive ? "ON" : "OFF"} · low/critical ${Math.round(policy.lowWatermark * 100)}%/${Math.round(policy.criticalWatermark * 100)}% · continuations ≤${policy.resumeLimit}`);
      for (const m of small.availableModels.slice(0, 5)) {
        const max = await modelMaxContextLive(small, m, config ?? {});
        console.log(`    ${m} — ${formatContext(usableContext(max, m, small.kind, policy), max)}`);
      }
    } catch { /* registry display is best-effort */ }
  } catch {
    check("Small Ollama LAN / localhost", false, "set OLLAMA_LAN_URL in anubis/.env (e.g. http://your-lan-server:11434)");
  }

  // Optional localhost fallback probe (only if LAN is different)
  const localUrl = process.env.OLLAMA_LOCAL_URL ?? "http://localhost:11434";
  const lanUrl = process.env.OLLAMA_LAN_URL ?? "http://localhost:11434";
  if (localUrl.replace(/\/$/, "") !== lanUrl.replace(/\/$/, "")) {
    try {
      const local = OllamaClient.fromLocal(localUrl);
      if (await local.probe(1500)) {
        const notableLocal = local.availableModels.filter((m) => notable.test(m));
        console.log(`○ localhost fallback OK (${notableLocal.length ? notableLocal.join(", ") : local.availableModels.length + " models"})`);
      } else {
        console.log("○ localhost fallback not running (optional)");
      }
    } catch {
      console.log("○ localhost fallback not running (optional)");
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
