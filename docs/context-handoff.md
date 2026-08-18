# Anchor — context handoff (as of 2026-08-18)

A catch-up brief for the chat where Anchor was originally brainstormed. Everything below is current and verified live, not planned.

## What Anchor is

Anchor is a **Telegraph Protocol** hackathon miner (Season I, Track 1 / Miner). Telegraph is a decentralized network where "miners" answer typed inference requests ("intents") and validators score the answers against a centrally-seeded ground truth using per-intent WASM scoring scripts. Agents pay per call.

Anchor's product, in one line: **given a wallet address, is it financially safe for an AI agent to extend credit to, lend to, or transact with it?** It answers with a three-valued verdict, **ALLOW / RECHECK / BLOCK**, plus plain-language reasoning, derived from that wallet's live **Aave v3** lending-position solvency (health factor, liquidation proximity) read straight from the chain on **Base mainnet**. No third-party API in the path. The chain is the ground truth.

- Repo: github.com/Sammy949/anchor  (owner GitHub: Sammy949)
- Live: https://anchor-miner.vercel.app
- Endpoint: `GET /api/risk-check?wallet=0x<address>`  → verdict + reasoning + signals + freshness meta
- Also exposed: `GET /api/health-factor?wallet=0x<address>`  → the underlying raw liquidation-risk signal
- Stack: TypeScript (strict), ethers v6.13.1 pinned, Vercel serverless. Reads Aave v3 Pool `getUserAccountData` on Base (chain 8453). Registry is separate, on Base Sepolia (chain 84532).

## The scoring model (why any of this matters)

Track 1 grade = **75% normalized performance within your intent** (your avg score / the best avg score in the same intent; best-in-intent gets full marks) + **25% X engagement** (every update post must tag @Telegraphprotoc). New miners get a **7-day grace period**: no leaderboard slot, 5% of routed traffic shared equally, and the score earned in grace sets your starting leaderboard rank. An intent only pays cash prizes with ≥3 miners AND ≥100 real Track-3 requests. Uptime must hold through ~Sep 7 (Track 3 end).

## What happened today (the arc)

