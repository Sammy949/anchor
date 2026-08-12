import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshnessConfidence,
  liquidationDistance,
  positionStatus,
  riskLabel,
  round2,
  round4,
} from "../src/risk";
import type { AaveAccountData } from "../src/types";

const acct = (over: Partial<AaveAccountData>): AaveAccountData => ({
  totalCollateralUSD: 0,
  totalDebtUSD: 0,
  liquidationThreshold: 0,
  ltv: 0,
  healthFactor: null,
  ...over,
});

test("riskLabel thresholds", () => {
  assert.equal(riskLabel(null), "NONE");
  assert.equal(riskLabel(0.9), "LIQUIDATABLE");
  assert.equal(riskLabel(1), "CRITICAL"); // at the threshold
  assert.equal(riskLabel(1.05), "CRITICAL");
  assert.equal(riskLabel(1.1), "AT_RISK"); // boundary is inclusive-below
  assert.equal(riskLabel(1.3), "AT_RISK");
  assert.equal(riskLabel(1.5), "MODERATE");
  assert.equal(riskLabel(1.99), "MODERATE");
  assert.equal(riskLabel(2), "SAFE");
  assert.equal(riskLabel(5), "SAFE");
});

test("liquidationDistance uses d = 1 - 1/HF", () => {
  assert.equal(liquidationDistance(acct({ healthFactor: 1.1 })).collateralDropPercentToLiquidation, 9.09);
  assert.equal(liquidationDistance(acct({ healthFactor: 2 })).collateralDropPercentToLiquidation, 50);
  assert.equal(liquidationDistance(acct({ healthFactor: 4 })).collateralDropPercentToLiquidation, 75);
});

test("liquidationDistance edge cases", () => {
  // at or past liquidation
  assert.equal(liquidationDistance(acct({ healthFactor: 1 })).collateralDropPercentToLiquidation, 0);
  assert.equal(liquidationDistance(acct({ healthFactor: 0.8 })).collateralDropPercentToLiquidation, 0);
  // no debt but collateral present
  const noDebt = liquidationDistance(acct({ healthFactor: null, totalCollateralUSD: 1000 }));
  assert.equal(noDebt.collateralDropPercentToLiquidation, null);
  assert.match(noDebt.description, /cannot be liquidated/);
  // nothing on Aave
  const none = liquidationDistance(acct({ healthFactor: null }));
  assert.equal(none.collateralDropPercentToLiquidation, null);
  assert.match(none.description, /No Aave v3 position/);
});

test("positionStatus", () => {
  assert.equal(positionStatus(acct({ totalDebtUSD: 100, totalCollateralUSD: 200 })), "active");
  assert.equal(positionStatus(acct({ totalCollateralUSD: 200 })), "no_debt");
  assert.equal(positionStatus(acct({})), "no_position");
});

test("freshnessConfidence decays with block age, floored at 0.5", () => {
  const now = 1_000_000_000_000; // fixed ms
  const nowSec = now / 1000;
  assert.equal(freshnessConfidence(nowSec, now), 1); // head
  assert.equal(freshnessConfidence(nowSec - 6, now), 0.9); // 6s old, horizon 60
  assert.equal(freshnessConfidence(nowSec - 30, now), 0.5); // 30s -> 0.5
  assert.equal(freshnessConfidence(nowSec - 600, now), 0.5); // very stale -> floor
  assert.equal(freshnessConfidence(nowSec + 5, now), 1); // future skew clamps to 1
});

test("rounding helpers", () => {
  assert.equal(round2(1.014), 1.01);
  assert.equal(round2(1.016), 1.02);
  assert.equal(round2(49542.301), 49542.3);
  assert.equal(round4(1.0999999091631054), 1.1);
});
