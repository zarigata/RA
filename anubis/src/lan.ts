// src/lan.ts — LAN host discovery (pure + IO, testable with mocks)

export interface LanPortDef {
  port: number;
  provider: string;
  name: string;
}

export const LAN_PORTS: LanPortDef[] = [
  { port: 11434, provider: "ollama-lan", name: "Ollama" },
  { port: 1234, provider: "lmstudio-lan", name: "LM Studio" },
  { port: 8080, provider: "llamacpp-lan", name: "llama.cpp" },
];

export interface DiscoveredHost {
  host: string;
  port: number;
  provider: string;
  name: string;
  models: string[];
}

export async function scanHost(
  host: string,
  port: number,
  timeoutMs = 300,
): Promise<string[] | null> {
  const url = `http://${host}:${port}/v1/models`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  } catch {
    return null;
  }
}

export async function scanSubnet(
  cidr: string,
  scanFn: (host: string, port: number) => Promise<string[] | null> = scanHost,
): Promise<DiscoveredHost[]> {
  const hosts = expandSubnet(cidr);
  const found: DiscoveredHost[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      for (const def of LAN_PORTS) {
        const models = await scanFn(host, def.port);
        if (models && models.length > 0) {
          found.push({ host, ...def, models });
        }
      }
    }),
  );
  return found;
}

export function expandSubnet(cidr: string): string[] {
  // supports /24 only for simplicity; returns host list
  const m = cidr.match(/^(\d+)\.(\d+)\.(\d+)\.0\/(\d+)$/);
  if (!m) return [];
  const [, a, b, c, bitsStr] = m;
  const bits = parseInt(bitsStr, 10);
  if (bits !== 24) return [`${a}.${b}.${c}.1`]; // fallback
  const out: string[] = [];
  for (let i = 1; i < 255; i++) out.push(`${a}.${b}.${c}.${i}`);
  return out;
}

export function formatDiscovery(found: DiscoveredHost[]): string {
  if (found.length === 0) return "No LAN model servers found.";
  const lines = found.map(
    (h) =>
      `+ ${h.host}:${h.port}  ${h.name.padEnd(10)} models: ${h.models.join(", ")}`,
  );
  lines.push(`Found ${found.length} LAN provider(s). Use /models to select.`);
  return lines.join("\n");
}

export interface LanProviderConfig {
  providers: Record<
    string,
    { baseURL: string; models: string[] }
  >;
}

export function buildLanConfig(found: DiscoveredHost[]): LanProviderConfig {
  const providers: LanProviderConfig["providers"] = {};
  for (const h of found) {
    providers[h.provider] = {
      baseURL: `http://${h.host}:${h.port}/v1`,
      models: h.models,
    };
  }
  return { providers };
}
