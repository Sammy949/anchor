/**
 * Network + protocol configuration.
 *
 * Anchor reads Aave v3 state from Base mainnet (real positions = real ground
 * truth). This is independent of Telegraph's on-chain miner registry, which
 * lives on Base Sepolia. ANCHOR_RPC_URL lets us swap in a private RPC (Alchemy
 * / Infura / etc.) later without a code change.
 */
export const NETWORK = {
  name: "base-mainnet",
  chainId: 8453,
  rpcUrl: process.env.ANCHOR_RPC_URL ?? "https://mainnet.base.org",
} as const;

// Aave v3 Pool (proxy) on Base mainnet.
// Verified: BaseScan "Aave: Pool Proxy Base" + aave-dao/aave-address-book AaveV3Base.POOL.
export const AAVE_V3_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";

export const PROTOCOL = "aave-v3";
export const SOURCE = "aave-v3-pool-contract";

// Aave v3 unit conventions: base currency (oracle) is USD with 8 decimals;
// liquidation threshold / LTV are basis points (1e4); health factor is 1e18.
export const USD_DECIMALS = 8;
export const BPS_DECIMALS = 4;
export const HF_DECIMALS = 18;

// Health-factor data does not need sub-second freshness; a short edge cache
// cuts RPC load without meaningfully staling the signal.
export const CACHE_TTL_SECONDS = 12;

// Confidence is a freshness score: it decays from 1 toward the floor as the
// read block's age approaches this horizon.
export const STALENESS_HORIZON_SECONDS = 60;
export const CONFIDENCE_FLOOR = 0.5;
