import { describe, expect, test } from "bun:test";
import { formatRaHome } from "../src/ra-home.ts";

describe("formatRaHome", () => {
  test("RA branding + paths", () => {
    const s = formatRaHome({
      anubis: "/proj/anubis",
      global: "/Users/x/.ra",
      lastCwd: "/tmp/work",
    });
    expect(s.startsWith("RA home")).toBe(true);
    expect(s).toContain("anubis: /proj/anubis");
    expect(s).toContain("global: /Users/x/.ra");
    expect(s).toContain("last-cwd: /tmp/work");
    expect(s).toContain("RA prefer small@251");
  });
});
