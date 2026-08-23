import { describe, expect, test } from "bun:test";
import { formatHistory } from "../src/history.ts";
import type { LastRun } from "../src/last-run.ts";

describe("history formatting", () => {
  test("empty", () => {
    expect(formatHistory([])).toContain("No RA full-dev history");
  });

  test("lists recent runs", () => {
    const runs: LastRun[] = [
      {
        task: "write hello",
        stages: ["thoth", "ptah"],
        models: ["qwen3.8:latest", "glm-5.2"],
        filesWritten: ["/tmp/hello.py"],
        hosts: ["251", "cloud"],
        intent: "code",
        ms: 5000,
        timings: [
          { stage: "thoth", model: "qwen3.8:latest", host: "251", ms: 4000 },
          { stage: "ptah", model: "glm-5.2", host: "cloud", ms: 1000 },
        ],
        at: Date.now(),
      },
    ];
    const text = formatHistory(runs);
    expect(text).toContain("hello.py");
    expect(text).toContain("251");
    expect(text).toContain("thoth→ptah");
    expect(text).toContain("{code}");
    expect(text).toContain("thoth@251");
    expect(text).toContain("RA lane thoth@251");
    expect(text).toContain("RA prefer small@251");
  });
});
