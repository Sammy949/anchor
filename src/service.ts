import { getAddress, isAddress, JsonRpcProvider } from "ethers";
import { NETWORK, PROTOCOL, SOURCE } from "./config.js";
import { readAaveAccountData } from "./aave.js";
import { freshnessConfidence, liquidationDistance, positionStatus, riskLabel, round2, round4 } from "./risk.js";
import { toRiskCheck } from "./verdict.js";
import type { HealthFactorResponse, RiskCheckResponse } from "./types.js";

export class InvalidWalletError extends Error {
  constructor(input: string) {
    super(`Not a valid EVM address: ${input}`);
    this.name = "InvalidWalletError";
  }
}

// Reuse one provider across warm invocations. staticNetwork skips a per-call
// eth_chainId round-trip since the chain is fixed.
let provider: JsonRpcProvider | null = null;
function getProvider(): JsonRpcProvider {
  if (!provider) {
    provider = new JsonRpcProvider(NETWORK.rpcUrl, NETWORK.chainId, { staticNetwork: true });
  }
  return provider;
}

/**
 * Core, transport-agnostic entry point: wallet address -> full risk signal.
 * Reads the account view and the head block, pinned to the same block number
 * so the reported freshness metadata is exact.
 */
export async function getRiskSignal(
  walletInput: string,
  nowMs: number = Date.now(),
): Promise<HealthFactorResponse> {
  if (!isAddress(walletInput)) throw new InvalidWalletError(walletInput);
  const wallet = getAddress(walletInput); // normalize to checksum

  const p = getProvider();
  const blockNumber = await p.getBlockNumber();
  const [account, block] = await Promise.all([
    readAaveAccountData(p, wallet, blockNumber),
    p.getBlock(blockNumber),
  ]);
  if (!block) throw new Error(`RPC returned no block for ${blockNumber}`);

  // Round the health factor to 4dp and derive every downstream field from that
  // same value, so the response is internally recomputable: an agent gets our
  // riskLabel and liquidationDistance back from the healthFactor we display.
  const healthFactor = account.healthFactor === null ? null : round4(account.healthFactor);
  const derived = { ...account, healthFactor };

  return {
    wallet,
    protocol: PROTOCOL,
    status: positionStatus(account),
    riskLabel: riskLabel(healthFactor),
    healthFactor,
    totalCollateralUSD: round2(account.totalCollateralUSD),
    totalDebtUSD: round2(account.totalDebtUSD),
    liquidationThreshold: account.liquidationThreshold,
    liquidationDistance: liquidationDistance(derived),
    confidence: freshnessConfidence(block.timestamp, nowMs),
    meta: {
      blockNumber: block.number,
      timestamp: new Date(block.timestamp * 1000).toISOString(),
      source: SOURCE,
      chainId: NETWORK.chainId,
      network: NETWORK.name,
    },
  };
}

/**
 * FRAUD_DETECTION entry point: wallet -> ALLOW / RECHECK / BLOCK verdict.
 * Wraps the same single on-chain read as getRiskSignal (no extra RPC round-trip)
 * and derives the counterparty-risk verdict from it purely.
 */
export async function getRiskCheck(
  walletInput: string,
  nowMs: number = Date.now(),
): Promise<RiskCheckResponse> {
  const signal = await getRiskSignal(walletInput, nowMs);
  return toRiskCheck(signal);
}
