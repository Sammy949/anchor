# Anchor

Verified on-chain risk data miner for lending protocols. Real-time liquidation-risk and health-factor signals for AI agents, read straight from the chain with per-response freshness metadata.

Built for the Telegraph Protocol Hackathon, Season I, Track 1 (Miner).

Live: https://anchor-pi-nine.vercel.app

## What it does

Given a wallet address, Anchor reads its aggregate Aave v3 position on Base mainnet and returns a derived risk signal, not just a raw number:

- **Health factor** as reported by Aave.
- **Liquidation distance**: how far the collateral can fall before the position becomes liquidatable, computed from health factor and liquidation threshold.
- **Risk label**: a coarse category (SAFE, MODERATE, AT_RISK, CRITICAL, LIQUIDATABLE) an agent can branch on without parsing numbers.
- **Freshness metadata**: the exact block number and timestamp the data was read at, plus a confidence score, so a consuming agent knows how current the signal is.

The ground truth is the chain itself. There is no third-party API in the path.

## Endpoint

```
GET /api/health-factor?wallet=0x<address>
```

### Sample request

```
curl "https://anchor-pi-nine.vercel.app/api/health-factor?wallet=0xA83a8e4A4923Eee175170df78b59103D254F86eF"
```

### Sample response

Real response from Base mainnet (values are live and move block to block):

```json
{
  "wallet": "0xA83a8e4A4923Eee175170df78b59103D254F86eF",
  "protocol": "aave-v3",
  "status": "active",
  "riskLabel": "AT_RISK",
  "healthFactor": 1.1,
  "totalCollateralUSD": 49542.3,
  "totalDebtUSD": 37381.93,
  "liquidationThreshold": 0.83,
  "liquidationDistance": {
    "collateralDropPercentToLiquidation": 9.09,
    "description": "Collateral value would need to drop ~9.09% (uniformly across the collateral basket) to trigger liquidation at current debt levels."
  },
  "confidence": 1,
  "meta": {
    "blockNumber": 49826897,
    "timestamp": "2026-08-11T10:12:21.000Z",
    "source": "aave-v3-pool-contract",
    "chainId": 8453,
    "network": "base-mainnet"
  }
}
```

### Response fields

| Field | Meaning |
| --- | --- |
| `status` | `active` (has debt), `no_debt` (collateral only), or `no_position` (nothing on Aave). |
| `riskLabel` | `SAFE` (HF >= 2), `MODERATE` (1.5 to 2), `AT_RISK` (1.1 to 1.5), `CRITICAL` (1 to 1.1), `LIQUIDATABLE` (< 1), `NONE` (no debt). |
| `healthFactor` | Aave health factor, 4dp. `null` when there is no debt (Aave reports infinite). |
| `liquidationDistance.collateralDropPercentToLiquidation` | Uniform collateral drop that would push HF to 1. `null` when not applicable. |
| `confidence` | Freshness score in `[0.5, 1]`; 1 at the chain head, decaying with block age. |
| `meta.blockNumber` / `meta.timestamp` | The exact block the numbers were read at. The read is pinned to this block, so the signal is reproducible. |

Error cases return a JSON `{ "error": ... }` body with status 400 (bad or missing `wallet`) or 502 (RPC read failure).

## The liquidation-distance math

Aave's health factor is `HF = (collateral * liquidationThreshold) / debt`. A uniform drop `d` in collateral value scales HF by `(1 - d)`. Liquidation triggers at `HF = 1`, so:

```
collateralDropPercentToLiquidation = (1 - 1 / HF) * 100
```

This is a first-order, whole-basket estimate: it assumes all collateral moves together and debt is stable-valued. That assumption is stated in every response's `description` field rather than implied to be per-asset precision. Per-asset sensitivity is a candidate extension, not part of the MVP.

## Architecture

```
api/
  health-factor.ts   Vercel function: GET /api/health-factor
  index.ts           Vercel function: GET / (branded banner + JSON descriptor)
src/
  config.ts          network, RPC, Aave Pool address, tunables
  aave.ts            Pool ABI + getUserAccountData read (block-pinned)
  risk.ts            pure signal math (liquidation distance, labels, freshness)
  service.ts         orchestrator: wallet -> full response
  types.ts           response contract
  banner.ts          ASCII banner + service descriptor
scripts/
  spike-aave.ts      one-off validation of the Aave read (dev only)
  dev-serve.ts       local server mirroring the Vercel routes (dev only)
  curl-transport.ts  local-only ethers HTTP shim (see Local development)
```

- Data source: Aave v3 on Base mainnet (chain 8453). Reads are free (no gas).
- Telegraph miner registration is separate and lives on Base Sepolia (chain 84532). See `docs/telegraph-registration.md`.
- `ANCHOR_RPC_URL` overrides the default public Base RPC with a private one (Alchemy, Infura, etc.) without a code change.

## Local development

```
npm install
npm run dev        # serve on http://localhost:3000
npm test           # unit tests for the risk math
npm run typecheck
```

Note on this dev sandbox: Node's outbound socket egress is firewalled here while `curl` is allowed, so `scripts/curl-transport.ts` routes ethers' HTTP through `curl` for local runs only. Nothing in `src/` or `api/` imports it; production on Vercel uses ethers' default transport. If you develop in a normal network environment, the shim is simply unused.

## Deploy

See the Deploy section of `docs/telegraph-registration.md`. In short: `vercel` to deploy, then complete the Telegraph wizard with the live Base URL.
