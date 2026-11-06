import { describe, expect, test } from "bun:test";
import { APP_NAME, renderSplash, renderTaskComplete, renderStageProgress, hostTag, preferLine } from "../src/tui.ts";

// RFC 5737 TEST-NET-1 documentation address — never a real host.
const LAN_URL = "http://192.0.2.50:11434";

describe("RA TUI branding", () => {
  test("APP_NAME is RA", () => {
    expect(APP_NAME).toBe("RA");
  });

  test("splash shows RA", () => {
    const splash = renderSplash();
    expect(splash).toContain("RA");
    expect(splash).toContain("TUI");
  });

  test("splash shows prefer policy", () => {
    expect(renderSplash()).toContain("RA prefer small@");
  });

  test("splash accepts theme override", () => {
    const splash = renderSplash("pharaonic");
    expect(splash).toContain("theme: Pharaonic");
  });

  test("splash shows version", async () => {
    const { RA_VERSION } = await import("../src/version.ts");
    expect(renderSplash()).toContain(RA_VERSION);
  });

  test("task complete banner shows RA", () => {
    const done = renderTaskComplete("fix bug", ["thoth", "ptah"], "summary");
    expect(done).toContain("RA");
    expect(done).toContain("dev cycle complete");
  });

  test("task complete embeds lane/prefer/intent", () => {
    const done = renderTaskComplete("write hello", ["thoth", "ptah"], "ok", {
      lane: "RA lane thoth@50 → ptah@cloud",
      intent: "RA intent code",
      prefer: "RA prefer small@50 → big@cloud",
      elapsed: "elapsed: 6.2s",
      files: "files: 1",
    });
    expect(done).toContain("RA ✓ done");
    expect(done).toContain("RA lane thoth@50");
    expect(done).toContain("RA intent code");
    expect(done).toContain("RA prefer small@50");
    expect(done).toContain("elapsed: 6.2s");
    expect(done).toContain("files: 1");
  });

  test("stage progress tags small/LAN vs BIG/cloud", () => {
    expect(renderStageProgress("thoth", "qwen3.8:latest", "plan")).toContain("small/LAN");
    expect(renderStageProgress("ptah", "glm-5.2", "code")).toContain("BIG/cloud");
    expect(renderStageProgress("maat", "gemma:latest", "ok")).toContain("small/LAN");
  });

  test("stage progress includes host @LAN / @cloud", () => {
    expect(renderStageProgress("thoth", "qwen3.8:latest", "plan", { host: "50" })).toContain("@50");
    expect(renderStageProgress("ptah", "glm-5.2", "code", { host: "cloud" })).toContain("@cloud");
  });

  test("stage progress includes took ms", () => {
    expect(renderStageProgress("thoth", "qwen3.8:latest", "plan", { host: "50", ms: 42 })).toContain("took 42ms");
  });

  test("hostTag maps URLs to last octet / local / cloud", () => {
    expect(hostTag(LAN_URL + "/v1", "local")).toBe("50");
    expect(hostTag("http://localhost:11434/v1", "local")).toBe("local");
    expect(hostTag("http://127.0.0.1:11434", "local")).toBe("local");
    expect(hostTag("https://ollama.com/v1", "cloud")).toBe("cloud");
    expect(hostTag("http://myserver:11434", "local")).toBe("myserver");
  });

  test("preferLine derives the host tag from OLLAMA_LAN_URL", () => {
    expect(preferLine({ OLLAMA_LAN_URL: LAN_URL })).toContain("RA prefer small@50 → big@cloud");
    expect(preferLine({ OLLAMA_LAN_URL: "http://localhost:11434" })).toContain("small@local");
  });
});
