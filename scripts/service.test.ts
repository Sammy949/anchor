import { test } from "node:test";
import assert from "node:assert/strict";
import { answerFraudQuery, InvalidWalletError, MissingInputError } from "../src/service.js";
import type { RiskCheckResponse } from "../src/types.js";

const ADDR = "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060";
const FIXED_MS = Date.UTC(2026, 7, 25, 12, 0, 0);

// A canned on-chain verdict, so routing is tested without touching the network.
const fakeRiskCheck = (wallet: string): Promise<RiskCheckResponse> =>
  Promise.resolve({
    wallet,
    protocol: "aave-v3",
    verdict: "RECHECK",
    reasoning: "fixture",
    signals: {
      riskLabel: "AT_RISK",
      healthFactor: 1.33,
      liquidationDistancePercent: 24.95,
      totalCollateralUSD: 55176.08,
      totalDebtUSD: 32301.3,
      liquidationThreshold: 0.78,
    },
    confidence: 0.97,
    meta: {
      blockNumber: 50127516,
      timestamp: "2026-08-25T00:00:00.000Z",
      source: "aave-v3-pool-contract",
      chainId: 8453,
      network: "base-mainnet",
    },
  });

test("wallet-shaped input routes to the on-chain path (LLM never called)", async () => {
  let llmCalled = false;
  const complete = async () => {
    llmCalled = true;
    return "should not run";
  };
  const r = await answerFraudQuery({ wallet: ADDR }, { riskCheck: fakeRiskCheck, complete }, FIXED_MS);
  assert.equal(llmCalled, false);
  assert.equal(r.wallet, ADDR);
  assert.equal(r.verdict, "RECHECK");
  assert.equal(r.meta.source, "aave-v3-pool-contract");
});

test("knowledge-shaped input routes to the LLM path (chain never read)", async () => {
  let chainRead = false;
  const riskCheck = () => {
    chainRead = true;
    return fakeRiskCheck(ADDR);
  };
  const complete = async () => "The Wirecard scandal was a 1.9bn EUR accounting fraud that collapsed in 2020.";
  const r = await answerFraudQuery(
    { query: "What characterized the Wirecard accounting fraud?" },
    { riskCheck, complete },
    FIXED_MS,
  );
  assert.equal(chainRead, false);
  assert.equal(r.verdict, "INFO");
  assert.equal(r.wallet, null);
  assert.match(r.reasoning, /Wirecard/);
  assert.equal(r.meta.source, "llm-fraud-knowledge");
});

test("an address embedded in a knowledge-style query still routes on-chain", async () => {
  const complete = async () => "unused";
  const r = await answerFraudQuery(
    { query: `Is ${ADDR.toLowerCase()} safe to transact with?` },
    { riskCheck: fakeRiskCheck, complete },
    FIXED_MS,
  );
  assert.equal(r.wallet, ADDR); // extracted + checksummed, on-chain path
  assert.equal(r.verdict, "RECHECK");
});

test("malformed wallet (no question) -> InvalidWalletError, neither path runs", async () => {
  let touched = false;
  const mark = () => {
    touched = true;
  };
  await assert.rejects(
    () =>
      answerFraudQuery(
        { wallet: "0xdeadbeef" },
        { riskCheck: () => (mark(), fakeRiskCheck(ADDR)), complete: async () => (mark(), "") },
        FIXED_MS,
      ),
    InvalidWalletError,
  );
  assert.equal(touched, false);
});

test("empty input -> MissingInputError", async () => {
  await assert.rejects(() => answerFraudQuery({}, {}, FIXED_MS), MissingInputError);
});
