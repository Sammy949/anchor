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
    "  verified on-chain risk signals for autonomous agents",
    "",
    `  liquidation-distance + health-factor feed  ::  ${PROTOCOL} on ${NETWORK.name}`,
    "",
    "  GET /api/health-factor?wallet=0x<address>",
    "",
    "  telegraph miner (track 1)  ::  intent TVL_LOOKUP",
    "",
  ].join("\n");
}

/** Machine-readable service descriptor served at GET / for Accept: application/json. */
export function serviceDescriptor() {
  return {
    name: "Anchor",
    description:
      "Verified on-chain risk data miner. Real-time liquidation-risk and health-factor signals for lending protocols, with per-response freshness metadata.",
    protocol: PROTOCOL,
    network: NETWORK.name,
    chainId: NETWORK.chainId,
    endpoints: { healthFactor: "/api/health-factor?wallet=0x<address>" },
    telegraph: { track: "miner", intent: "TVL_LOOKUP" },
  };
}

let logged = false;
export function logBannerOnce(): void {
  if (logged) return;
  logged = true;
  console.log(renderBanner());
}
