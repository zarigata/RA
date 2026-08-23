import { describe, expect, test } from "bun:test";
import { getLanguagePack, listLanguagePacks, translate } from "../src/languages.ts";

describe("languages", () => {
  test("lists all language packs", () => {
    const packs = listLanguagePacks();
    expect(packs.length).toBeGreaterThan(20);
  });
  test("default english pack", () => {
    const pack = getLanguagePack("en");
    expect(pack.code).toBe("en");
    expect(pack.messages.welcome).toBe("Anubis — Mixture-of-Agents terminal agent");
  });
  test("translates keys", () => {
    expect(translate("pt", "welcome")).toBe("Anubis — Agente terminal de Mistura de Agentes");
    expect(translate("nonexistent", "welcome")).toBe("Anubis — Mixture-of-Agents terminal agent");
  });
});
