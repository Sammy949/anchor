# Anchor

On-chain counterparty-risk miner for autonomous agents. Given a wallet, Anchor answers one question: is it financially safe for my agent to extend credit to, lend to, or transact with this address? The answer is a clear ALLOW / RECHECK / BLOCK verdict with reasoning, derived from live lending-protocol solvency state on Base, with per-response freshness metadata.

Built for the Telegraph Protocol Hackathon, Season I, Track 1 (Miner). Serves the `FRAUD_DETECTION` intent.

Live: https://anchor-miner.vercel.app

## What it does

Anchor reads a wallet's aggregate Aave v3 position on Base mainnet and turns it into an actionable counterparty-risk verdict, not just a raw number:

- **Verdict**: `ALLOW` (no solvency defect), `RECHECK` (thin buffer, re-verify before acting), or `BLOCK` (at or near liquidation, treat as distressed). An agent can branch on this directly.
- **Reasoning**: a plain-language explanation that names the specific defect and the next step, so the verdict is actionable rather than opaque.
- **Signals**: the underlying evidence, the Aave health factor, liquidation distance, collateral and debt, so the verdict is auditable.
- **Freshness metadata**: the exact block number and timestamp the data was read at, plus a confidence score, so a consuming agent knows how current the signal is.

The ground truth is the chain itself. There is no third-party API in the path.

## Endpoint

```
GET /api/risk-check?wallet=0x<address>
```

### Sample request

```
curl "https://anchor-miner.vercel.app/api/risk-check?wallet=0x50B75AaCb1ed974F5c901a32BeE767de39CBb060"
```

### Sample response

Real response from Base mainnet (values are live and move block to block):

```json
{
  "wallet": "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060",
  "protocol": "aave-v3",
  "verdict": "RECHECK",
  "reasoning": "Counterparty holds an active Aave v3 position ~24.66% from liquidation (health factor 1.33). Collateral buffer is thin; re-verify solvency or require added margin before extending credit.",
  "signals": {
    "riskLabel": "AT_RISK",
    "healthFactor": 1.3273,
    "liquidationDistancePercent": 24.66,
    "totalCollateralUSD": 55398.28,
    "totalDebtUSD": 32555.71
  },
  "confidence": 1,
  "meta": {
    "blockNumber": 50141866,
    "timestamp": "2026-08-18T17:11:19.000Z",
    "source": "aave-v3-pool-contract",
    "chainId": 8453,
    "network": "base-mainnet"
  }
}
```

### Response fields

| Field | Meaning |
| --- | --- |
| `verdict` | `ALLOW`, `RECHECK`, or `BLOCK`. The headline call an agent acts on. |
| `reasoning` | The specific solvency defect (if any) and the recommended next step. |
| `signals.riskLabel` | `SAFE` (HF >= 2), `MODERATE` (1.5 to 2), `AT_RISK` (1.1 to 1.5), `CRITICAL` (1 to 1.1), `LIQUIDATABLE` (< 1), `NONE` (no debt). |
| `signals.healthFactor` | Aave health factor, 4dp. `null` when there is no debt (Aave reports infinite). |
| `signals.liquidationDistancePercent` | Uniform collateral drop that would push HF to 1. `null` when not applicable. |
| `confidence` | Freshness score in `[0.5, 1]`; 1 at the chain head, decaying with block age. |
| `meta.blockNumber` / `meta.timestamp` | The exact block the numbers were read at. The read is pinned to this block, so the signal is reproducible. |

Error cases return a JSON `{ "error": ... }` body with status 400 (bad or missing `wallet`) or 502 (RPC read failure).

### Underlying signal endpoint

The raw liquidation-risk signal the verdict is built from is also exposed directly:

```
GET /api/health-factor?wallet=0x<address>
```

It returns the health factor, liquidation distance and freshness metadata without the verdict wrapper. Useful when you want the numbers rather than the call.

## How the verdict is derived

Anchor maps the Aave health factor to a verdict:

| Position | Verdict |
| --- | --- |
| SAFE / MODERATE (HF >= 1.5), or no debt / no position | `ALLOW` |
| AT_RISK (1.1 <= HF < 1.5) | `RECHECK` |
| CRITICAL / LIQUIDATABLE (HF < 1.1) | `BLOCK` |

The health factor itself is `HF = (collateral * liquidationThreshold) / debt`. A uniform drop `d` in collateral value scales HF by `(1 - d)`; liquidation triggers at `HF = 1`, so the collateral drop to liquidation is `(1 - 1 / HF) * 100`.

This is a first-order, whole-basket estimate: it assumes all collateral moves together and debt is stable-valued. That assumption is stated in the reasoning rather than implied to be per-asset precision. Deeper solvency signals (liquidation history, account maturity, asset backing) are a planned extension.

## Architecture

```
api/
  risk-check.ts      Vercel function: GET /api/risk-check (the FRAUD_DETECTION verdict)
  health-factor.ts   Vercel function: GET /api/health-factor (underlying signal)
  index.ts           Vercel function: GET / (branded banner + JSON descriptor)
src/
  config.ts          network, RPC, Aave Pool address, tunables
  aave.ts            Pool ABI + getUserAccountData read (block-pinned)
  risk.ts            pure signal math (liquidation distance, labels, freshness)
  verdict.ts         pure verdict mapping (health factor -> ALLOW/RECHECK/BLOCK + reasoning)
  service.ts         orchestrators: wallet -> signal, wallet -> verdict
  types.ts           response contracts
  banner.ts          ASCII banner + service descriptor
scripts/
  spike-aave.ts      one-off validation of the Aave read (dev only)
  dev-serve.ts       local server mirroring the Vercel routes (dev only)
  find-borrower.ts   finds a live Aave borrower for samples (dev only)
  curl-transport.ts  local-only ethers HTTP shim (see Local development)
  risk.test.ts       unit tests for the risk math
  verdict.test.ts    unit tests for the verdict mapping
```

- Data source: Aave v3 on Base mainnet (chain 8453). Reads are free (no gas).
- Telegraph miner registration is separate and lives on Base Sepolia (chain 84532). See `docs/telegraph-registration.md`.
- `ANCHOR_RPC_URL` overrides the default public Base RPC with a private one (Alchemy, Infura, etc.) without a code change.

## Local development

```
npm install
npm run dev        # serve on http://localhost:3000
npm test           # unit tests for the risk + verdict logic
npm run typecheck
```

Note on this dev sandbox: Node's outbound socket egress is firewalled here while `curl` is allowed, so `scripts/curl-transport.ts` routes ethers' HTTP through `curl` for local runs only. Nothing in `src/` or `api/` imports it; production on Vercel uses ethers' default transport. If you develop in a normal network environment, the shim is simply unused.

## Deploy

See the Deploy section of `docs/telegraph-registration.md`. In short: `vercel` to deploy, then complete the Telegraph wizard with the live Base URL.
