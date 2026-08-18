/**
 * DEV-ONLY: drive a real request at the Telegraph network to test whether a
 * wallet-risk query routes to Anchor (miner id 49) on FRAUD_DETECTION, and to
 * generate genuine, countable traffic for the intent.
 *
 * This is NOT needed for scoring: validators spot-check Anchor for free. It's a
 * routing probe + demand generator. It also costs no real money: inference is
 * paid in TESTNET USDC (Base Sepolia), which is free from a faucet.
 *
 * Runs on a NORMAL network, not the dev sandbox (which firewalls egress).
 *
 * Setup (once):
 *   npm i -D @x402/fetch @x402/evm
 *   # Base Sepolia testnet USDC from a faucet (e.g. Circle) into a THROWAWAY key.
 *   # Never use a wallet that holds real funds.
 *   export EVM_PRIVATE_KEY=0x<throwaway-testnet-key>
 *
 * Run:
 *   npx tsx scripts/ask.ts                 # default wallet-risk query (auto-routed) + direct call
 *   npx tsx scripts/ask.ts "your query"    # try your own phrasing
 *
 * What it prints: which intent the router picked, which miner served it, the
 * router's plain-language reasoning, and the verdict Anchor returned.
 */

// @x402 packages are optional dev deps; import lazily so `npm test`/typecheck
// don't require them to be installed.
const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
const SAMPLE_WALLET = "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060";
const ANCHOR_MINER_ID = "49";

// A naturally phrased question an agent might ask. If the router classifies this
// as FRAUD_DETECTION and picks miner 49, routing to Anchor works end to end.
const DEFAULT_QUERY =
  process.argv[2] ??
  `Is it financially safe to extend credit to wallet ${SAMPLE_WALLET}? Assess its on-chain lending risk.`;

async function main(): Promise<void> {
  const key = process.env.EVM_PRIVATE_KEY;
  if (!key) {
    console.error(
      "Set EVM_PRIVATE_KEY to a throwaway Base Sepolia key funded with free testnet USDC.\n" +
        "Never use a wallet holding real funds. See the header of this file.",
    );
    process.exit(1);
  }

  // --- Step 0: free discovery. Confirm what we're about to call. ---
  console.log(`\n[0] Discovery: miners on FRAUD_DETECTION (no payment)\n`);
  const disc = await fetch(`${NODE}/api/miners?intent=FRAUD_DETECTION`);
  const miners = (await disc.json()) as Array<Record<string, unknown>>;
  for (const m of Array.isArray(miners) ? miners : []) {
    const mark = String(m.id) === ANCHOR_MINER_ID ? " <- Anchor" : "";
    console.log(
      `  #${m.id} ${m.name} | ${(m.supported_intents as string[] | undefined)?.join(",")} | ` +
        `min $${m.min_price_usdc ?? "?"} | ${m.activation_status ?? "?"}${mark}`,
    );
  }

  // Lazy-load the x402 client only when we actually need to pay.
  const { wrapFetchWithPayment } = await import("@x402/fetch");
  const { createSigner } = await import("@x402/evm");
  // Per Telegraph's x402 docs. If your installed @x402/evm version's createSigner
  // needs an explicit chain, pass Base Sepolia (eip155:84532) here.
  const signer = createSigner(key);
  const pay = wrapFetchWithPayment(fetch, signer);

  // --- Step 1: auto-routed. Does the router send this to Anchor? ---
  console.log(`\n[1] Auto-routed ask (paid in testnet USDC)\n  query: ${DEFAULT_QUERY}\n`);
  const routed = await pay(`${NODE}/engine/v1/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: DEFAULT_QUERY }),
  });
  const routedJson = (await routed.json()) as Record<string, unknown>;
  console.log(`  intent   : ${routedJson.intent}`);
  console.log(`  miner    : #${routedJson.miner_id} ${routedJson.miner_name}`);
  console.log(`  reasoning: ${routedJson.reasoning}`);
  console.log(`  result   : ${JSON.stringify(routedJson.result ?? routedJson, null, 2)}`);
  const hitAnchor = String(routedJson.miner_id) === ANCHOR_MINER_ID;
  console.log(
    hitAnchor
      ? "  => routed to Anchor. End-to-end routing works."
      : `  => routed elsewhere (#${routedJson.miner_id}). The router did not pick Anchor for this phrasing; try another, or use the direct call below.`,
  );

  // --- Step 2: direct call to Anchor, bypassing the router. Guaranteed hit. ---
  console.log(`\n[2] Direct call to Anchor (#${ANCHOR_MINER_ID})\n`);
  const direct = await pay(`${NODE}/engine/v1/ask/${ANCHOR_MINER_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // GET endpoint: payload is sent as query params. endpoint matches the path
    // Anchor lists in /api/miners.
    body: JSON.stringify({
      method: "GET",
      endpoint: "/risk-check",
      payload: { wallet: SAMPLE_WALLET },
    }),
  });
  const directJson = (await direct.json()) as Record<string, unknown>;
  console.log(`  result: ${JSON.stringify(directJson.result ?? directJson, null, 2)}`);
}

main().catch((e) => {
  console.error("\nask failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
