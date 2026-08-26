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

// A knowledge-shaped fraud question (no wallet). Exercises Anchor's LLM path.
const KNOWLEDGE_QUERY = "Who was behind the BitConnect Ponzi scheme?";

// Read a paid response as JSON, turning the common failure modes into a clear
// message instead of a bare "Unexpected end of JSON input". The node answers a
// payment it can't settle with `402` and an EMPTY body, which is exactly what an
// unfunded caller wallet produces.
async function readJson(res: Response, step: string): Promise<Record<string, unknown>> {
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 402) {
      throw new Error(
        `${step}: 402 Payment Required. Your caller wallet couldn't pay. Fund the ` +
          `throwaway EVM_PRIVATE_KEY with free Base Sepolia testnet USDC (faucet.circle.com, ` +
          `select Base Sepolia), then retry. See LAUNCH-KIT PART 4.` +
          (body ? `\n  node said: ${body.slice(0, 300)}` : ""),
      );
    }
    throw new Error(`${step}: HTTP ${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 300)}` : ""}`);
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`${step}: expected JSON but got ${body ? body.slice(0, 300) : "an empty body"}`);
  }
}

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
  // @x402 v2 API: build an x402Client, register the EVM "exact" scheme bound to
  // a viem account, then wrap fetch. (The old top-level createSigner() is gone.)
  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
  const { privateKeyToAccount } = await import("viem/accounts");

  const normalizedKey = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  const account = privateKeyToAccount(normalizedKey);
  const client = new x402Client();
  // No `networks` => registers the eip155:* wildcard, which covers Base Sepolia
  // (eip155:84532). USDC pays via EIP-3009, so no RPC or approval step is needed.
  registerExactEvmScheme(client, { signer: account });
  const pay = wrapFetchWithPayment(fetch, client);

  // --- Step 1: auto-routed. Does the router send this to Anchor? ---
  // The node's /engine/v1/ask uses an LLM to classify intent + pick a miner. If
  // THAT routing LLM errors (a node-side 500, e.g. its Bedrock/litellm backend),
  // it has nothing to do with Anchor — so don't abort; fall through to the
  // direct calls below, which bypass the router entirely.
  console.log(`\n[1] Auto-routed ask (paid in testnet USDC)\n  query: ${DEFAULT_QUERY}\n`);
  try {
    const routed = await pay(`${NODE}/engine/v1/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: DEFAULT_QUERY }),
    });
    const routedJson = await readJson(routed, "[1] auto-routed ask");
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  => routing step failed (node-side, not Anchor): ${msg}`);
    console.log(`     Skipping to direct calls, which bypass the node's routing LLM.`);
  }

  // --- Step 2: direct call to Anchor, WALLET path, bypassing the router. ---
  console.log(`\n[2] Direct call to Anchor (#${ANCHOR_MINER_ID}) — wallet path\n`);
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
  const directJson = await readJson(direct, "[2] direct wallet call to Anchor");
  console.log(`  result: ${JSON.stringify(directJson.result ?? directJson, null, 2)}`);

  // --- Step 3: direct call to Anchor, KNOWLEDGE path. Proves the LLM fallback
  // answers over the wire (verdict INFO), independent of the broken router. ---
  console.log(`\n[3] Direct call to Anchor (#${ANCHOR_MINER_ID}) — knowledge path\n  query: ${KNOWLEDGE_QUERY}\n`);
  const directK = await pay(`${NODE}/engine/v1/ask/${ANCHOR_MINER_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "GET",
      endpoint: "/risk-check",
      payload: { query: KNOWLEDGE_QUERY },
    }),
  });
  const directKJson = await readJson(directK, "[3] direct knowledge call to Anchor");
  console.log(`  result: ${JSON.stringify(directKJson.result ?? directKJson, null, 2)}`);
}

main().catch((e) => {
  console.error("\nask failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
