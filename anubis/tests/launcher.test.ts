import { describe, expect, test } from "bun:test";
import { join, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("launcher configuration validation", () => {
  const configPath = join(__dirname, "..", "ra.json");
  const legacy = join(__dirname, "..", "anubis.json");
  const path = existsSync(configPath) ? configPath : legacy;
  const config = JSON.parse(readFileSync(path, "utf-8"));

  const requiredRoles = ["thoth", "ptah", "maat", "sekhmet"];
  requiredRoles.forEach((role) => {
    expect(config.agent).toHaveProperty(role);
    expect(config.agent[role]).toHaveProperty("model");
  });

  expect(config.moa.roles).toEqual(expect.arrayContaining(requiredRoles));
  expect(config.moa.parallel).toBe(true);
  expect(config.profile).toBe("mac-weak");
  expect(config.profiles).toHaveProperty("mac-weak");
});
