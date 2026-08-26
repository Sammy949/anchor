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

const SYSTEM_PROMPT =
  "You are Anchor, a fraud-detection knowledge service. Answer the user's " +
  "question about the fraud case, scheme, scam, or financial-crime topic it " +
  "names, factually and accurately. Lead with the concrete, verifiable " +
  "specifics that characterize it: who ran it, what the mechanism was, the " +
  "scale, the timeline, and how it ended. Be concise and self-contained (a " +
  "few sentences). If you are not certain of a detail, say so rather than " +
  "inventing it. Do not add disclaimers, caveats about your nature, or " +
  "preamble; return only the substantive answer.";

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
 * Call Groq's OpenAI-compatible chat completions endpoint and return the answer
 * text. Uses the global fetch (native on Vercel and Node 18+). Fails loudly with
 * a typed error rather than crashing, so the endpoint can map it to a clean HTTP
 * status.
 */
export async function callGroq(question: string): Promise<string> {
  if (!GROQ.apiKey) {
    throw new KnowledgeUnavailableError(
      "Knowledge path unavailable: GROQ_API_KEY is not set. Set it in the environment to answer fraud-knowledge questions.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ.timeoutMs);
  let res: Response;
  try {
    res = await fetch(GROQ.apiUrl, {
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
    // An aborted fetch can surface as a generic "fetch failed" (TypeError) rather
    // than a named AbortError depending on timing, so key off the signal itself.
    if (controller.signal.aborted) {
      throw new KnowledgeUnavailableError(`Knowledge LLM timed out after ${GROQ.timeoutMs}ms`);
    }
    throw new KnowledgeUnavailableError(
      `Knowledge LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
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
