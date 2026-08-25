import { test } from "node:test";
import assert from "node:assert/strict";
import { getKnowledgeAnswer, shapeKnowledgeResponse, stripReasoning } from "../src/knowledge.js";

const FIXED_MS = Date.UTC(2026, 7, 25, 12, 0, 0); // 2026-08-25T12:00:00Z

test("shapeKnowledgeResponse reuses the registered field names with knowledge values", () => {
  const r = shapeKnowledgeResponse("BitConnect was a lending Ponzi that collapsed in Jan 2018.", FIXED_MS);
  // Same top-level keys as RiskCheckResponse, so the registered output schema stays valid.
  assert.deepEqual(
    Object.keys(r).sort(),
    ["confidence", "meta", "protocol", "reasoning", "signals", "verdict", "wallet"].sort(),
  );
  assert.equal(r.verdict, "INFO");
  assert.match(r.reasoning, /BitConnect/);
  assert.equal(r.wallet, null);
  assert.equal(r.protocol, null);
  assert.equal(r.signals, null);
  assert.equal(r.confidence, 0.8);
});

test("shapeKnowledgeResponse meta: no block, has source + model + wall-clock timestamp", () => {
  const r = shapeKnowledgeResponse("answer", FIXED_MS);
  assert.equal(r.meta.blockNumber, null);
  assert.equal(r.meta.source, "llm-fraud-knowledge");
  assert.equal(r.meta.timestamp, "2026-08-25T12:00:00.000Z");
  assert.ok(r.meta.model.length > 0);
});

test("shapeKnowledgeResponse trims the LLM answer", () => {
  const r = shapeKnowledgeResponse("  \n  trimmed answer  \n", FIXED_MS);
  assert.equal(r.reasoning, "trimmed answer");
});

test("getKnowledgeAnswer routes the question through the injected completer", async () => {
  let seen = "";
  const complete = async (q: string) => {
    seen = q;
    return "OneCoin was a fraudulent cryptocurrency run by Ruja Ignatova.";
  };
  const r = await getKnowledgeAnswer("What characterized OneCoin?", complete, FIXED_MS);
  assert.equal(seen, "What characterized OneCoin?"); // question passed through verbatim
  assert.equal(r.verdict, "INFO");
  assert.match(r.reasoning, /OneCoin/);
});

test("getKnowledgeAnswer propagates a completer failure (mapped to HTTP upstream)", async () => {
  const complete = async () => {
    throw new Error("LLM down");
  };
  await assert.rejects(() => getKnowledgeAnswer("q", complete, FIXED_MS), /LLM down/);
});

test("stripReasoning removes a <think> block but keeps the answer", () => {
  assert.equal(
    stripReasoning("<think>let me recall the facts...</think>\nBitConnect was a Ponzi scheme."),
    "BitConnect was a Ponzi scheme.",
  );
  // No think block: unchanged (just trimmed).
  assert.equal(stripReasoning("  A clean answer.  "), "A clean answer.");
});
