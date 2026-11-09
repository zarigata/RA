import { existsSync } from "node:fs";
import { loadEnv } from "../../anubis/src/env.ts";
import { OllamaClient, pickOllamaEndpoint } from "../../anubis/src/ollama.ts";
import { ANUBIS_HOME } from "./paths.ts";

export async function runDoctor(fix = false): Promise<number> {
  const before = await doctorChecks();
  if (!fix || before === 0) return before;
  // --fix: repair a stale model config, then re-run once and print before/after.
  const ascii = process.env.RA_ASCII === "1" || process.env.RA_ASCII === "true" || process.env.TERM === "dumb";
  const mark = (ok: boolean) => (ascii ? (ok ? "+" : "x") : ok ? "✓" : "✗");
  console.log("\nRA doctor --fix — probing local servers…");
  try {
    const { scanLocalTargets, pickDefaults, saveSetupChoice } = await import("../../anubis/src/setup.ts");
    const { found } = await scanLocalTargets(process.env as Record<string, string>);
    if (found.length === 0) {
      console.log(`${mark(false)} no local model server found — fix would set nothing. Start Ollama / LM Studio, then re-run.`);
      return 1;
    }
    const { loadRaConfig } = await import("../../anubis/src/config.ts");
    let cfg: import("../../anubis/src/config.ts").RaConfig | null = null;
    try { cfg = loadRaConfig(ANUBIS_HOME); } catch { cfg = null; }
    // Never silently change a config that already has a working lane.
    const pick = pickDefaults(found, {
      small_model: cfg?.small_model,
      model: cfg?.model,
      currentSmallOk: await beforeOk("small", cfg),
      currentBigOk: await beforeOk("big", cfg),
    });
    if (cfg?.small_model && pick.small === cfg.small_model) {
      console.log(`${mark(true)} lane already working (${cfg.small_model}) — nothing to fix`);
      return before;
    }
    const { configPath } = saveSetupChoice({ root: ANUBIS_HOME, found, small: pick.small, big: pick.big });
    console.log(`${mark(true)} wrote ${pick.small ?? "(none)"} → ${configPath}`);
    const after = await doctorChecks();
    console.log(`\nRA doctor (after fix) — exit ${after}`);
    return after;
  } catch (e) {
    console.error(`RA doctor --fix failed: ${String(e)}`);
    return 1;
  }
}

/** Was the given lane already working before --fix ran? One cheap ping. */
async function beforeOk(which: "small" | "big", cfg: { small_model?: string; model?: string } | null): Promise<boolean> {
  const lane = which === "small" ? cfg?.small_model : cfg?.model;
  if (!lane) return false;
  const { pingUrl } = await import("../../anubis/src/ping.ts");
  const { providerUrlForLane } = await import("./setup.ts");
  return (await pingUrl(which, providerUrlForLane(process.env as Record<string, string>, lane), 3000)).ok;
}

async function doctorChecks(): Promise<number> {
  const { RA_VERSION } = await import("../../anubis/src/version.ts");
  console.log(`RA doctor v${RA_VERSION}`);
  let ok = true;
  const { statusPrefix } = await import("./tui/chrome.ts");
  const ascii = process.env.RA_ASCII === "1" || process.env.RA_ASCII === "true" || process.env.TERM === "dumb";
  const marks = { pass: statusPrefix("ok", ascii).glyph, fail: statusPrefix("error", ascii).glyph, idle: statusPrefix("info", ascii).glyph };
  /** ASCII mode: keep the whole doctor output plain-ASCII (§4.3 mapping). */
  const say = (line: string) => console.log(
    ascii
      ? line.replace(/✓/g, marks.pass).replace(/✗/g, marks.fail).replace(/○/g, marks.idle).replace(/→/g, "->").replace(/⚠/g, "!").replace(/·/g, "-").replace(/≤/g, "<=").replace(/—/g, "--")
      : line,
  );
  const check = (name: string, pass: boolean, fix: string) => {
    say(`${pass ? marks.pass : marks.fail} ${name}`);
    if (!pass) {
      say(`  → ${fix}`);
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
    say(formatPings(pings, config?.small_model));
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
      say(`  ⚠ configured small model "${config.small_model}" not seen on @${host} — pull it or point small_model at a listed model`);
    }
    // Context registry (ra.78): show each model's USABLE window (probed max
    // clamped by the num_ctx server cap), not the nominal marketing number.
    try {
      const { contextPolicy, formatContext, modelMaxContextLive, usableContext } = await import("../../anubis/src/context-limits.ts");
      const policy = contextPolicy(config ?? {});
      say(`○ adaptive context ${policy.adaptive ? "ON" : "OFF"} · low/critical ${Math.round(policy.lowWatermark * 100)}%/${Math.round(policy.criticalWatermark * 100)}% · continuations ≤${policy.resumeLimit}`);
      for (const m of small.availableModels.slice(0, 5)) {
        const max = await modelMaxContextLive(small, m, config ?? {});
        say(`    ${m} — ${formatContext(usableContext(max, m, small.kind, policy), max)}`);
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
        say(`○ localhost fallback OK (${notableLocal.length ? notableLocal.join(", ") : local.availableModels.length + " models"})`);
      } else {
        say("○ localhost fallback not running (optional)");
      }
    } catch {
      say("○ localhost fallback not running (optional)");
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
    say("○ OLLAMA_API_KEY not set (needed for BIG / cloud models)");
  }

  if (!process.env.ZAI_API_KEY) say("○ ZAI_API_KEY not set (optional)");

  try {
    const { loadLastRun, formatLaneLine, formatIntentLine } = await import("../../anubis/src/last-run.ts");
    const last = loadLastRun();
    if (last?.timings?.length) {
      say(formatLaneLine(last));
      say(formatIntentLine(last));
      say("again: ra again --quick --verify");
    } else say("○ no RA lane yet (run ra demo or /quick)");
  } catch {
    /* ignore */
  }

  return ok ? 0 : 1;
}
