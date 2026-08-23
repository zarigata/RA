// models.dev catalog ingestion — fetch the provider/model catalog and convert
// it into RA provider definitions (OpenAI-compatible endpoints + env keys).

export interface CatalogModel {
  id: string;
  name?: string;
  description?: string;
}

export interface CatalogProvider {
  id: string;
  name?: string;
  api?: string;
  env?: string[];
  npm?: string;
  models?: Record<string, CatalogModel>;
}

export interface Catalog {
  [providerId: string]: CatalogProvider;
}

const CATALOG_URL = "https://models.dev/api.json";

/** Fetch the models.dev catalog. */
export async function fetchCatalog(url = CATALOG_URL): Promise<Catalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catalog fetch ${res.status}`);
  return (await res.json()) as Catalog;
}

/**
 * Convert a catalog provider into an RA provider definition. Only providers
 * with an OpenAI-compatible API URL and an env key are usable.
 */
export function toProviderDef(p: CatalogProvider): {
  name: string;
  options: { baseURL: string; apiKey: string };
  models: Record<string, { name: string }>;
} | null {
  if (!p.api || !p.env?.length) return null;
  const baseURL = p.api.endsWith("/v1") ? p.api : `${p.api.replace(/\/$/, "")}/v1`;
  const models: Record<string, { name: string }> = {};
  for (const [id, m] of Object.entries(p.models ?? {})) {
    models[id] = { name: m.name ?? id };
  }
  return {
    name: p.name ?? p.id,
    options: { baseURL, apiKey: `{env:${p.env[0]}}` },
    models,
  };
}

/** Build a `provider` config block from the catalog (usable in ra.json). */
export function buildProviderConfig(catalog: Catalog): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(catalog)) {
    const def = toProviderDef(p);
    if (def) out[id] = def;
  }
  return out;
}

/** Count how many catalog providers are OpenAI-compatible and usable. */
export function countUsableProviders(catalog: Catalog): number {
  return Object.values(catalog).filter((p) => p.api && p.env?.length).length;
}
