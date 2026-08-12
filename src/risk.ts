import { CONFIDENCE_FLOOR, STALENESS_HORIZON_SECONDS } from "./config.js";
import type { AaveAccountData, LiquidationDistance, PositionStatus, RiskLabel } from "./types.js";

export function positionStatus(d: AaveAccountData): PositionStatus {
  if (d.totalDebtUSD > 0) return "active";
  if (d.totalCollateralUSD > 0) return "no_debt";
  return "no_position";
}

export function riskLabel(healthFactor: number | null): RiskLabel {
  if (healthFactor === null) return "NONE";
  if (healthFactor < 1) return "LIQUIDATABLE";
  if (healthFactor < 1.1) return "CRITICAL";
  if (healthFactor < 1.5) return "AT_RISK";
  if (healthFactor < 2) return "MODERATE";
  return "SAFE";
}

/**
 * Liquidation distance.
 *
 * Aave's health factor is HF = (collateral * liquidationThreshold) / debt.
 * A uniform drop `d` in collateral value scales HF by (1 - d); liquidation
 * triggers at HF = 1, so the drop-to-liquidation is d = 1 - 1/HF.
 *
 * This is a first-order, whole-basket estimate (it assumes all collateral
 * moves together and debt is stable-valued). We state that assumption in the
 * description rather than implying per-asset precision.
 */
export function liquidationDistance(d: AaveAccountData): LiquidationDistance {
  const hf = d.healthFactor;
  if (hf === null) {
    return {
      collateralDropPercentToLiquidation: null,
      description:
        d.totalCollateralUSD > 0
          ? "No outstanding debt; this position cannot be liquidated at any collateral price."
          : "No Aave v3 position found for this wallet.",
    };
  }
  if (hf <= 1) {
    return {
      collateralDropPercentToLiquidation: 0,
      description: "Position is at or past the liquidation threshold now (health factor <= 1).",
    };
  }
  const rounded = round2((1 - 1 / hf) * 100);
  return {
    collateralDropPercentToLiquidation: rounded,
    description: `Collateral value would need to drop ~${rounded.toFixed(
      2,
    )}% (uniformly across the collateral basket) to trigger liquidation at current debt levels.`,
  };
}

/** Freshness score in [floor, 1]: 1 at the chain head, decaying with block age. */
export function freshnessConfidence(blockTimestampSec: number, nowMs: number): number {
  const ageSec = Math.max(0, nowMs / 1000 - blockTimestampSec);
  const raw = 1 - ageSec / STALENESS_HORIZON_SECONDS;
  return Math.max(CONFIDENCE_FLOOR, Math.min(1, Math.round(raw * 1000) / 1000));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
