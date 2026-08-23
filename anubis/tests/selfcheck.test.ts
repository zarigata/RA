import { describe, expect, test } from "bun:test";
import { formatSelfcheck } from "../src/selfcheck.ts";

describe("formatSelfcheck", () => {
  test("returns RA branding even when endpoints are down", async () => {
    const { ok, text } = await formatSelfcheck(
      { model: "ollama-cloud/glm-5.2", small_model: "ollama-lan/qwen3.8:latest" },
      {
        OLLAMA_LAN_URL: "http://127.0.0.1:1",
        OLLAMA_LOCAL_URL: "http://127.0.0.1:1",
      },
    );
    expect(ok).toBe(false);
    expect(text).toContain("RA TUI");
    expect(text).toContain("RA ping");
    expect(text).toContain("RA lanes");
    expect(text).toContain("RA models");
    expect(text).toContain("RA which");
    expect(text).toContain("RA selfcheck FAIL");
  });
});
