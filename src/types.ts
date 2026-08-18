export type RiskLabel =
  | "NONE" // no debt / no position
  | "SAFE" // HF >= 2
  | "MODERATE" // 1.5 <= HF < 2
  | "AT_RISK" // 1.1 <= HF < 1.5
  | "CRITICAL" // 1 <= HF < 1.1
  | "LIQUIDATABLE"; // HF < 1

export type PositionStatus = "active" | "no_debt" | "no_position";

/** Decoded, human-scaled output of Aave v3 Pool.getUserAccountData. */
export interface AaveAccountData {
  totalCollateralUSD: number;
  totalDebtUSD: number;
  liquidationThreshold: number; // fraction, e.g. 0.83
  ltv: number; // fraction, e.g. 0.80
  healthFactor: number | null; // null when there is no debt (Aave returns uint max)
}

export interface LiquidationDistance {
  /** Uniform % drop in collateral value that would push HF to 1. Null when N/A. */
  collateralDropPercentToLiquidation: number | null;
  description: string;
}

/**
 * Agent-facing counterparty-risk verdict, mapped from the on-chain solvency
 * signal. Three-valued so a calling agent can branch on it directly rather than
 * interpret a raw number: proceed, hold and re-verify, or refuse.
 */
export type Verdict =
  | "ALLOW" // no on-chain solvency defect found
  | "RECHECK" // thin buffer / mild defect; re-verify before acting
  | "BLOCK"; // at or near liquidation; do not extend credit

/** The signals the verdict is derived from. Phase 2 extends this in place. */
export interface RiskSignals {
  riskLabel: RiskLabel;
  healthFactor: number | null;
  liquidationDistancePercent: number | null;
  totalCollateralUSD: number;
  totalDebtUSD: number;
}

/**
 * Public response shape served at GET /api/risk-check, Anchor's answer to the
 * Telegraph FRAUD_DETECTION intent: "is it financially safe for my agent to
 * transact with this wallet?" The verdict + reasoning are the headline; the
 * underlying signals and freshness metadata back it up.
 */
export interface RiskCheckResponse {
  wallet: string;
  protocol: string;
  verdict: Verdict;
  reasoning: string;
  signals: RiskSignals;
  confidence: number; // 0..1 freshness score
  meta: {
    blockNumber: number;
    timestamp: string; // ISO-8601, from the block the data was read at
    source: string;
    chainId: number;
    network: string;
  };
}

/** The public response shape served at GET /api/health-factor. */
export interface HealthFactorResponse {
  wallet: string;
  protocol: string;
  status: PositionStatus;
  riskLabel: RiskLabel;
  healthFactor: number | null;
  totalCollateralUSD: number;
  totalDebtUSD: number;
  liquidationThreshold: number;
  liquidationDistance: LiquidationDistance;
  confidence: number; // 0..1 freshness score
  meta: {
    blockNumber: number;
    timestamp: string; // ISO-8601, from the block the data was read at
    source: string;
    chainId: number;
    network: string;
  };
}