1. **Symptom:** Anchor showed 0 requests / 0.000 score / 0 epochs on the explorer despite being "Active."
2. **First finding (not a bug):** that's expected for a day-2 grace-period miner. Fine.
3. **Real finding (the important one):** Anchor was registered under the canonical intent **`TVL_LOOKUP`**, whose scorer grades against a **protocol-level total-value-locked dollar figure** ("total value locked in a named DeFi protocol/pool/chain"). Anchor takes a **wallet** and returns **that wallet's risk**. Both input and output mismatch, so Anchor would score **~0 no matter how correct its data was**. A live competitor there (miner 301, "TVL Oracle") confirmed the expected shape. The lesson worth keeping: **a data feed can be 100% correct and still score zero if it answers the wrong question.**
4. **Confirmed with the Telegraph team (Ahmed, Discord):** Hackathon 1 uses the fixed canonical intent set only (custom intents like a dedicated LIQUIDATION_RISK_CHECK come *after* the hackathon); ground truths + WASM scorers are seeded centrally (miners don't author scoring); **re-registering under a new intent carries no penalty**; and his recommendation was to serve **`FRAUD_DETECTION`** and map the health factor into an ALLOW/RECHECK/BLOCK verdict.
5. **Decision: play to win, not place.** That meant *focus* one intent rather than hedge across several (being #1-in-intent drives the 75%, and there was no viable second intent anyway: ONCHAIN_TX_LOOKUP wants a tx hash, WALLET_BALANCE_CHECK has only 1 miner so fails the ≥3 prize guardrail). Dropped TVL_LOOKUP entirely. Built the *fuller* Anchor: on-chain **counterparty solvency risk**, owning the on-chain-wallet slice of FRAUD_DETECTION that no competitor touches (the others do email reputation, IP risk, agent-evidence firewalling).
6. **Built + shipped Phase 1 same day:** new `/api/risk-check` verdict endpoint (pure mapping over the existing Aave read, no extra RPC), typecheck + 14 unit tests green, live-smoke-verified on Base mainnet, deployed to production.
7. **Re-registered on-chain** under FRAUD_DETECTION. Confirmed. devnode now lists Anchor (id 49) under FRAUD_DETECTION and no longer under TVL_LOOKUP.

## Current live state

- **Intent:** FRAUD_DETECTION (5 miners total; Anchor is the only on-chain-wallet-risk one). Off TVL_LOOKUP.
- **Re-registration tx (Base Sepolia):** `0x496ba72f85d5ce381f52f4e3231f4d51ebc0812a714c2b9de7059e879798bd61` (confirmed, block 45654149; submitted via a sponsored/relayer path). YAML pinned at IPFS `QmRX4WJYetq27YxFCZVbQjiaD9fgayGUECB7LAATuzCVoH`, SHA-256 verified against the pinned bytes.
- **Status:** staged pending → activates at the next epoch boundary. Grace period runs ~through 2026-08-23; the score earned in grace sets the starting leaderboard rank.
- **Verdict mapping:** SAFE/MODERATE + no-debt/no-position → ALLOW; AT_RISK → RECHECK; CRITICAL/LIQUIDATABLE → BLOCK. Reasoning always names the defect + next step.

### Real sample response (live, Base mainnet)
```json
{
  "wallet": "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060",
  "protocol": "aave-v3",
  "verdict": "RECHECK",
  "reasoning": "Counterparty holds an active Aave v3 position ~24.7% from liquidation (health factor 1.33). Collateral buffer is thin; re-verify solvency or require added margin before extending credit.",
  "signals": { "riskLabel": "AT_RISK", "healthFactor": 1.33, "liquidationDistancePercent": 24.7,
               "totalCollateralUSD": 55409.75, "totalDebtUSD": 32555.78, "liquidationThreshold": 0.78 },
  "confidence": 0.99,
  "meta": { "blockNumber": 50142644, "timestamp": "2026-08-18T17:37:15.000Z",
            "source": "aave-v3-pool-contract", "chainId": 8453, "network": "base-mainnet" }
}
```

## What's next (open threads)

- **Watch for the first real FRAUD_DETECTION scores in grace.** Big open unknown: the seeded FRAUD_DETECTION ground truth is not visible to us, so it's genuinely untested whether a *solvency* verdict scores well against whatever the scorer checks (it might lean toward scam/blocklist signals). Phase 1 exists precisely to test fit cheaply before investing more. If scores come back weak, adapt.
- **X post (25% of the grade):** a draft is ready announcing the pivot, lead angle is the "correct data, zero score" intent-fit lesson, tagging @Telegraphprotoc. Not yet posted.
- **Phase 2 (only after real scores justify it):** deepen the solvency panel with more pure-on-chain signals, liquidation history (Aave `LiquidationCall` events), account maturity (tx count), asset backing (native + token balances). Fuse into the verdict.
- **Reliability (un-defer once being scored):** set a private `ANCHOR_RPC_URL` (Alchemy/Infura) + fallback/timeout. Spot checks run ~every 20s and a >20% score drop triggers immediate Routing Revocation, so a cold-start RPC timeout is a real risk once scored. Currently on the public Base RPC (~1.1s warm, ~6s cold).
- **Post-hackathon:** Ahmed said the team would add a dedicated liquidation-risk intent later, which is Anchor's true-native home.

## Honest caveats

- Anchor owns *on-chain counterparty solvency risk*, deliberately NOT scam/drainer detection (that needs curated off-chain lists and breaks the pure-on-chain thesis). If grace scores prove the ground truth demands scam signals, revisit.
- No score or ranking exists yet (grace period), so any "we're winning" claim would be false today.
- The verdict is a first-order, whole-basket liquidation estimate (assumes uniform collateral move, stable-valued debt); that assumption is stated in every response.
