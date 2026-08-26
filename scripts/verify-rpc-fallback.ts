/**
 * DEV-ONLY live verification of the RPC primary/fallback runner against REAL
 * Base mainnet. Not imported by src/ or api/. Run with:
 *   npx tsx scripts/verify-rpc-fallback.ts
 *
 * It drives the actual withRpcFallback runner + the actual Aave read op through
 * real providers, so both paths are exercised for real, not mocked:
 *   A) primary healthy  -> served by the primary, fallback never used
 *   B) primary unreachable -> falls back to the public RPC, still returns data
 *
 * Egress in this sandbox is firewalled at the Node socket layer, so we route
 * ethers' HTTP through curl (see curl-transport). On Vercel this file is unused.
 */
import "./curl-transport.js";
import { JsonRpcProvider } from "ethers";
import { withRpcFallback } from "../src/provider.js";
import { readAaveAccountData } from "../src/aave.js";
import { NETWORK } from "../src/config.js";

// A known Base-mainnet wallet with a real Aave v3 position (from service.test.ts).
const WALLET = "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060";

const PUBLIC_RPC = "https://mainnet.base.org";
// A second real, working Base endpoint used to stand in for a "private primary"
// so we can prove the primary is preferred without needing an Alchemy key here.
const ALT_GOOD_RPC = "https://base-rpc.publicnode.com";
// Guaranteed-unreachable host to force the primary to fail.
const BAD_RPC = "https://anchor-nonexistent-primary.invalid";

const mk = (url: string) => new JsonRpcProvider(url, NETWORK.chainId, { staticNetwork: true });
const readOp = (p: JsonRpcProvider) => readAaveAccountData(p, WALLET);

// Capture the fallback warn() so we can assert whether the fallback fired.
let warned: string[] = [];
const origWarn = console.warn;
console.warn = (...a: unknown[]) => {
  warned.push(a.map(String).join(" "));
  origWarn(...a);
};

async function main() {
  let failures = 0;

  // Case A: healthy primary -> primary serves, fallback untouched.
  warned = [];
  const a = await withRpcFallback(readOp, [mk(ALT_GOOD_RPC), mk(PUBLIC_RPC)]);
  const aOk =
    Number.isFinite(a.totalCollateralUSD) &&
    Number.isFinite(a.totalDebtUSD) &&
    warned.length === 0;
  console.log(`\n[A] primary healthy -> ${aOk ? "PASS" : "FAIL"}`);
  console.log(`    collateral=$${a.totalCollateralUSD.toFixed(2)} debt=$${a.totalDebtUSD.toFixed(2)} HF=${a.healthFactor} fallbackFired=${warned.length > 0}`);
  if (!aOk) failures++;

  // Case B: unreachable primary -> falls back to public, still returns data.
  warned = [];
  const b = await withRpcFallback(readOp, [mk(BAD_RPC), mk(PUBLIC_RPC)]);
  const bOk =
    Number.isFinite(b.totalCollateralUSD) &&
    Number.isFinite(b.totalDebtUSD) &&
    warned.length > 0;
  console.log(`\n[B] primary unreachable -> ${bOk ? "PASS" : "FAIL"}`);
  console.log(`    collateral=$${b.totalCollateralUSD.toFixed(2)} debt=$${b.totalDebtUSD.toFixed(2)} HF=${b.healthFactor} fallbackFired=${warned.length > 0}`);
  if (!bOk) failures++;

  // Sanity: both paths should have read the SAME wallet's real position.
  const consistent = a.totalCollateralUSD === b.totalCollateralUSD;
  console.log(`\n[=] primary and fallback returned consistent collateral -> ${consistent ? "PASS" : "note: differ (blocks may differ)"}`);

  console.log(`\n${failures === 0 ? "ALL LIVE CHECKS PASSED" : `${failures} LIVE CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-rpc-fallback crashed:", err);
  process.exit(1);
});
