import { Contract, formatUnits, MaxUint256, type JsonRpcProvider } from "ethers";
import { AAVE_V3_POOL, BPS_DECIMALS, HF_DECIMALS, USD_DECIMALS } from "./config.js";
import type { AaveAccountData } from "./types.js";

// Minimal ABI: we only need the aggregate account view.
export const POOL_ABI = [
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
];

/**
 * Read and decode an account's aggregate Aave v3 position. Pin the read to an
 * explicit block so the freshness metadata we report is exactly the block the
 * numbers came from (verifiable, not "roughly now").
 */
export async function readAaveAccountData(
  provider: JsonRpcProvider,
  wallet: string,
  blockTag?: number,
): Promise<AaveAccountData> {
  const pool = new Contract(AAVE_V3_POOL, POOL_ABI, provider);
  const getUserAccountData = pool.getFunction("getUserAccountData");
  const [totalCollateralBase, totalDebtBase, , currentLiquidationThreshold, ltv, healthFactor] =
    await getUserAccountData(wallet, { blockTag });

  const totalDebtUSD = parseFloat(formatUnits(totalDebtBase, USD_DECIMALS));
  // Aave returns type(uint256).max for health factor when there is no debt.
  const infinite = healthFactor === MaxUint256 || totalDebtUSD === 0;

  return {
    totalCollateralUSD: parseFloat(formatUnits(totalCollateralBase, USD_DECIMALS)),
    totalDebtUSD,
    liquidationThreshold: Number(currentLiquidationThreshold) / 10 ** BPS_DECIMALS,
    ltv: Number(ltv) / 10 ** BPS_DECIMALS,
    healthFactor: infinite ? null : parseFloat(formatUnits(healthFactor, HF_DECIMALS)),
  };
}
