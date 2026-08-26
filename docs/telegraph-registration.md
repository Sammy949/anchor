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

Re-registered on-chain under FRAUD_DETECTION. The registry uses a supersede model: only the newest registration for the slug is active, earlier ones show as SUPERSEDED (inactive, no traffic). Editing/re-registering issues a new registration ID rather than updating in place, so the registry lists the full history.

**Active registration: Reg #117** (this is the durable identifier). Superseded: Reg #116 (an earlier FRAUD_DETECTION attempt the same evening) and Reg #93 (the original TVL_LOOKUP registration, 2026-08-16). Do not deregister the superseded rows (already inactive) and do not re-Edit #117 (correct as-is; re-editing restarts the grace clock). Verified live: Anchor (id 49) lists under FRAUD_DETECTION on devnode and no longer under TVL_LOOKUP.

| Field | Value |
| --- | --- |
| Active registration | **Reg #117** |
| Superseded | Reg #116 (FRAUD_DETECTION), Reg #93 (TVL_LOOKUP) |
| Status | Active registration confirmed on-chain, pending → activates next epoch |
| Intent | `FRAUD_DETECTION` |
| Endpoint | `/api/risk-check` |
| Network | Base Sepolia (chain 84532) |
| Registered via | `integrate.telegraphprotocol.com` (submitted via relayer path) |
| Tx hash (from confirmation) | `0x496ba72f85d5ce381f52f4e3231f4d51ebc0812a714c2b9de7059e879798bd61` (real on-chain tx, block 45654149; the confirmation-screen hash — precise binding to Reg #117 vs #116 not verifiable from here due to the relayer path + indexer lag, so Reg #117 is the authoritative pointer) |
| Explorer | https://sepolia.basescan.org/tx/0x496ba72f85d5ce381f52f4e3231f4d51ebc0812a714c2b9de7059e879798bd61 |
| YAML IPFS URL | `https://gateway.pinata.cloud/ipfs/QmRX4WJYetq27YxFCZVbQjiaD9fgayGUECB7LAATuzCVoH` |
| YAML SHA-256 | `0xb72601e0c657bb3d031c0c8f90dbf7732afc434b4b338defc4a4fe8d1a103cb2` (verified against pinned bytes; matches Reg #117 in the UI) |
| Fee address | `0xC3d33eB15B59a092cC5663fAdF5BcAeBa5afF010` |
| Floor price | `0.01` USDC |

Note: grace period runs 7 days from the active registration (~through 2026-08-25 given the 8/18 re-registration). No score existed under the old registrations, so the reset is immaterial and well within the Sep 7 uptime window.

> **Superseded by Reg #223 (2026-08-26).** Reg #117 is no longer the active registration — see the record below.

### Re-registration record (add `query` knowledge path + widened schema) — done 2026-08-26

Re-registered to advertise the `query` input field so the router forwards natural-language fraud-knowledge questions (previously only `wallet` was declared, so the LLM knowledge path was never reached via routing — the root cause diagnosed from explorer data). Also widened `output_schema` to accept the knowledge response shape and dropped the `on_chain` layout block (verifiability nicety; not read by the scorer, and it nulled out on knowledge responses). Ahmed confirmed a same-intent schema edit carries no lasting penalty (ranking recomputes each epoch on real answer quality). No code changed — the endpoint already handled `query`.

**Active registration: Reg #223.** Superseded: Reg #117, #116 (FRAUD_DETECTION), #93 (TVL_LOOKUP). Do not re-Edit #223.

| Field | Value |
| --- | --- |
| Active registration | **Reg #223** |
| Superseded | Reg #117, #116 (FRAUD_DETECTION), #93 (TVL_LOOKUP) |
| Status | Confirmed on-chain; staged pending, activates ~1 min after the registration event (no epoch wait) |
| Intent | `FRAUD_DETECTION` |
| Endpoint | `/api/risk-check` (GET; accepts `wallet` or `query`) |
| Network | Base Sepolia (chain 84532) |
| Registered via | `integrate.telegraphprotocol.com` |
| Registry contract | `0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8` (full address, previously truncated) |
| Tx hash | `0x0cbf8f4826b5e111…00fa8f85` (confirmation screen; paste full hash from explorer) |
| YAML IPFS URL | `https://gateway.pinata.cloud/ipfs/QmYQrvTDePcPToADsWdvEZzqmpFmGk9EqDKKjUpYPpMDKF` |
| YAML SHA-256 | `0x8f4dfb20e1e1b710028b709e628b56409a3ed2b3582f2bddca2d2c19415f8700` (authoritative; matches the on-chain hash) |
| Fee address | `0xC3d33eB15B59a092cC5663fAdF5BcAeBa5afF010` |
| Floor price | `0.01` USDC |

Verified: fetched the pinned YAML back from IPFS and confirmed it carries all three changes (`query` in `input_schema`, `INFO` + nullable types in `output_schema`, no `on_chain`).

**Caveat — the wizard re-serialized the YAML.** The pinned bytes are not identical to the local `telegraph/miner.yaml`: the wizard parsed and re-emitted the YAML (inline lists/flow scalars became block form; long descriptions became folded `>` scalars). So the pinned SHA-256 (`0x8f4d…`) differs from `sha256sum telegraph/miner.yaml` (`d811…`) even though the content is equivalent — do not expect the local file to reproduce the on-chain hash. One real defect from the re-emit: the string `"null"` in each nullable `type: [string, "null"]` was written back as a bare YAML `null` **value** (`- null`), which is technically malformed JSON-Schema (a `type` array element must be the string `"null"`). Impact is almost certainly benign because scoring reads the `verdict`/`reasoning`/`confidence` signal mapping (all valid on both paths), not a strict full-response schema validation. If knowledge queries do not begin scoring after indexing, this is the prime suspect — the emitter-proof fix is to drop the `type` key entirely on `wallet`/`protocol`/`signals` (leave them unconstrained and non-required) so there is no `"null"` for the wizard to mangle, then re-pin.

**Verified live 2026-08-26** (paid direct calls via `scripts/ask.ts`, testnet USDC, over the Telegraph node): devnode lists Anchor #49 active under FRAUD_DETECTION serving the Reg #223 YAML (input props `[query, wallet]`, `verdict` enum incl. `INFO`), and #117/#116 show SUPERSEDED. `POST /engine/v1/ask/49` with `payload: {wallet}` → `verdict: ALLOW`; with `payload: {query: "Who was behind the BitConnect Ponzi scheme?"}` → `verdict: INFO` + a real LLM answer (`source: llm-fraud-knowledge`). Both paths answer correctly over the wire. The `null`-in-type re-serialization caveat proved benign — devnode parsed the schema cleanly. Note: the node's **auto-router** `/engine/v1/ask` (LLM intent classification via litellm→AWS Bedrock) was returning HTTP 500 `BedrockException validation_error` for all queries during this test — a Telegraph-side infra issue that blocks organic routing but not direct calls and not spot-check scoring.
