import { describe, expect, test } from "bun:test";
import { replayTimeline, replayUpTo, replayTranscript, findStep, loadReplay } from "../src/server/replay.ts";
import type { Session } from "../src/server/session.ts";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RA_GLOBAL } from "../../anubis/src/config.ts";

const session: Session = {
  id: "x",
  cwd: "/tmp/x",
  messages: [
    { role: "user", content: "hello", ts: 1 },
    { role: "assistant", content: "hi", ts: 2 },
    { role: "user", content: "write a function", ts: 3 },
    { role: "assistant", content: "done", ts: 4 },
  ],
  simpleMode: false,
  created: 0,
};

describe("session replay", () => {
  test("replayTimeline indexes messages", () => {
    const steps = replayTimeline(session);
    expect(steps.length).toBe(4);
    expect(steps[0].index).toBe(0);
    expect(steps[3].content).toBe("done");
  });

  test("replayUpTo slices the timeline", () => {
    const upTo = replayUpTo(session, 1);
    expect(upTo.length).toBe(2);
    expect(upTo[1].content).toBe("hi");
  });

  test("replayTranscript renders a transcript", () => {
    const t = replayTranscript(session, 1);
    expect(t).toContain("[user] hello");
    expect(t).toContain("[assistant] hi");
    expect(t).not.toContain("write a function");
  });

  test("findStep locates a decision point", () => {
    const idx = findStep(session, (m) => m.content === "write a function");
    expect(idx).toBe(2);
  });

  test("findStep returns -1 when not found", () => {
    const idx = findStep(session, (m) => m.content === "nonexistent");
    expect(idx).toBe(-1);
  });

  test("loadReplay reads session from disk", () => {
    const dir = join(RA_GLOBAL, "sessions");
    mkdirSync(dir, { recursive: true });
    const cwd = `/tmp/ra-replay-test-${Date.now()}`;
    const slug = cwd.replace(/\//g, "_").replace(/^_|_$/g, "");
    const file = join(dir, `${slug}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        id: cwd,
        cwd,
        messages: [
          { role: "user", content: "test message", ts: 1 },
        ],
        simpleMode: false,
        created: Date.now(),
      }),
    );
    try {
      const steps = loadReplay(cwd);
      expect(steps.length).toBe(1);
      expect(steps[0].content).toBe("test message");
    } finally {
      rmSync(file, { force: true });
    }
  });

  test("replayTranscript with no index renders all messages", () => {
    const t = replayTranscript(session);
    expect(t).toContain("[user] hello");
    expect(t).toContain("[assistant] done");
  });
});
