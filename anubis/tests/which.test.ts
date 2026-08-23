import { describe, expect, test } from "bun:test";
import { formatRaWhich } from "../src/which.ts";

describe("formatRaWhich", () => {
  test("RA branding + small host tag", async () => {
    const s = await formatRaWhich({
      OLLAMA_LAN_URL: "http://127.0.0.1:1",
      OLLAMA_LOCAL_URL: "http://127.0.0.1:1",
    });
    // pickOllamaEndpoint always appends localhost:11434 as last resort
    expect(s.startsWith("RA which")).toBe(true);
    expect(s).toMatch(/small → @(251|local)|unreachable/);
    if (!s.includes("unreachable")) {
      expect(s).toMatch(/RA prefer small@(251|local)/);
    }
  });
});
