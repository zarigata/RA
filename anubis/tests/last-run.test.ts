import { describe, expect, test } from "bun:test";
import { formatResultLine, formatLastRun, type LastRun } from "../src/last-run.ts";

describe("last-run formatting", () => {
  test("formatResultLine is bash-greppable", () => {
    const run: LastRun = {
      task: "hello",
      stages: ["thoth", "ptah"],
      models: ["qwen3.8:latest", "glm-5.2"],
      filesWritten: ["/tmp/hello.py"],
      ms: 12345,
      hosts: ["251", "cloud"],
      intent: "code",
      at: 1,
    };
    const line = formatResultLine(run);
    expect(line.startsWith("RA RESULT")).toBe(true);
    expect(line).toContain("thoth→ptah");
    expect(line).toContain("qwen3.8:latest");
    expect(line).toContain("glm-5.2");
    expect(line).toContain("hello.py");
    expect(line).toContain("ms=12345");
    expect(line).toContain("hosts=251,cloud");
    expect(line).toContain("intent=code");
  });

  test("formatResultLine includes cwd", () => {
    const run: LastRun = {
      task: "hello",
      stages: ["thoth", "ptah"],
      models: ["qwen3.8:latest"],
      filesWritten: ["/tmp/w/hello.py"],
      cwd: "/tmp/w",
      at: 1,
    };
    expect(formatResultLine(run)).toContain("cwd=/tmp/w");
  });

  test("formatLastRun empty", () => {
    expect(formatLastRun(null)).toContain("No previous");
  });

  test("formatShow missing run", async () => {
    const { formatShow } = await import("../src/last-run.ts");
    expect(formatShow(null)).toContain("RA show");
    expect(formatShow(null)).toContain("no files");
  });

  test("formatRaFiles lists artifacts + lane", async () => {
    const { formatRaFiles } = await import("../src/last-run.ts");
    expect(formatRaFiles(null)).toContain("RA files");
    const s = formatRaFiles({
      task: "hello",
      stages: ["thoth", "ptah"],
      models: ["qwen3.8:latest", "glm-5.2"],
      filesWritten: ["/tmp/hello.py"],
      hosts: ["251", "cloud"],
      intent: "code",
      timings: [
        { stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 1 },
        { stage: "ptah", model: "glm-5.2", host: "cloud", ms: 1 },
      ],
      at: 1,
    });
    expect(s.startsWith("RA files")).toBe(true);
    expect(s).toContain("hello.py");
    expect(s).toContain("RA lane thoth@251");
    expect(s).toContain("RA prefer small@251");
  });

  test("formatTimings is greppable", async () => {
    const { formatTimings } = await import("../src/last-run.ts");
    const s = formatTimings([
      { stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 5200 },
      { stage: "ptah", model: "glm-5.2", host: "cloud", ms: 1300 },
    ]);
    expect(s).toContain("thoth@251=5.2s");
    expect(s).toContain("ptah@cloud=1.3s");
  });

  test("formatRaSummary after full-dev", async () => {
    const { formatRaSummary } = await import("../src/last-run.ts");
    expect(formatRaSummary(null)).toContain("RA summary");
    const s = formatRaSummary({
      task: "hello",
      stages: ["thoth", "ptah"],
      models: ["qwen3.8:latest", "glm-5.2"],
      filesWritten: ["/tmp/hello.py"],
      hosts: ["251", "cloud"],
      timings: [
        { stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 5000 },
        { stage: "ptah", model: "glm-5.2", host: "cloud", ms: 1000 },
      ],
      at: 1,
    });
    expect(s.startsWith("RA summary")).toBe(true);
    expect(s).toContain("RA RESULT");
    expect(s).toContain("thoth@251");
    expect(s).toContain("ptah@cloud");
    expect(s).toContain("RA lane thoth@251 → ptah@cloud");
    expect(s).toContain("again: ra again --quick --verify");
    expect(s).toContain("RA prefer small@251");
  });

  test("formatIntentLine is bash-greppable", async () => {
    const { formatIntentLine } = await import("../src/last-run.ts");
    expect(formatIntentLine(null)).toContain("no full-dev");
    expect(
      formatIntentLine({
        task: "fix buggy hello",
        stages: ["thoth", "ptah"],
        models: ["qwen3.8:latest"],
        filesWritten: ["/tmp/hello.py"],
        intent: "debug",
        at: 1,
      }),
    ).toBe("RA intent debug");
  });

  test("formatPreferLine from timings", async () => {
    const { formatPreferLine } = await import("../src/last-run.ts");
    expect(formatPreferLine(null)).toBe("RA prefer small@251 → big@cloud");
    expect(
      formatPreferLine({
        task: "hello",
        stages: ["thoth", "ptah"],
        models: ["qwen3.8:latest", "glm-5.2"],
        filesWritten: ["/tmp/hello.py"],
        hosts: ["251", "cloud"],
        timings: [
          { stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 1 },
          { stage: "ptah", model: "glm-5.2", host: "cloud", ms: 1 },
        ],
        at: 1,
      }),
    ).toBe("RA prefer small@251 → big@cloud");
  });
});
