/** Quick latency probe for Ollama endpoints */

export interface PingResult {
  name: string;
  url: string;
  ok: boolean;
  ms: number;
  models?: number;
  /** notable small models seen (configured profile models) for bash greps */
  notable?: string[];
  error?: string;
}

/** Notable-model regex derived from the configured profile models + gemma fallback. */
export function notableRegex(...configuredModels: Array<string | undefined>): RegExp {
  const tokens = new Set(["gemma"]);
  for (const m of configuredModels) {
    if (!m) continue;
    const bare = m.includes("/") ? m.split("/").pop()! : m;
    const family = bare.split(":")[0]!;
    if (!family) continue;
    tokens.add(family);
    // Coarse family for compound names: "qwen3-coder-30b-a3b-…" → "qwen3-coder"
    const parts = family.split("-");
    if (parts.length > 1) tokens.add(parts.slice(0, 2).join("-"));
  }
  const pattern = [...tokens].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(pattern, "i");
}

/** Notable regex for a whole config: lanes + the ollama-lan provider's model entries. */
export function profileNotableRegex(
  cfg?: { small_model?: string; model?: string; provider?: Record<string, { models?: Record<string, unknown> }> },
): RegExp {
  const lanModels = Object.keys(cfg?.provider?.["ollama-lan"]?.models ?? {});
  return notableRegex(cfg?.small_model, cfg?.model, ...lanModels);
}

export async function pingUrl(name: string, url: string, timeoutMs = 3000, notable: RegExp = notableRegex()): Promise<PingResult> {
  const base = url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!res.ok) return { name, url: base, ok: false, ms, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const names = (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter(Boolean);
    return { name, url: base, ok: true, ms, models: names.length, notable: names.filter((n) => notable.test(n)).slice(0, 4) };
  } catch (e) {
    return { name, url: base, ok: false, ms: Date.now() - t0, error: String(e) };
  }
}

export async function pingCloud(baseURL: string, apiKey: string, timeoutMs = 5000): Promise<PingResult> {
  const base = baseURL.replace(/\/$/, "");
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!res.ok) return { name: "cloud", url: base, ok: false, ms, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { data?: unknown[] };
    return { name: "cloud", url: base, ok: true, ms, models: data.data?.length ?? 0 };
  } catch (e) {
    return { name: "cloud", url: base, ok: false, ms: Date.now() - t0, error: String(e) };
  }
}

export async function pingAll(env: Record<string, string | undefined>, configured?: { small_model?: string; model?: string; provider?: Record<string, { models?: Record<string, unknown> }> }): Promise<PingResult[]> {
  const lan = env.OLLAMA_LAN_URL ?? "http://localhost:11434";
  const local = env.OLLAMA_LOCAL_URL ?? "http://localhost:11434";
  const notable = profileNotableRegex(configured);
  const lanTag = lanTagOf(lan);
  const out: PingResult[] = [
    await pingUrl(lanTag, lan, 3000, notable),
  ];
  if (local.replace(/\/$/, "") !== lan.replace(/\/$/, "")) {
    out.push(await pingUrl("local", local, 3000, notable));
  }
  if (env.OLLAMA_API_KEY) {
    out.push(await pingCloud(env.OLLAMA_BASE_URL ?? "https://ollama.com/v1", env.OLLAMA_API_KEY));
  }
  return out;
}

function lanTagOf(url: string): string {
  const host = url.replace(/^\w+:\/\//, "").split(/[/:?#]/)[0] ?? "";
  if (/^(localhost|127\.0\.0\.1)$/.test(host)) return "local";
  const m = host.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.(\d{1,3})$/);
  if (m) return m[1]!;
  return host || "lan";
}

export function formatPings(pings: PingResult[], configuredSmall?: string): string {
  const lines = ["RA ping"];
  for (const p of pings) {
    if (p.ok) {
      const note = p.notable?.length ? `  [${p.notable.join(", ")}]` : "";
      lines.push(`✓ ${p.name} ${p.url}  ${p.ms}ms  (${p.models ?? 0} models)${note}`);
    } else {
      lines.push(`✗ ${p.name} ${p.url}  ${p.ms}ms  ${p.error ?? "down"}`);
    }
  }
  const lan = pings.find((p) => p.name !== "local" && p.name !== "cloud");
  const local = pings.find((p) => p.name === "local");
  const cloud = pings.find((p) => p.name === "cloud");
  // If the configured small is a localhost-family model (e.g. ollama/gemma),
  // the small lane lives on @local when that host is up.
  const wantsLocal = /gemma|qwen2/i.test(configuredSmall?.split("/").pop() ?? "");
  let small: string;
  if (wantsLocal) small = local?.ok ? "small@local" : "small@down";
  else if (lan?.ok && lan.notable?.length) small = `small@${lan.name}`;
  else if (local?.ok) small = "small@local";
  else if (lan?.ok) small = `small@${lan.name}`;
  else small = "small@down";
  const big = cloud?.ok ? "big@cloud" : "big@down";
  lines.push(`RA prefer ${small} → ${big}`);
  return lines.join("\n");
}
