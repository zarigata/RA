import { describe, expect, test } from "bun:test";
import { loadRaConfig, ensureRaDirs } from "../src/config.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("ra config", () => {
  test("loads ra.json with mac-weak profile", () => {
    const cfg = loadRaConfig(root);
    expect(cfg.profile).toBe("mac-weak");
    expect(cfg.profiles?.["mac-weak"]).toBeDefined();
  });

  test("ensureRaDirs creates global dirs", () => {
    expect(() => ensureRaDirs()).not.toThrow();
  });
});
