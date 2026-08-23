/** Quick latency probe for Ollama endpoints */

export interface PingResult {
  name: string;
  url: string;
  ok: boolean;
  ms: number;
  models?: number;
  /** notable small models seen (qwen/gemma) for bash greps */
  notable?: string[];
  error?: string;
}

export async function pingUrl(name: string, url: string, timeoutMs = 3000): Promise<PingResult> {
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
    const notable = names.filter((n) => /qwen3\.?8|gemma/i.test(n)).slice(0, 4);
    return { name, url: base, ok: true, ms, models: names.length, notable };
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

export async function pingAll(env: Record<string, string | undefined>): Promise<PingResult[]> {
  const lan = env.OLLAMA_LAN_URL ?? "http://192.168.1.251:11434";
  const local = env.OLLAMA_LOCAL_URL ?? "http://localhost:11434";
  const out: PingResult[] = [
    await pingUrl("251", lan),
  ];
  if (local.replace(/\/$/, "") !== lan.replace(/\/$/, "")) {
    out.push(await pingUrl("local", local));
  }
  if (env.OLLAMA_API_KEY) {
    out.push(await pingCloud(env.OLLAMA_BASE_URL ?? "https://ollama.com/v1", env.OLLAMA_API_KEY));
  }
  return out;
}

export function formatPings(pings: PingResult[]): string {
  const lines = ["RA ping"];
  for (const p of pings) {
    if (p.ok) {
      const note = p.notable?.length ? `  [${p.notable.join(", ")}]` : "";
      lines.push(`✓ ${p.name} ${p.url}  ${p.ms}ms  (${p.models ?? 0} models)${note}`);
    } else {
      lines.push(`✗ ${p.name} ${p.url}  ${p.ms}ms  ${p.error ?? "down"}`);
    }
  }
  const lan = pings.find((p) => p.name === "251");
  const local = pings.find((p) => p.name === "local");
  const cloud = pings.find((p) => p.name === "cloud");
  const hasQwen = !!lan?.notable?.some((n) => /qwen3\.?8/i.test(n));
  const small =
    lan?.ok && (hasQwen || !local?.ok) ? "small@251" : local?.ok ? "small@local" : lan?.ok ? "small@251" : "small@down";
  const big = cloud?.ok ? "big@cloud" : "big@down";
  lines.push(`RA prefer ${small} → ${big}`);
  return lines.join("\n");
}
