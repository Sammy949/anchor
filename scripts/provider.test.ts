import { test } from "node:test";
import assert from "node:assert/strict";
import type { JsonRpcProvider } from "ethers";
import { AllRpcsFailedError, withRpcFallback, withTimeout } from "../src/provider.js";

// Fake "providers" are tagged sentinels; the injected op decides how each
// behaves. This exercises the fallback runner without any network.
const fakeProviders = (...tags: string[]): JsonRpcProvider[] =>
  tags as unknown as JsonRpcProvider[];
const tagOf = (p: JsonRpcProvider): string => p as unknown as string;

// Silence the intentional fallback warn() during these tests.
const quiet = <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.warn;
  console.warn = () => {};
  return fn().finally(() => {
    console.warn = original;
  });
};

test("uses the primary endpoint when it succeeds (fallback never touched)", async () => {
  const seen: string[] = [];
  const r = await withRpcFallback(
    async (p) => {
      seen.push(tagOf(p));
      return `ok:${tagOf(p)}`;
    },
    fakeProviders("primary", "fallback"),
    1000,
  );
  assert.equal(r, "ok:primary");
  assert.deepEqual(seen, ["primary"]); // fallback provider never invoked
});

test("falls back to the next endpoint when the primary throws", async () => {
  const seen: string[] = [];
  const r = await quiet(() =>
    withRpcFallback(
      async (p) => {
        seen.push(tagOf(p));
        if (tagOf(p) === "primary") throw new Error("boom");
        return `ok:${tagOf(p)}`;
      },
      fakeProviders("primary", "fallback"),
      1000,
    ),
  );
  assert.equal(r, "ok:fallback");
  assert.deepEqual(seen, ["primary", "fallback"]); // primary tried, then fallback
});

test("falls back when the primary exceeds the timeout", async () => {
  const seen: string[] = [];
  const r = await quiet(() =>
    withRpcFallback(
      async (p) => {
        seen.push(tagOf(p));
        if (tagOf(p) === "primary") return new Promise<string>(() => {}); // never resolves
        return `ok:${tagOf(p)}`;
      },
      fakeProviders("primary", "fallback"),
      40, // short timeout so the hung primary trips it fast
    ),
  );
  assert.equal(r, "ok:fallback");
  assert.deepEqual(seen, ["primary", "fallback"]);
});

test("throws AllRpcsFailedError (with each reason) when every endpoint fails", async () => {
  await quiet(() =>
    assert.rejects(
      () =>
        withRpcFallback(
          async (p) => {
            throw new Error(`down:${tagOf(p)}`);
          },
          fakeProviders("primary", "fallback"),
          100,
        ),
      (err: unknown) => {
        assert.ok(err instanceof AllRpcsFailedError);
        assert.match(err.message, /down:primary/);
        assert.match(err.message, /down:fallback/);
        return true;
      },
    ),
  );
});

test("throws AllRpcsFailedError when no endpoints are configured", async () => {
  await assert.rejects(
    () => withRpcFallback(async () => "unused", fakeProviders(), 100),
    AllRpcsFailedError,
  );
});

test("withTimeout rejects a hung promise with a labelled timeout error", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 30, "unit"),
    /timed out after 30ms \(unit\)/,
  );
});

test("withTimeout passes a value through when it settles in time", async () => {
  const v = await withTimeout(Promise.resolve(42), 1000, "unit");
  assert.equal(v, 42);
});
