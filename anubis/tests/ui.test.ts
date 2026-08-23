import { describe, expect, test } from "bun:test";
import { DEFAULT_UI_CONFIG, formatBox, getPalette, listPalettes } from "../src/ui.ts";

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
