import { describe, expect, test } from "bun:test";
import { HELLO_PY_STUB, ensureHelloPyBody } from "../src/hello-py.ts";

describe("ensureHelloPyBody", () => {
  test("stub is runnable shape", () => {
    expect(HELLO_PY_STUB).toContain("print");
    expect(HELLO_PY_STUB).toContain("__main__");
  });

  test("adds __main__ to def-only print", () => {
    const out = ensureHelloPyBody('def hello():\n    print("Hello, World!")\n');
    expect(out).toContain("__main__");
    expect(out).toContain("hello()");
  });

  test("replaces recursive body", () => {
    expect(ensureHelloPyBody("def hello():\n    hello()\n")).toBe(HELLO_PY_STUB);
  });
});
