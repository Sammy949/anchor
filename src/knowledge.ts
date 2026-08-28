import { GROQ, KNOWLEDGE_CONFIDENCE, KNOWLEDGE_SOURCE } from "./config.js";
import type { KnowledgeResponse } from "./types.js";

/**
 * Knowledge path for the Telegraph FRAUD_DETECTION intent.
 *
 * When a request carries no wallet, the question is a general fraud-domain one
 * ("What characterized the OneCoin Ponzi scheme?") rather than an on-chain
 * solvency check. Anchor answers it with an LLM (Groq) and formats the answer
 * into its existing response shape, so it is a complete FRAUD_DETECTION
 * responder while its on-chain wallet path stays exactly as it was.
 *
 * Split into a pure shaper (unit-tested) and a thin network call (Groq), wired
 * together by getKnowledgeAnswer. The LLM call is injectable so the router and
 * tests never need the network or a real API key.
 */

/** Thrown when the knowledge path is asked for but not usable (e.g. no key). */
export class KnowledgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeUnavailableError";
  }
}

/** A function that answers a fraud-domain question. Injectable for testing. */
export type Completer = (question: string) => Promise<string>;

/**
 * Why this prompt is shaped the way it is (measured, not guessed).
 *
 * Answers are compared against an authoritative source summary that is dense
 * with hard facts, and a downstream layer PARAPHRASES our answer down to ~2
 * sentences before it is compared. A long answer therefore loses its specifics
 * in compression: a 7-sentence reply whose figures sat in sentences 3-5 came
 * back as "raised significant funds", while a short reply that put "more than
 * $700 million" and every named principal in sentence 1 kept them intact.
 *
 * So the instructions optimize for DENSITY EARLY, not completeness: cap the
 * length, front-load every figure and full name, and ban qualitative
 * substitutes for numbers. Shorter and harder beats longer and fuller here.
 *
 * On accuracy: this model will confidently state a wrong year (observed
 * "convicted January 2024" for a January 2022 conviction, even at temperature
 * 0). Instructing it to OMIT an uncertain figure rather than guess reduces that,
 * though it does not eliminate it. Never trade a hallucinated specific for a
 * missing one — a wrong number is worse than no number.
 */
const SYSTEM_PROMPT =
  "You are Anchor, a fraud-detection knowledge service. Answer the user's " +
  "question about the fraud case, scheme, scam, or financial-crime topic it " +
  "names, factually and accurately.\n\n" +
  "Your answer is read by a machine that compresses it to about two sentences, " +
  "so FRONT-LOAD the hard specifics into the first two sentences: the full name " +
  "of every principal involved (including co-conspirators, not just the most " +
  "famous name), exact dollar amounts, specific years and dates, the charging " +
  "agency or regulator, counts of conviction, and sentence lengths. Then state " +
  "the mechanism plainly and how it ended.\n\n" +
  "Always prefer a concrete figure to a qualitative word: write \"raised more " +
  "than $700 million\", never \"raised significant funds\". If you are not " +
  "confident of a particular date, amount, or count, omit it rather than " +
  "guessing — never invent a figure.\n\n" +
  "Hard limit: at most 4 sentences and under 110 words. No preamble, no " +
  "disclaimers, no hedging, no commentary about data or sources. Return only " +
  "the substantive answer.";

/**
 * Pure: build the knowledge-path response from an LLM answer. Same top-level
 * field names as RiskCheckResponse; the fields that don't apply to a knowledge
 * answer are null (see KnowledgeResponse). `nowMs` is injectable so the shape is
 * deterministic under test.
 */
export function shapeKnowledgeResponse(answer: string, nowMs: number = Date.now()): KnowledgeResponse {
  return {
    wallet: null,
    protocol: null,
    verdict: "INFO",
    reasoning: answer.trim(),
    signals: null,
    confidence: KNOWLEDGE_CONFIDENCE,
    meta: {
      blockNumber: null,
      timestamp: new Date(nowMs).toISOString(),
      source: KNOWLEDGE_SOURCE,
      model: GROQ.model,
    },
  };
}

