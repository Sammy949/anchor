/**
 * Spike: prove we can read correct Aave V3 data off Base mainnet.
 *
 * Usage:
 *   npm run spike                 # auto-discover a real borrower via Borrow events
 *   npm run spike -- 0xWALLET     # inspect a specific wallet
 *
 * This validates the ONE real technical unknown before any schema work:
 * can ethers v6 talk to Base mainnet, call the Aave V3 Pool, and decode
 * a position into a sane health factor + derived liquidation distance.
 */
import "./curl-transport.js"; // DEV-ONLY: routes ethers HTTP via curl in this sandbox. Not used by src/ or api/.
import { JsonRpcProvider, Contract, formatUnits, isAddress, MaxUint256 } from "ethers";

const BASE_RPC = "https://mainnet.base.org";
// Aave V3 Pool (proxy) on Base mainnet. Verified against BaseScan + aave-address-book (AaveV3Base.POOL).
const AAVE_V3_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";

const POOL_ABI = [
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
];

async function findBorrower(pool: Contract, provider: JsonRpcProvider): Promise<string[]> {
  const latest = await provider.getBlockNumber();
  const found = new Set<string>();
  let span = 2000; // start optimistic; shrink on RPC range errors
  let to = latest;

  for (let attempt = 0; attempt < 20 && found.size < 8; attempt++) {
    const from = Math.max(0, to - span);
    try {
      const logs = await pool.queryFilter(pool.filters.Borrow(), from, to);
      for (const log of logs) {
        const onBehalfOf = (log as any).args?.onBehalfOf as string | undefined;
        if (onBehalfOf) found.add(onBehalfOf);
      }
      console.log(`  scanned blocks ${from}..${to} -> ${logs.length} Borrow events (${found.size} unique borrowers so far)`);
      to = from - 1;
    } catch (err) {
      // Public RPCs cap getLogs range; shrink and retry the same window.
      span = Math.floor(span / 2);
      console.log(`  range ${from}..${to} rejected, shrinking span to ${span}`);
      if (span < 100) break;
    }
  }
  return [...found];
}

async function inspect(pool: Contract, provider: JsonRpcProvider, wallet: string) {
  const block = await provider.getBlock("latest");
  const [totalCollateralBase, totalDebtBase, , currentLiquidationThreshold, ltv, healthFactor] =
    await pool.getUserAccountData(wallet);

  const collateralUSD = parseFloat(formatUnits(totalCollateralBase, 8));
  const debtUSD = parseFloat(formatUnits(totalDebtBase, 8));
  const liqThreshold = Number(currentLiquidationThreshold) / 1e4;
  const isInfinite = healthFactor === MaxUint256;
  const hf = isInfinite ? Infinity : parseFloat(formatUnits(healthFactor, 18));

  // Liquidation distance: HF = (collateral * liqThreshold) / debt. A uniform drop
  // d in collateral value scales HF by (1-d); liquidation at HF=1 => d = 1 - 1/HF.
  const dropPct = isInfinite || hf <= 0 ? null : (1 - 1 / hf) * 100;

  console.log(`\n=== ${wallet} ===`);
  console.log(`  block:                ${block?.number} @ ${new Date((block?.timestamp ?? 0) * 1000).toISOString()}`);
  console.log(`  totalCollateralUSD:   $${collateralUSD.toLocaleString()}`);
  console.log(`  totalDebtUSD:         $${debtUSD.toLocaleString()}`);
  console.log(`  liquidationThreshold: ${liqThreshold} (ltv ${Number(ltv) / 1e4})`);
  console.log(`  healthFactor:         ${isInfinite ? "infinite (no debt)" : hf.toFixed(4)}`);
  console.log(`  collateral drop to liquidation: ${dropPct === null ? "n/a" : dropPct.toFixed(2) + "%"}`);
  return { hasPosition: debtUSD > 0 && !isInfinite };
}

async function main() {
  const provider = new JsonRpcProvider(BASE_RPC, 8453);
  const pool = new Contract(AAVE_V3_POOL, POOL_ABI, provider);

  const net = await provider.getNetwork();
  console.log(`Connected to chainId ${net.chainId} (expected 8453 = Base mainnet)`);

  const arg = process.argv[2];
  if (arg) {
    if (!isAddress(arg)) throw new Error(`Not a valid address: ${arg}`);
    await inspect(pool, provider, arg);
    return;
  }

  console.log("No wallet passed; auto-discovering a real borrower via Borrow events...");
  const candidates = await findBorrower(pool, provider);
  if (candidates.length === 0) throw new Error("No borrowers found in scanned range");

  console.log(`\nTesting ${candidates.length} candidate(s) for an active (indebted) position...`);
  for (const w of candidates) {
    const { hasPosition } = await inspect(pool, provider, w);
    if (hasPosition) {
      console.log(`\n✓ Found a live position with real liquidation risk: ${w}`);
      return;
    }
  }
  console.log("\n(no candidate currently carries debt; re-run to scan a fresh range)");
}

main().catch((e) => {
  console.error("\nSPIKE FAILED:", e);
  process.exit(1);
});
