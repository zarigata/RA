import { describe, expect, test } from "bun:test";
import { formatRaStatus } from "../src/ra-status.ts";

describe("formatRaStatus", () => {
  test("RA branding + small model lane", () => {
    const s = formatRaStatus({
      cwd: "/tmp/w",
      profile: "mac-weak",
      model: "ollama-cloud/glm-5.2",
      small: "ollama-lan/qwen3.8:latest",
      last: {
        task: "hello",
        stages: ["thoth", "ptah"],
        models: ["qwen3.8:latest", "glm-5.2"],
        filesWritten: ["/tmp/hello.py"],
        hosts: ["251", "cloud"],
        timings: [
          { stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 1000 },
          { stage: "ptah", model: "glm-5.2", host: "cloud", ms: 500 },
        ],
        at: 1,
      },
      usage: "No usage recorded.",
    });
    expect(s.startsWith("RA status")).toBe(true);
    expect(s).toContain("qwen3.8");
    expect(s).toContain("glm-5.2");
    expect(s).toContain("cwd: /tmp/w");
    expect(s).toContain("RA lane thoth@251 → ptah@cloud");
  });
});