/**
 * Parse how long to wait before retrying a 429, from the `Retry-After` header
 * (seconds) or Groq's body hint ("Please try again in 3.51s."). Falls back to a
 * small default, and is clamped to [250ms, GROQ.retryMaxWaitMs] with a little
 * buffer so we retry just *after* the window clears, never before.
 */
export function retryDelayMs(retryAfterHeader: string | null, body: string): number {
  let seconds = NaN;
  if (retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))) {
    seconds = Number(retryAfterHeader);
  } else {
    const m = body.match(/try again in\s+([\d.]+)\s*s/i);
    if (m) seconds = Number(m[1]);
  }
  const base = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 250 : 1500;
  return Math.min(Math.max(base, 250), GROQ.retryMaxWaitMs);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One Groq call, bounded by `timeoutMs`. Throws KnowledgeUnavailableError on
 * network failure or timeout; returns the raw Response otherwise (caller checks
 * status). */
async function groqFetchOnce(question: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(GROQ.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
        temperature: 0.2, // low: factual recall, not creativity
        reasoning_effort: GROQ.reasoningEffort, // minimize hidden reasoning so the answer survives the token budget
        max_tokens: GROQ.maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new KnowledgeUnavailableError(`Knowledge LLM timed out after ${timeoutMs}ms`);
    }
    throw new KnowledgeUnavailableError(
      `Knowledge LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call Groq's OpenAI-compatible chat completions endpoint and return the answer
 * text. Retries once on a 429 (free-tier TPM exhausted) after the rate window
 * clears — otherwise a rate-limited validator spot-check would get an empty
 * answer and score 0. Each attempt is bounded by GROQ.timeoutMs and the whole
 * sequence by GROQ.totalBudgetMs, so it always returns inside Vercel's 10s
 * function cap rather than being killed mid-flight. Fails loudly with a typed
 * error.
 */
export async function callGroq(question: string): Promise<string> {
  if (!GROQ.apiKey) {
    throw new KnowledgeUnavailableError(
      "Knowledge path unavailable: GROQ_API_KEY is not set. Set it in the environment to answer fraud-knowledge questions.",
    );
  }

  const deadline = Date.now() + GROQ.totalBudgetMs;
  const maxAttempts = Math.max(1, GROQ.maxRetries + 1);
  let last429 = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Bound the single call, but never wait past the overall budget.
    const res = await groqFetchOnce(question, Math.min(GROQ.timeoutMs, remaining));

    if (res.status === 429) {
      last429 = await res.text().catch(() => "");
      // Retry only if there's another attempt AND enough budget for the backoff
      // plus a follow-up call (~2s). Otherwise fail cleanly as rate-limited.
      if (attempt < maxAttempts) {
        const waitMs = retryDelayMs(res.headers.get("retry-after"), last429);
        if (waitMs + 2000 <= deadline - Date.now()) {
          await sleep(waitMs);
          continue;
        }
      }
      throw new KnowledgeUnavailableError(
        `Knowledge LLM rate-limited (429)${last429 ? `: ${last429.slice(0, 200)}` : ""}`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new KnowledgeUnavailableError(
        `Knowledge LLM returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = stripReasoning(data.choices?.[0]?.message?.content ?? "");
    if (!answer) {
      throw new KnowledgeUnavailableError("Knowledge LLM returned an empty answer");
    }
    return answer;
  }

  throw new KnowledgeUnavailableError(
    `Knowledge LLM rate-limited (429), retries exhausted${last429 ? `: ${last429.slice(0, 200)}` : ""}`,
  );
}

// Some models emit chain-of-thought in a <think>...</think> block before the
// answer. Strip it so `reasoning` carries only the substantive answer.
export function stripReasoning(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * Knowledge-path entry point: answer a fraud-domain question and shape it into
 * Anchor's response. The completer defaults to Groq but is injectable so the
 * router and tests can run without the network.
 */
export async function getKnowledgeAnswer(
  question: string,
  complete: Completer = callGroq,
  nowMs: number = Date.now(),
): Promise<KnowledgeResponse> {
  const answer = await complete(question);
  return shapeKnowledgeResponse(answer, nowMs);
}
