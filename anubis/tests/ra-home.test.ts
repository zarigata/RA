import { describe, expect, test } from "bun:test";
import { formatRaHome } from "../src/ra-home.ts";

// RFC 5737 TEST-NET-1 documentation address — never a real host.
const LAN_URL = "http://192.0.2.50:11434";

describe("formatRaHome", () => {
  test("RA branding + paths", () => {
    const s = formatRaHome({
      anubis: "/proj/anubis",
      global: "/Users/x/.ra",
      lastCwd: "/tmp/work",
      env: { OLLAMA_LAN_URL: LAN_URL },
    });
    expect(s.startsWith("RA home")).toBe(true);
    expect(s).toContain("anubis: /proj/anubis");
    expect(s).toContain("global: /Users/x/.ra");
    expect(s).toContain("last-cwd: /tmp/work");
    expect(s).toContain("RA prefer small@50");
  });
});
