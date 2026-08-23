// src/redact.ts — vibeguard secret redaction (pure, testable)

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style (after ant check)
  /AIza[A-Za-z0-9_-]{20,}/g, // Google
  /ghp_[A-Za-z0-9]{30,}/g, // GitHub PAT
  /gho_[A-Za-z0-9]{30,}/g, // GitHub OAuth
  /AKIA[A-Z0-9]{16}/g, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /[0-9a-f]{32}\.[0-9a-zA-Z_-]{16,}/g, // Ollama-style token.id
];

const PLACEHOLDER = (i: number) => `__VIBEGUARD_${i}__`;

export interface RedactResult {
  text: string;
  stash: Map<string, string>;
  count: number;
}

export function redact(input: string): RedactResult {
  const stash = new Map<string, string>();
  let count = 0;
  // Anthropic first so sk-ant- is not partially matched by sk- rule
  let text = input.replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, (m) => {
    const k = PLACEHOLDER(count++);
    stash.set(k, m);
    return k;
  });
  for (const re of SECRET_PATTERNS.slice(1)) {
    text = text.replace(re, (m) => {
      const k = PLACEHOLDER(count++);
      stash.set(k, m);
      return k;
    });
  }
  return { text, stash, count };
}

export function restore(text: string, stash: Map<string, string>): string {
  let out = text;
  for (const [k, v] of stash) {
    out = out.split(k).join(v);
  }
  return out;
}

export function hasSecret(input: string): boolean {
  return redact(input).count > 0;
}
