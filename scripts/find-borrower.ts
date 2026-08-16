/**
 * Throwaway: find a currently-active Aave v3 borrower on Base mainnet for the
 * Telegraph registration sample. Scans recent Pool `Borrow` events for
 * `onBehalfOf` addresses, then reads each account's live position and prints the
 * active ones (real debt) sorted riskiest-first.
 */
import "./curl-transport.js"; // local sandbox egress workaround; must precede provider creation
import { Contract, JsonRpcProvider, formatUnits, MaxUint256 } from "ethers";

const RPC = process.env.ANCHOR_RPC_URL ?? "https://mainnet.base.org";
const POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const USD_DECIMALS = 8;
const HF_DECIMALS = 18;
const BPS = 4;

const ABI = [
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
];

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const pool = new Contract(POOL, ABI, provider);
  const latest = await provider.getBlockNumber();
  console.error(`latest block ${latest}`);

  const CHUNK = 1800;
  const MAX_CHUNKS = 14;
  const seen = new Set<string>();
  const borrowers: string[] = [];

  const borrowFilter = pool.filters.Borrow;
  if (!borrowFilter) throw new Error("Borrow event not found on Pool ABI");

  for (let i = 0; i < MAX_CHUNKS && borrowers.length < 50; i++) {
    const to = latest - i * CHUNK;
    const from = to - CHUNK + 1;
    try {
      const logs = await pool.queryFilter(borrowFilter(), from, to);
      for (const log of logs) {
        const onBehalfOf = (log as unknown as { args?: { onBehalfOf?: string } }).args?.onBehalfOf;
        if (onBehalfOf && !seen.has(onBehalfOf.toLowerCase())) {
          seen.add(onBehalfOf.toLowerCase());
          borrowers.push(onBehalfOf);
        }
      }
      console.error(`blocks ${from}-${to}: ${logs.length} events, ${borrowers.length} unique borrowers`);
    } catch (e) {
      console.error(`getLogs ${from}-${to} failed: ${(e as Error).message}`);
    }
  }

  const getData = pool.getFunction("getUserAccountData");
  const rows: { wallet: string; collateral: number; debt: number; hf: number | null }[] = [];
  for (const w of borrowers) {
    try {
      const r = await getData(w);
      const collateral = parseFloat(formatUnits(r[0], USD_DECIMALS));
      const debt = parseFloat(formatUnits(r[1], USD_DECIMALS));
      const infinite = r[5] === MaxUint256 || debt === 0;
      const hf = infinite ? null : parseFloat(formatUnits(r[5], HF_DECIMALS));
      rows.push({ wallet: w, collateral, debt, hf });
    } catch (e) {
      console.error(`getUserAccountData ${w} failed: ${(e as Error).message}`);
    }
  }

  const active = rows.filter((r) => r.debt > 100 && r.hf !== null);
  active.sort((a, b) => a.hf! - b.hf!);
  console.error(`\n${active.length} active borrowers with debt > $100 (riskiest first):\n`);
  for (const r of active.slice(0, 15)) {
    const label =
      r.hf! < 1.1 ? "CRITICAL" : r.hf! < 1.5 ? "AT_RISK" : r.hf! < 2 ? "MODERATE" : "SAFE";
    console.log(
      `${r.wallet}  HF=${r.hf!.toFixed(4)}  ${label.padEnd(8)}  collat=$${r.collateral.toFixed(2)}  debt=$${r.debt.toFixed(2)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
