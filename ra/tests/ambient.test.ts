import { describe, expect, test } from "bun:test";
import { ambientScene, dayPhase } from "../src/tui/ambient.ts";

describe("ambient terminal scene", () => {
  test("changes with the local hour", () => {
    expect(dayPhase(new Date(2026, 0, 1, 6))).toBe("dawn");
    expect(dayPhase(new Date(2026, 0, 1, 12))).toBe("day");
    expect(dayPhase(new Date(2026, 0, 1, 18))).toBe("sunset");
    expect(dayPhase(new Date(2026, 0, 1, 23))).toBe("night");
  });
  test("animates gently and fits narrow terminals", () => {
    const d = new Date(2026, 0, 1, 23);
    expect(ambientScene(d, 0, 48)).not.toBe(ambientScene(d, 4, 48));
    expect(ambientScene(d, 0, 20).length).toBeLessThanOrEqual(20);
  });
});
