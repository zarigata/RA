import { describe, expect, test } from "bun:test";
import { formatLanes } from "../src/lanes.ts";

// RFC 5737 TEST-NET-1 documentation address — never a real host.
const LAN_URL = "http://192.0.2.50:11434";

describe("RA lanes", () => {
  test("shows RA branding and LAN / cloud / local fallback", () => {
    const s = formatLanes(
      { model: "ollama-cloud/glm-5.2", small_model: "ollama-lan/qwen3.8:latest" },
      {
        OLLAMA_LAN_URL: LAN_URL,
        OLLAMA_LOCAL_URL: "http://localhost:11434",
      },
    );
    expect(s.startsWith("RA lanes")).toBe(true);
    expect(s).toContain("qwen3.8:latest");
    expect(s).toContain(LAN_URL);
    expect(s).toContain("@50");
    expect(s).toContain("@local");
    expect(s).toContain("glm-5.2");
    expect(s).toContain("@cloud");
  });

  test("tag falls back to local when LAN URL is localhost", () => {
    const s = formatLanes(
      { model: "ollama-cloud/glm-5.2", small_model: "ollama-lan/qwen3.8:latest" },
      { OLLAMA_LAN_URL: "http://localhost:11434" },
    );
    expect(s).toContain("small@local → big@cloud");
  });
});
