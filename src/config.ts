/**
 * Network + protocol configuration.
 *
 * Anchor reads Aave v3 state from Base mainnet (real positions = real ground
 * truth). This is independent of Telegraph's on-chain miner registry, which
 * lives on Base Sepolia. ANCHOR_RPC_URL lets us swap in a private RPC (Alchemy
 * / Infura / etc.) later without a code change.
 */
export const NETWORK = {
  name: "base-mainnet",
  chainId: 8453,
  rpcUrl: process.env.ANCHOR_RPC_URL ?? "https://mainnet.base.org",
} as const;

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
  // Under a Vercel function budget (~10s). Warm calls are ~1.5s; this is headroom
  // for an occasional cold model start before failing gracefully.
  timeoutMs: Number(process.env.ANCHOR_LLM_TIMEOUT_MS ?? 9000),
  // gpt-oss-120b is a REASONING model: it spends completion tokens on hidden
  // reasoning before the answer. "low" keeps that to a minimum so the answer
  // itself is what fills the budget — without it, hard questions burn the whole
  // cap on reasoning and return an EMPTY answer (surfaced as a 503 that scores
  // ~0). Groq gpt-oss accepts: low | medium | high.
  reasoningEffort: process.env.ANCHOR_LLM_REASONING_EFFORT ?? "low",
  // Headroom so reasoning + answer both fit, WITHOUT over-reserving against the
  // Groq free-tier TPM cap (8000 tok/min): the rate limiter charges ~prompt +
  // max_tokens per request, so a needlessly-large cap causes 429s. With
  // reasoning_effort=low the answer itself only runs ~180-290 tokens, so 1024 is
  // ample and keeps TPM usage well under the cap at validator cadence. (512 was
  // the old value that truncated once reasoning ate the budget.)
  maxTokens: Number(process.env.ANCHOR_LLM_MAX_TOKENS ?? 1024),
};

// Data-source tag for a knowledge answer, parallel to SOURCE for the chain path.
export const KNOWLEDGE_SOURCE = "llm-fraud-knowledge";

// A knowledge answer has no block-freshness concept, so confidence is a fixed,
// reasonable value rather than the on-chain freshness decay.
export const KNOWLEDGE_CONFIDENCE = 0.8;
