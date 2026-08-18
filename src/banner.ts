import { NETWORK, PROTOCOL } from "./config.js";

// "ANCHOR" in the ANSI Shadow figlet style.
const WORDMARK = String.raw`
 █████╗ ███╗   ██╗ ██████╗██╗  ██╗ ██████╗ ██████╗
██╔══██╗████╗  ██║██╔════╝██║  ██║██╔═══██╗██╔══██╗
███████║██╔██╗ ██║██║     ███████║██║   ██║██████╔╝
██╔══██║██║╚██╗██║██║     ██╔══██║██║   ██║██╔══██╗
██║  ██║██║ ╚████║╚██████╗██║  ██║╚██████╔╝██║  ██║
╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝`;

/** Branded plaintext served at GET / and logged once per cold start. */
export function renderBanner(): string {
  return [
    WORDMARK,
    "",
    "  on-chain counterparty risk for autonomous agents",
    "",
    `  is it safe to transact with this wallet?  ::  read live from ${PROTOCOL} on ${NETWORK.name}`,
    "",
    "  GET /api/risk-check?wallet=0x<address>      -> ALLOW / RECHECK / BLOCK + reasoning",
    "  GET /api/health-factor?wallet=0x<address>   -> underlying liquidation-risk signal",
    "",
    "  telegraph miner (track 1)  ::  intent FRAUD_DETECTION",
    "",
  ].join("\n");
}

/** Machine-readable service descriptor served at GET / for Accept: application/json. */
export function serviceDescriptor() {
  return {
    name: "Anchor",
    description:
      "On-chain counterparty-risk miner. Given a wallet, returns an ALLOW / RECHECK / BLOCK verdict on whether it is financially safe for an agent to extend credit to or transact with it, derived from live lending-protocol solvency state with per-response freshness metadata.",
    protocol: PROTOCOL,
    network: NETWORK.name,
    chainId: NETWORK.chainId,
    endpoints: {
      riskCheck: "/api/risk-check?wallet=0x<address>",
      healthFactor: "/api/health-factor?wallet=0x<address>",
    },
    telegraph: { track: "miner", intent: "FRAUD_DETECTION" },
  };
}

let logged = false;
export function logBannerOnce(): void {
  if (logged) return;
  logged = true;
  console.log(renderBanner());
}
