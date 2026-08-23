// Symbol outline — lightweight regex-based code navigation (tree-sitter equivalent
// without a native dependency). Extracts function/class/import definitions.

export interface Symbol {
  kind: "function" | "class" | "method" | "import" | "const" | "type" | "interface";
  name: string;
  line: number;
}

const PATTERNS: Array<{ kind: Symbol["kind"]; re: RegExp }> = [
  // Python
  { kind: "class", re: /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "function", re: /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "import", re: /^\s*(?:from\s+\S+\s+)?import\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  // TypeScript / JavaScript
  { kind: "class", re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/ },
  { kind: "interface", re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/ },
  { kind: "type", re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)/ },
  { kind: "function", re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/ },
  { kind: "const", re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/ },
  { kind: "method", re: /^\s*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/ },
  // Go
  { kind: "function", re: /^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: "type", re: /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)/ },
  // Rust
  { kind: "function", re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "type", re: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/ },
];

/** Extract a symbol outline from source text. Returns symbols in line order. */
export function outlineSymbols(source: string): Symbol[] {
  const out: Symbol[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, re } of PATTERNS) {
      const m = line.match(re);
      if (m) {
        out.push({ kind, name: m[1], line: i + 1 });
        break; // one symbol per line
      }
    }
  }
  return out;
}

/** Format a symbol outline for display / agent context. */
export function formatOutline(symbols: Symbol[]): string {
  if (!symbols.length) return "(no symbols)";
  return symbols.map((s) => `${s.line}: ${s.kind} ${s.name}`).join("\n");
}
