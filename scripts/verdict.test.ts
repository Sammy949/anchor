import { test } from "node:test";
import assert from "node:assert/strict";
import { reasoningFor, toRiskCheck, verdictFor } from "../src/verdict.js";
import type { HealthFactorResponse, RiskLabel } from "../src/types.js";

// Build a HealthFactorResponse fixture. Defaults describe an active borrower;
// override riskLabel/status/healthFactor per case.
const signal = (over: Partial<HealthFactorResponse>): HealthFactorResponse => ({
  wallet: "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060",
  protocol: "aave-v3",
  status: "active",
  riskLabel: "AT_RISK",
  healthFactor: 1.33,
  totalCollateralUSD: 55176.08,
  totalDebtUSD: 32301.3,
  liquidationThreshold: 0.78,
  liquidationDistance: {
    collateralDropPercentToLiquidation: 24.95,
    description: "…",
  },
  confidence: 0.97,
  meta: {
    blockNumber: 50127516,
    timestamp: "2026-08-18T09:12:59.000Z",
    source: "aave-v3-pool-contract",
    chainId: 8453,
    network: "base-mainnet",
  },
  ...over,
});

const active = (riskLabel: RiskLabel, healthFactor: number): HealthFactorResponse =>
  signal({ status: "active", riskLabel, healthFactor });

test("verdictFor maps each risk band", () => {
  assert.equal(verdictFor(active("SAFE", 2.5)), "ALLOW");
  assert.equal(verdictFor(active("MODERATE", 1.7)), "ALLOW");
  assert.equal(verdictFor(active("AT_RISK", 1.33)), "RECHECK");
  assert.equal(verdictFor(active("CRITICAL", 1.05)), "BLOCK");
  assert.equal(verdictFor(active("LIQUIDATABLE", 0.9)), "BLOCK");
});

test("verdictFor: no debt / no position is ALLOW", () => {
  assert.equal(verdictFor(signal({ status: "no_debt", riskLabel: "NONE", healthFactor: null })), "ALLOW");
  assert.equal(verdictFor(signal({ status: "no_position", riskLabel: "NONE", healthFactor: null })), "ALLOW");
});

test("reasoning names the defect and next step for RECHECK", () => {
  const r = reasoningFor(active("AT_RISK", 1.33));
  assert.match(r, /24\.95%/); // the actual liquidation distance
  assert.match(r, /health factor 1\.33/);
  assert.match(r, /re-verify solvency|added margin/i); // the next step
});

test("reasoning for BLOCK bands signals imminent default", () => {
  assert.match(reasoningFor(active("CRITICAL", 1.05)), /imminent default|do not extend credit/i);
  assert.match(reasoningFor(active("LIQUIDATABLE", 0.9)), /insolvent|at or past the liquidation threshold/i);
});

test("reasoning distinguishes no_position from no_debt", () => {
  const noPos = reasoningFor(signal({ status: "no_position", riskLabel: "NONE", healthFactor: null }));
  assert.match(noPos, /no leverage|no Aave v3 lending position/i);
  const noDebt = reasoningFor(signal({ status: "no_debt", riskLabel: "NONE", healthFactor: null }));
  assert.match(noDebt, /cannot be liquidated|no outstanding debt/i);
});

test("reasoning tolerates a null liquidation distance", () => {
  const s = signal({
    status: "active",
    riskLabel: "AT_RISK",
    healthFactor: 1.33,
    liquidationDistance: { collateralDropPercentToLiquidation: null, description: "…" },
  });
  assert.doesNotThrow(() => reasoningFor(s));
  assert.match(reasoningFor(s), /unknown amount/);
});

test("toRiskCheck carries verdict, reasoning, signals and freshness through", () => {
  const s = active("AT_RISK", 1.33);
  const out = toRiskCheck(s);
  assert.equal(out.wallet, s.wallet);
  assert.equal(out.protocol, "aave-v3");
  assert.equal(out.verdict, "RECHECK");
  assert.ok(out.reasoning.length > 0);
  assert.equal(out.signals.riskLabel, "AT_RISK");
  assert.equal(out.signals.healthFactor, 1.33);
  assert.equal(out.signals.liquidationDistancePercent, 24.95);
  assert.equal(out.signals.totalCollateralUSD, 55176.08);
  assert.equal(out.signals.totalDebtUSD, 32301.3);
  assert.equal(out.signals.liquidationThreshold, 0.78);
  assert.equal(out.confidence, 0.97);
  assert.equal(out.meta.blockNumber, 50127516); // freshness passed through unchanged
});
