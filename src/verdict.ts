import type { HealthFactorResponse, RiskCheckResponse, Verdict } from "./types.js";

/**
 * Map an on-chain solvency signal to a three-valued counterparty-risk verdict.
 *
 * This is the Telegraph FRAUD_DETECTION answer: given a wallet, is it
 * financially safe for a calling agent to extend credit to, lend to, or settle
 * with it? We answer purely from live Aave v3 leverage state, so the verdict is
 * about *solvency* risk (over-leverage, imminent liquidation), not scam/drainer
 * detection. The reasoning always names the specific defect and the next step,
 * so a downstream agent gets an actionable answer, not just a label.
 *
 * Pure and I/O-free by design, same as risk.ts: the verdict is fully determined
 * by the signal we were handed, so it is reproducible and unit-testable.
 */

const PROCEED_LABELS = new Set(["SAFE", "MODERATE"]);
const REFUSE_LABELS = new Set(["CRITICAL", "LIQUIDATABLE"]);

export function verdictFor(signal: HealthFactorResponse): Verdict {
  const { riskLabel } = signal;
  if (riskLabel === "AT_RISK") return "RECHECK";
  if (REFUSE_LABELS.has(riskLabel)) return "BLOCK";
  // SAFE, MODERATE, and NONE (no debt / no position) carry no solvency defect.
  return "ALLOW";
}

/** Compose the actionable "defect + next step" reasoning for a verdict. */
export function reasoningFor(signal: HealthFactorResponse): string {
  const { riskLabel, status, healthFactor } = signal;
  const drop = signal.liquidationDistance.collateralDropPercentToLiquidation;
  const hf = healthFactor === null ? null : healthFactor.toFixed(2);

  if (status === "no_position") {
    return "No Aave v3 lending position and no leverage found for this wallet. No on-chain solvency defect detected; nothing to flag from lending state alone.";
  }
  if (status === "no_debt") {
    return "Wallet holds Aave v3 collateral with no outstanding debt, so the position cannot be liquidated. No solvency defect; safe to proceed on lending-risk grounds.";
  }

  // status === "active": there is real debt, so the health factor drives it.
  switch (riskLabel) {
    case "SAFE":
      return `Active Aave v3 position is well collateralized (health factor ${hf}); collateral would need to fall ~${fmtDrop(drop)} before liquidation. No solvency defect; safe to proceed.`;
    case "MODERATE":
      return `Active Aave v3 position carries moderate leverage (health factor ${hf}) with a ~${fmtDrop(drop)} buffer to liquidation. Adequate for now; no action required beyond normal monitoring.`;
    case "AT_RISK":
      return `Counterparty holds an active Aave v3 position ~${fmtDrop(drop)} from liquidation (health factor ${hf}). Collateral buffer is thin; re-verify solvency or require added margin before extending credit.`;
    case "CRITICAL":
      return `Active Aave v3 position is critically leveraged (health factor ${hf}), only ~${fmtDrop(drop)} of collateral drop from liquidation. High risk of imminent default; do not extend credit without collateral held directly.`;
    case "LIQUIDATABLE":
      return `Active Aave v3 position is at or past the liquidation threshold now (health factor ${hf}). The counterparty is effectively insolvent on this position; block credit and treat as distressed.`;
    default:
      return `Active Aave v3 position (health factor ${hf}).`;
  }
}

function fmtDrop(drop: number | null): string {
  if (drop === null) return "an unknown amount";
  return `${drop.toFixed(2)}%`;
}

/** Assemble the full RiskCheckResponse from an already-read solvency signal. */
export function toRiskCheck(signal: HealthFactorResponse): RiskCheckResponse {
  return {
    wallet: signal.wallet,
    protocol: signal.protocol,
    verdict: verdictFor(signal),
    reasoning: reasoningFor(signal),
    signals: {
      riskLabel: signal.riskLabel,
      healthFactor: signal.healthFactor,
      liquidationDistancePercent: signal.liquidationDistance.collateralDropPercentToLiquidation,
      totalCollateralUSD: signal.totalCollateralUSD,
      totalDebtUSD: signal.totalDebtUSD,
      liquidationThreshold: signal.liquidationThreshold,
    },
    confidence: signal.confidence,
    meta: signal.meta,
  };
}
