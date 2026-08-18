# Telegraph miner registration

Single source of truth for registering Anchor as a Telegraph miner. The dashboard wizard (`Register YAML for Miner`) has three phases (Configure YAML, Upload to IPFS, Register On-Chain) and the YAML has six sections. Fill them with the values below.

Prerequisite: the API must be live first. The wizard needs a real Base URL and a real sample request/response. Deploy (see the end of this doc), then register.

Registry network: Base Sepolia (chain 84532), RPC `https://sepolia.base.org`, explorer `https://sepolia.basescan.org`. Use the dedicated project wallet for registration and payouts. Do not use any personal or other-project wallet.

> **Intent pivot (2026-08-18).** Anchor originally registered under `TVL_LOOKUP`. That was wrong: the canonical `TVL_LOOKUP` scorer grades against a protocol-level total-value-locked figure ("Query names a specific DeFi protocol, pool or chain and asks for the total value locked in it"), while Anchor takes a *wallet* and returns *that wallet's* risk. Input and output both mismatch, so Anchor scored ~0. The Telegraph team (Ahmed) confirmed the mismatch, that Hackathon 1 is fixed to the canonical intent set (no custom intents until after), that scorers are seeded centrally, and that re-registering under a new intent carries no penalty. He recommended `FRAUD_DETECTION` with an ALLOW/RECHECK/BLOCK verdict. Anchor now serves **`FRAUD_DETECTION`** via `/api/risk-check`. `TVL_LOOKUP` is dropped.

---

## Section 1: Basics

| Field | Value |
| --- | --- |
| Integration ID | `anchor-risk-miner` |
| Kind | `miner` |
| Protocol | `generic` (not `bittensor`) |
| Slug | `anchor` |
| Name | `Anchor` |
| Description | On-chain counterparty-risk miner. Given a wallet, returns an ALLOW / RECHECK / BLOCK verdict on whether it is financially safe for an agent to extend credit to or transact with it, derived from live Aave v3 lending-protocol solvency state on Base, with per-response freshness metadata. |
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
GET https://anchor-miner.vercel.app/api/risk-check?wallet=0x50B75AaCb1ed974F5c901a32BeE767de39CBb060
```

Sample response (real, captured from production; the numbers are live and move block to block):

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
    "totalDebtUSD": 32555.71,
    "liquidationThreshold": 0.78
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

Pick a wallet that currently has an active position (non-null health factor) so the verdict is a substantive RECHECK/BLOCK rather than ALLOW. The wallet above was a live Aave v3 borrower (~$55k collateral / ~$33k debt, AT_RISK -> RECHECK) captured on 2026-08-18; verify it still has debt, or grab another active borrower with `scripts/find-borrower.ts`, before capturing.

## Section 4: Semantics

Intent: `FRAUD_DETECTION`, a canonical Telegraph intent (Utilities & Security category). Canonical description: "Query asks how likely a specific entity, transaction or action is to be fraudulent." Anchor serves the on-chain-counterparty slice of it: given a wallet, is it financially safe to transact with. Recommended by the Telegraph team for Anchor.

Field mapping:

| Semantic role | Response field |
| --- | --- |
| label / verdict | `verdict` |
| confidence | `confidence` |
| reason | `reasoning` |

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
      "description": "EVM wallet address to assess for on-chain counterparty risk (Aave v3, Base mainnet)."
    }
  }
}
```

Output schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["wallet", "protocol", "verdict", "reasoning", "signals", "confidence", "meta"],
  "properties": {
    "wallet": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
    "protocol": { "type": "string", "enum": ["aave-v3"] },
    "verdict": { "type": "string", "enum": ["ALLOW", "RECHECK", "BLOCK"] },
    "reasoning": { "type": "string" },
    "signals": {
      "type": "object",
      "required": [
        "riskLabel", "healthFactor", "liquidationDistancePercent",
        "totalCollateralUSD", "totalDebtUSD", "liquidationThreshold"
      ],
      "properties": {
        "riskLabel": {
          "type": "string",
          "enum": ["NONE", "SAFE", "MODERATE", "AT_RISK", "CRITICAL", "LIQUIDATABLE"]
        },
        "healthFactor": { "type": ["number", "null"] },
        "liquidationDistancePercent": { "type": ["number", "null"] },
        "totalCollateralUSD": { "type": "number" },
        "totalDebtUSD": { "type": "number" },
        "liquidationThreshold": { "type": "number" }
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

### Registration record (initial, 2026-08-16, TVL_LOOKUP)

Miner registered successfully on-chain. Staged as **pending**; activated at the next epoch boundary. This registration used the (wrong) `TVL_LOOKUP` intent, see the intent-pivot note at the top of this doc.

| Field | Value |
| --- | --- |
| Status | Confirmed on-chain, activated; superseded by the FRAUD_DETECTION re-registration below |
| Network | Base Sepolia (chain 84532) |
| Registered via | `integrate.telegraphprotocol.com` |
| Tx hash | `0xd43dd72aa613b83a101ad010bafc763ff4d08556461d061c4aa7d5198f8cb22d` |
| Explorer | https://sepolia.basescan.org/tx/0xd43dd72aa613b83a101ad010bafc763ff4d08556461d061c4aa7d5198f8cb22d |
| Registry contract | `0x5a232…87ff8` (truncated from MetaMask; fill full address from the dashboard/explorer) |
| Integration ID | `anchor-risk-miner` |

TODO: paste the full registry contract address and the assigned integration address once the explorer/dashboard shows them.

### Re-registration record (FRAUD_DETECTION) — done 2026-08-18

Re-registered on-chain via the full wizard (Configure YAML → Upload to IPFS → Register). The Edit flow issues a new registrationId under the hood, so the wizard and Edit reach the same on-chain action; the newest registration for slug `anchor` (id 49) + the project wallet is the live one. Confirmed on-chain, staged pending → activates at the next epoch boundary. Verified live: Anchor now lists under FRAUD_DETECTION on devnode and no longer under TVL_LOOKUP.

| Field | Value |
| --- | --- |
| Status | Confirmed on-chain, pending → activates next epoch |
| Intent | `FRAUD_DETECTION` |
| Endpoint | `/api/risk-check` |
| Network | Base Sepolia (chain 84532) |
| Registered via | `integrate.telegraphprotocol.com` (full wizard) |
| Tx hash | `0x496ba72f85d5ce38…9798bd61` (partial from confirmation; fill full hash from wallet/explorer) |
| YAML IPFS URL | `https://gateway.pinata.cloud/ipfs/QmRX4WJYetq27YxFCZVbQjiaD9fgayGUECB7LAATuzCVoH` |
| YAML SHA-256 | `0xb72601e0c657bb3d031c0c8f90dbf7732afc434b4b338defc4a4fe8d1a103cb2` (verified against pinned bytes) |
| Fee address | `0xC3d33eB15B59a092cC5663fAdF5BcAeBa5afF010` |
| Floor price | `0.01` USDC |

TODO: paste the full tx hash from the wallet/explorer (confirmation showed it truncated).
