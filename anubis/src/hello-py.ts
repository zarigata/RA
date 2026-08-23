/** Canonical runnable hello.py — used by extract + ensure + tests */

export const HELLO_PY_STUB =
  `def hello():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    hello()\n`;

/** Ensure a hello.py body prints and is runnable as a script */
export function ensureHelloPyBody(body: string): string {
  let out = body;
  if (!/\bprint\s*\(|\breturn\b/.test(out)) return HELLO_PY_STUB;
  if (/\bdef\s+hello\b/.test(out) && !/__name__\s*==\s*['"]__main__['"]/.test(out)) {
    out = out.trimEnd() + `\n\nif __name__ == "__main__":\n    hello()\n`;
  }
  return out;
}
