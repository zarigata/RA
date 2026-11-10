import { describe, expect, test } from "bun:test";
import { stardate } from "../src/version.ts";

// Expected values derived from the formula: (year−2000)·1000 + dayOfYear/365.25·1000, 1 decimal.
describe("stardate", () => {
  test("year start — 2026-01-01 is day 1", () => {
    expect(stardate(new Date("2026-01-01T00:00:00Z"))).toBe("26002.7");
  });

  test("mid-year — 2026-07-02 is day 183", () => {
    expect(stardate(new Date("2026-07-02T12:00:00Z"))).toBe("26501.0");
  });

  test("leap day — 2024-02-29 is day 60", () => {
    expect(stardate(new Date("2024-02-29T00:00:00Z"))).toBe("24164.3");
  });
});
