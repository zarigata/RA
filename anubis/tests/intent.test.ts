import { describe, expect, test } from "bun:test";
import {
  detectIntent,
  enhancePrompt,
  isAmbiguousCode,
  ENHANCEMENTS,
} from "../src/intent.ts";

describe("horus intent detection", () => {
  test("detects code intent", () => {
    expect(detectIntent("implement a fibonacci function")).toBe("code");
    expect(detectIntent("write a server")).toBe("code");
    expect(detectIntent("build a cli tool")).toBe("code");
  });
  test("detects plan intent", () => {
    expect(detectIntent("plan the architecture")).toBe("plan");
    expect(detectIntent("design the database schema")).toBe("plan");
  });
  test("detects review intent", () => {
    expect(detectIntent("review the last change")).toBe("review");
    expect(detectIntent("audit the code")).toBe("review");
  });
  test("detects debug intent", () => {
    expect(detectIntent("debug the crash")).toBe("debug");
    expect(detectIntent("there is an error in auth")).toBe("debug");
    expect(detectIntent("Fix buggy hello.py so it prints Hello World")).toBe("debug");
    expect(detectIntent("fix the recursion bug")).toBe("debug");
  });
  test("detects docs intent", () => {
    expect(detectIntent("document the API")).toBe("docs");
    expect(detectIntent("write a readme")).toBe("docs");
  });
  test("detects question intent", () => {
    expect(detectIntent("what is a monad")).toBe("question");
    expect(detectIntent("how does this work")).toBe("question");
  });
  test("empty input is unknown", () => {
    expect(detectIntent("")).toBe("unknown");
    expect(detectIntent("   ")).toBe("unknown");
  });
  test("code wins over question when both present", () => {
    expect(detectIntent("how do I implement this")).toBe("code");
  });
});

describe("horus enhancement", () => {
  test("enhances code prompt", () => {
    const out = enhancePrompt("implement fibonacci");
    expect(out).toContain("fibonacci");
    expect(out).toContain("acceptance criteria");
  });
  test("preserves original text", () => {
    const out = enhancePrompt("plan the migration");
    expect(out.startsWith("plan the migration")).toBe(true);
  });
  test("each intent has enhancement text", () => {
    const intents = ["code", "plan", "review", "debug", "docs", "question", "unknown"] as const;
    for (const i of intents) {
      expect(ENHANCEMENTS[i].length).toBeGreaterThan(0);
    }
  });
});

describe("horus ambiguity", () => {
  test("ambiguous: code task without language", () => {
    expect(isAmbiguousCode("implement a sorting algorithm")).toBe(true);
  });
  test("not ambiguous: code task with language", () => {
    expect(isAmbiguousCode("implement a sorting algorithm in python")).toBe(false);
    expect(isAmbiguousCode("write a rust function")).toBe(false);
  });
  test("not ambiguous: non-code", () => {
    expect(isAmbiguousCode("what time is it")).toBe(false);
  });
});
