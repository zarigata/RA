// i18n-interp.test.ts — Wave 3a edge sweep on t() interpolation: missing
// args, extra args, unicode args, numeric args, placeholder edge shapes.
// Wave 1 covered order + passthrough; this pins the degenerate inputs.

import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { setLocale, t, normalizeLocale } from "../src/i18n.ts";

beforeEach(() => setLocale("en"));
afterAll(() => setLocale("en")); // shared-process hygiene (see i18n.test.ts)

describe("t() interpolation edge cases", () => {
  test("missing args leave the placeholder verbatim", () => {
    expect(t("{0} and {1}")).toBe("{0} and {1}");
    expect(t("{0} of {1}", "only-first")).toBe("only-first of {1}");
    expect(t("{9}")).toBe("{9}");
  });

  test("extra args beyond the highest placeholder are ignored", () => {
    expect(t("no placeholders", "a", "b", "c")).toBe("no placeholders");
    expect(t("{0}", "x", "y", "z")).toBe("x");
  });

  test("unicode args (emoji, CJK, RTL, combining) interpolate intact", () => {
    expect(t("dir: {0}", "プロジェクト📁")).toBe("dir: プロジェクト📁");
    expect(t("{0} → {1}", "مرحبا", "שלום")).toBe("مرحبا → שלום");
    expect(t("café {0}", "naïve café")).toBe("café naïve café");
    expect(t("{0}{1}", "👨‍👩‍👧‍👦", "👍🏻")).toContain("👨‍👩‍👧‍👦👍🏻"); // ZWJ family + skin tone survive
  });

  test("numeric args stringify (int, float, zero, negative)", () => {
    expect(t("{0}", 0)).toBe("0");
    expect(t("{0}", -42)).toBe("-42");
    expect(t("{0}", 3.14)).toBe("3.14");
    expect(t("{0}/{1}", 1e6, Number.MAX_SAFE_INTEGER)).toBe("1000000/9007199254740991");
  });

  test("placeholder shapes: only literal {digits} substitute", () => {
    expect(t("{ }", "x")).toBe("{ }"); // space inside — not a placeholder
    expect(t("{}", "x")).toBe("{}"); // empty — not a placeholder
    expect(t("{ 0 }", "x")).toBe("{ 0 }");
    expect(t("{-1}", "x")).toBe("{-1}");
    expect(t("{{0}}", "x")).toBe("{x}"); // inner substitutes, outer braces stay
    expect(t("a {0} b {0} c", "X")).toBe("a X b X c"); // repeats all fill
  });

  test("an arg CONTAINING a placeholder-like token does not re-substitute", () => {
    expect(t("{0}", "{1}")).toBe("{1}"); // single pass, no recursion
    expect(t("{0}", "{0}")).toBe("{0}");
  });

  test("empty string args substitute to empty", () => {
    expect(t("[{0}]", "")).toBe("[]");
  });

  test("in a translated locale the same edges hold (pt-BR real key)", () => {
    setLocale("pt-BR");
    // missing args: placeholders stay visible for diagnosis
    expect(t("Bem-vindo ao {0}.")).toBe("Bem-vindo ao {0}.");
    // unicode arg flows through the translation
    expect(t("Bem-vindo ao {0}.", "RA📁")).toContain("RA📁");
  });
});

describe("normalizeLocale long-tail inputs", () => {
  test("separator splitting handles every RFC-4646-ish shape", () => {
    // normalize splits on [._@-] and reads the first chunk:
    expect(normalizeLocale("pt-BR.UTF-8@euro")).toBe("pt-BR");
    expect(normalizeLocale("JA_jp.eucJP")).toBe("ja");
    expect(normalizeLocale("de-CH,de;q=0.9")).toBe("de"); // q-weights → first chunk 'de'
    expect(normalizeLocale("  pl  ")).toBe("pl");
    expect(normalizeLocale("pl-PL-latin")).toBe("pl");
    expect(normalizeLocale("-x-priv")).toBe("en"); // leading separator → empty chunk → en
    expect(normalizeLocale("123")).toBe("en");
    expect(normalizeLocale("PORTUGUESE")).toBe("en"); // full names aren't codes
  });
});
