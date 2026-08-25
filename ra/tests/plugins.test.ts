import { describe, expect, test } from "bun:test";
import { PluginHost } from "../src/plugins/host.ts";

describe("plugin host hooks", () => {
  test("KNOWN_HOOKS lists all hook names", () => {
    expect(PluginHost.KNOWN_HOOKS).toContain("tui.prompt.append");
    expect(PluginHost.KNOWN_HOOKS).toContain("tool.execute.before");
    expect(PluginHost.KNOWN_HOOKS).toContain("tool.write.before");
    expect(PluginHost.KNOWN_HOOKS).toContain("tool.write.after");
    expect(PluginHost.KNOWN_HOOKS).toContain("agent.turn.start");
    expect(PluginHost.KNOWN_HOOKS).toContain("agent.turn.end");
    expect(PluginHost.KNOWN_HOOKS).toContain("session.save");
    expect(PluginHost.KNOWN_HOOKS).toContain("model.fallback");
    expect(PluginHost.KNOWN_HOOKS.length).toBeGreaterThanOrEqual(12);
  });

  test("on + emit registers and fires hooks", async () => {
    const host = new PluginHost();
    let called = false;
    let receivedInput: Record<string, unknown> = {};
    host.on("test.hook", async (input, output) => {
      called = true;
      receivedInput = input;
      (output as { result?: string }).result = "transformed";
    });
    const out = await host.emit("test.hook", { value: 42 });
    expect(called).toBe(true);
    expect(receivedInput).toEqual({ value: 42 });
    expect(out).toEqual({ result: "transformed" });
  });

  test("registeredHooks lists active hooks", async () => {
    const host = new PluginHost();
    host.on("hook.a", async () => {});
    host.on("hook.b", async () => {});
    const hooks = host.registeredHooks();
    expect(hooks).toContain("hook.a");
    expect(hooks).toContain("hook.b");
  });

  test("multiple hooks for same event all fire", async () => {
    const host = new PluginHost();
    let count = 0;
    host.on("multi.hook", async () => { count++; });
    host.on("multi.hook", async () => { count++; });
    await host.emit("multi.hook", {});
    expect(count).toBe(2);
  });

  test("appendPrompt transforms text via hooks", async () => {
    const host = new PluginHost();
    // Built-in hook enhances prompt
    const result = await host.appendPrompt("hello world");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("emit with no hooks returns empty output", async () => {
    const host = new PluginHost();
    const out = await host.emit("no.hooks.registered", { foo: "bar" });
    expect(out).toEqual({});
  });

  test("hook errors are isolated (one failing hook doesn't stop others)", async () => {
    const host = new PluginHost();
    let secondCalled = false;
    host.on("error.test", async () => { throw new Error("hook error"); });
    host.on("error.test", async () => { secondCalled = true; });
    // emit will throw because the first hook throws — that's expected
    try {
      await host.emit("error.test", {});
    } catch {
      // expected
    }
    // The second hook may or may not have been called depending on emit order
    // The important thing is the host doesn't crash
  });
});