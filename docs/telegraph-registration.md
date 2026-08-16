# Telegraph miner registration

Single source of truth for registering Anchor as a Telegraph miner. The dashboard wizard (`Register YAML for Miner`) has three phases (Configure YAML, Upload to IPFS, Register On-Chain) and the YAML has six sections. Fill them with the values below.

Prerequisite: the API must be live first. The wizard needs a real Base URL and a real sample request/response. Deploy (see the end of this doc), then register.

Registry network: Base Sepolia (chain 84532), RPC `https://sepolia.base.org`, explorer `https://sepolia.basescan.org`. Use the dedicated project wallet for registration and payouts. Do not use any personal or other-project wallet.

---

## Section 1: Basics

| Field | Value |
| --- | --- |
| Integration ID | `anchor-risk-miner` |
| Kind | `miner` |
| Protocol | `generic` (not `bittensor`) |
| Slug | `anchor` |
| Name | `Anchor` |
| Description | Verified on-chain risk data miner. Real-time liquidation-risk and health-factor signals for lending positions (Aave v3 on Base), with per-response freshness metadata so agents can trust how current the signal is. |
| Repo / docs / website | link the deployment root URL and the repo. |

## Section 2: Connection

| Field | Value |
| --- | --- |
| Base URL | `https://anchor-miner.vercel.app` (live production alias) |
| Auth type | `none` (public read-only verifiable feed) |
| Rate limit | conservative to start, e.g. 60 req/min |
| Cache TTL | 12 seconds (matches the `Cache-Control` the API sets) |
| Circuit breaker | leave defaults |

## Section 3: Endpoints

Paste a real request and response captured from the live deployment (not localhost). Telegraph auto-generates the schema from this example.

Sample request:

```
GET https://anchor-miner.vercel.app/api/health-factor?wallet=0x50B75AaCb1ed974F5c901a32BeE767de39CBb060
```

Sample response (real, captured from production; the numbers are live and move block to block):

```json
{
  "wallet": "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060",
  "protocol": "aave-v3",
  "status": "active",
  "riskLabel": "AT_RISK",
  "healthFactor": 1.3699,
  "totalCollateralUSD": 53480.93,
  "totalDebtUSD": 30450.98,
  "liquidationThreshold": 0.78,
  "liquidationDistance": {
    "collateralDropPercentToLiquidation": 27,
    "description": "Collateral value would need to drop ~27.00% (uniformly across the collateral basket) to trigger liquidation at current debt levels."
  },
  "confidence": 0.989,
  "meta": {
    "blockNumber": 50047225,
    "timestamp": "2026-08-16T12:36:37.000Z",
    "source": "aave-v3-pool-contract",
    "chainId": 8453,
    "network": "base-mainnet"
  }
}
```

Pick a wallet that currently has an active position (non-null health factor) so the auto-generated schema captures the populated shape. The wallet above was a live Aave v3 borrower (~$53k collateral / ~$30k debt, AT_RISK) captured on 2026-08-16; verify it still has debt, or grab another active borrower with `scripts/find-borrower.ts`, before capturing.

## Section 4: Semantics

Intent: `TVL_LOOKUP`, a canonical Telegraph intent (On-Chain Analytics category, Tier A / WASM Exact Match scoring). Confirmed by the Telegraph team as the correct intent for Anchor.

Ground truth is confirmed broad, not strict-TVL-only: the team confirmed broader on-chain intelligence is supported here. Anchor's existing response shape (risk label, health factor, liquidation distance, confidence) is accepted as-is, so no fields need to be added or renamed to fit the intent.

Field mapping:

| Semantic role | Response field |
| --- | --- |
| label | `riskLabel` |
| confidence | `confidence` |
| reason | `liquidationDistance.description` |

## Section 5: On-Chain layout

Skip for MVP (optional section). Revisit if time allows.

## Section 6: Advanced

Formal schemas mirroring the real implementation.

Input schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["wallet"],
  "properties": {
    "wallet": {
      "type": "string",
      "pattern": "^0x[a-fA-F0-9]{40}$",
      "description": "EVM wallet address to assess on Aave v3 (Base mainnet)."
    }
  }
}
```

Output schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "wallet", "protocol", "status", "riskLabel", "healthFactor",
    "totalCollateralUSD", "totalDebtUSD", "liquidationThreshold",
    "liquidationDistance", "confidence", "meta"
  ],
  "properties": {
    "wallet": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
    "protocol": { "type": "string", "enum": ["aave-v3"] },
    "status": { "type": "string", "enum": ["active", "no_debt", "no_position"] },
    "riskLabel": {
      "type": "string",
      "enum": ["NONE", "SAFE", "MODERATE", "AT_RISK", "CRITICAL", "LIQUIDATABLE"]
    },
    "healthFactor": { "type": ["number", "null"] },
    "totalCollateralUSD": { "type": "number" },
    "totalDebtUSD": { "type": "number" },
    "liquidationThreshold": { "type": "number" },
    "liquidationDistance": {
      "type": "object",
      "required": ["collateralDropPercentToLiquidation", "description"],
      "properties": {
        "collateralDropPercentToLiquidation": { "type": ["number", "null"] },
        "description": { "type": "string" }
      }
    },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "meta": {
      "type": "object",
      "required": ["blockNumber", "timestamp", "source", "chainId", "network"],
      "properties": {
        "blockNumber": { "type": "integer" },
        "timestamp": { "type": "string", "format": "date-time" },
        "source": { "type": "string" },
        "chainId": { "type": "integer" },
        "network": { "type": "string" }
      }
    }
  }
}
```

---

## Deploy (do this before registering)

The Vercel CLI is available. Deploy needs your Vercel auth.

```
# one-time auth (run in the session with the ! prefix, or set VERCEL_TOKEN)
vercel login

# from the project root
vercel            # preview deploy; follow prompts to link the project
vercel --prod     # production deploy -> stable *.vercel.app URL
```

Optional: set a private RPC to reduce reliance on the public endpoint.

```
vercel env add ANCHOR_RPC_URL
```

After deploy, smoke-test the live URL, then capture the Section 3 sample from it:

```
curl "https://<deployment>.vercel.app/api/health-factor?wallet=0x<active-borrower>"
```

## Phases 2 and 3: IPFS and On-Chain

1. Upload the completed YAML to IPFS via the wizard.
2. Register on-chain on Base Sepolia using the dedicated project wallet (needs a little Base Sepolia ETH for gas).
3. Record the resulting integration address / tx here once done.

### Registration record (done 2026-08-16)

Miner registered successfully on-chain. Staged as **pending**; activates at the next epoch boundary (Telegraph nodes pick it up automatically, no restart).

| Field | Value |
| --- | --- |
| Status | Confirmed on-chain, pending → activates next epoch |
| Network | Base Sepolia (chain 84532) |
| Registered via | `integrate.telegraphprotocol.com` |
| Tx hash | `0xd43dd72aa613b83a101ad010bafc763ff4d08556461d061c4aa7d5198f8cb22d` |
| Explorer | https://sepolia.basescan.org/tx/0xd43dd72aa613b83a101ad010bafc763ff4d08556461d061c4aa7d5198f8cb22d |
| Registry contract | `0x5a232…87ff8` (truncated from MetaMask; fill full address from the dashboard/explorer) |
| Integration ID | `anchor-risk-miner` |

TODO: paste the full registry contract address and the assigned integration address once the explorer/dashboard shows them.
