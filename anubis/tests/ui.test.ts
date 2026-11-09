import { describe, expect, test } from "bun:test";
import { DEFAULT_UI_CONFIG, formatBox, getPalette, listPalettes, statusColor, type StatusKind } from "../src/ui.ts";

describe("ui customization", () => {
  test("lists color palettes", () => {
    expect(listPalettes().length).toBeGreaterThanOrEqual(10);
  });

  test("gets palette by name", () => {
    const palette = getPalette("nord");
    expect(palette.name).toBe("Nord");
    expect(palette.background).toBe("#2e3440");
  });

  test("falls back to default palette", () => {
    expect(getPalette("missing").name).toBe("Pharaonic");
  });

  test("formats box with rounded border by default", () => {
    const box = formatBox("Title", "Line 1\nLine 2");
    expect(box).toContain("Title");
    expect(box).toContain("Line 1");
    expect(box).toContain("╭");
  });

  test("default ui config matches theme defaults", () => {
    expect(DEFAULT_UI_CONFIG.palette).toBe("pharaonic");
    expect(DEFAULT_UI_CONFIG.borderStyle).toBe("rounded");
  });
});

describe("status kind → palette colour mapping", () => {
  const p = getPalette("pharaonic");
  test("every StatusKind maps to its palette colour", () => {
    const map: Record<StatusKind, string> = {
      ok: p.success,
      warn: p.warning,
      error: p.error,
      busy: p.accent,
      info: p.muted,
    };
    for (const k of Object.keys(map) as StatusKind[]) {
      expect(statusColor(p, k)).toBe(map[k]);
    }
  });
  test("same meaning = same colour across palettes", () => {
    const nord = getPalette("nord");
    expect(statusColor(nord, "ok")).toBe(nord.success);
    expect(statusColor(nord, "error")).not.toBe(statusColor(nord, "ok"));
  });
});
