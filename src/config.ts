/**
 * Network + protocol configuration.
 *
 * Anchor reads Aave v3 state from Base mainnet (real positions = real ground
 * truth). This is independent of Telegraph's on-chain miner registry, which
 * lives on Base Sepolia.
 *
 * RPC reliability: the wallet-read path runs against a PRIVATE endpoint first
 * (Alchemy / Infura / etc. via ANCHOR_RPC_URL), with the PUBLIC Base RPC kept
 * as a fallback. A private-endpoint outage, rate-limit, or timeout during a
 * live validator spot-check therefore degrades to the public RPC instead of
 * failing the read. When ANCHOR_RPC_URL is unset we run on the public RPC alone
 * (the previous behavior). See src/provider.ts for the fallback runner.
 */
export const NETWORK = {
  name: "base-mainnet",
  chainId: 8453,
} as const;

// Public Base mainnet RPC — no uptime/latency guarantees, so it's the fallback,
// never the sole primary in production (set ANCHOR_RPC_URL for that).
const PUBLIC_BASE_RPC = "https://mainnet.base.org";

// Ordered, deduped RPC endpoints: private primary first (when ANCHOR_RPC_URL is
// set), public fallback last. Deduped so an accidental ANCHOR_RPC_URL that
// equals the public URL doesn't produce two identical attempts.
const privateRpc = process.env.ANCHOR_RPC_URL?.trim() || undefined;
export const RPC_URLS: string[] = [
  ...new Set([privateRpc, PUBLIC_BASE_RPC].filter((u): u is string => !!u)),
];

// Per-endpoint timeout for an on-chain read. Short enough that a hung or slow
// RPC fails fast and falls back well inside Vercel's ~10s function budget; long
// enough that a normal warm read (~200-500ms) never trips it. Override with
// ANCHOR_RPC_TIMEOUT_MS.
export const RPC_TIMEOUT_MS = Number(process.env.ANCHOR_RPC_TIMEOUT_MS ?? 4000);

// Aave v3 Pool (proxy) on Base mainnet.
// Verified: BaseScan "Aave: Pool Proxy Base" + aave-dao/aave-address-book AaveV3Base.POOL.
export const AAVE_V3_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";

export const PROTOCOL = "aave-v3";
export const SOURCE = "aave-v3-pool-contract";

// Aave v3 unit conventions: base currency (oracle) is USD with 8 decimals;
// liquidation threshold / LTV are basis points (1e4); health factor is 1e18.
export const USD_DECIMALS = 8;
export const BPS_DECIMALS = 4;
export const HF_DECIMALS = 18;

// Health-factor data does not need sub-second freshness; a short edge cache
// cuts RPC load without meaningfully staling the signal.
export const CACHE_TTL_SECONDS = 12;

// Confidence is a freshness score: it decays from 1 toward the floor as the
// read block's age approaches this horizon.
export const STALENESS_HORIZON_SECONDS = 60;
export const CONFIDENCE_FLOOR = 0.5;

/**
 * Knowledge path (Telegraph FRAUD_DETECTION general-knowledge questions).
 *
 * When a request carries no wallet to analyze, Anchor answers the fraud-domain
 * question from an LLM instead of the chain. Groq's OpenAI-compatible endpoint,
 * with the model Samuel already uses elsewhere. GROQ_API_KEY must be set in the
 * environment (Vercel + local) for this path to work; the on-chain wallet path
 * has no such dependency.
 */
export const GROQ = {
  apiUrl: process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1/chat/completions",
  // Default chosen from what the project's Groq key can actually serve (the
  // originally-specified llama-3.3-70b-versatile is not available on this key).
  // gpt-oss-120b: most capable general model offered, ~1.5s warm, clean answers.
  // Override per-env with ANCHOR_LLM_MODEL (e.g. groq/compound-mini).
  model: process.env.ANCHOR_LLM_MODEL ?? "openai/gpt-oss-120b",
  // Read lazily so the key can be set (or swapped in tests) after import, and so
  // a missing key surfaces as a clean runtime error, not a module-load crash.
  get apiKey(): string {
    return process.env.GROQ_API_KEY ?? "";
  },
  // Bound a single call. MEASURED (14 runs across every observed question shape):
  // Groq's free tier is highly variable — 1.4s, 1.6s, 1.7s, 1.9s, 2.2s, 2.6s,
  // 4.0s, 4.1s, 5.3s, 6.1s, 7.5s, 11.3s. The spread is queueing/load, not answer
  // length, so a tight per-call timeout does NOT pay off while a timeout is a
  // hard failure: groqFetchOnce currently only retries on 429, so any timeout is
  // an immediate 503 that scores 0. Keep this generous until timeout-retry exists
  // (then a ~4000ms bound plus a second attempt beats one long wait, since ~70%
  // of attempts land under 4.5s).
  timeoutMs: Number(process.env.ANCHOR_LLM_TIMEOUT_MS ?? 8000),
  // Overall budget for the whole answer sequence (initial call + any 429 backoff
  // + retry), kept under Vercel's 10s function cap so we always return something
  // rather than being killed mid-flight.
  totalBudgetMs: Number(process.env.ANCHOR_LLM_TOTAL_BUDGET_MS ?? 8500),
  // gpt-oss-120b is a REASONING model: it spends completion tokens on hidden
  // reasoning before the answer. "low" keeps that to a minimum so the answer
  // itself is what fills the budget — without it, hard questions burn the whole
  // cap on reasoning and return an EMPTY answer (surfaced as a 503 that scores
  // ~0). Groq gpt-oss accepts: low | medium | high, but "medium" was measured
  // burning all 600 tokens on reasoning and returning EMPTY content — keep "low".
  reasoningEffort: process.env.ANCHOR_LLM_REASONING_EFFORT ?? "low",
  // Sized from MEASURED completion lengths, not guessed headroom. Groq's rate
  // limiter charges ~prompt + max_tokens against the free-tier TPM cap (8000
  // tok/min for the gpt-oss models), so an oversized cap manufactures its own
  // 429s — which is exactly what scored 0.000 in past epochs. Under the current
  // prompt real completions run 182-395 tokens (all finishing cleanly), so 400
  // was too tight to be safe: 512 clears the observed ceiling with margin while
  // still cutting the TPM charge ~40% vs the old 1024. (512 truncated back when
  // reasoning_effort was unset and hidden reasoning ate the budget; with
  // effort=low that no longer applies.)
  maxTokens: Number(process.env.ANCHOR_LLM_MAX_TOKENS ?? 512),
  // On a 429 (free-tier TPM exhausted) wait for the rate window to clear and retry
  // once, rather than returning an empty answer the validator scores 0. One retry
  // fits inside Vercel's 10s function budget alongside the call timeout.
  maxRetries: Number(process.env.ANCHOR_LLM_MAX_RETRIES ?? 1),
  // Cap the 429 backoff so a large "try again in Ns" hint can't blow the budget.
  retryMaxWaitMs: Number(process.env.ANCHOR_LLM_RETRY_MAX_WAIT_MS ?? 4000),
};

// Data-source tag for a knowledge answer, parallel to SOURCE for the chain path.
export const KNOWLEDGE_SOURCE = "llm-fraud-knowledge";

// A knowledge answer has no block-freshness concept, so confidence is a fixed,
// reasonable value rather than the on-chain freshness decay.
export const KNOWLEDGE_CONFIDENCE = 0.8;
