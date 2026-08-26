import type { VercelRequest, VercelResponse } from "@vercel/node";
import { answerFraudQuery, InvalidWalletError, MissingInputError } from "../src/service.js";
import { extractInput } from "../src/classify.js";
import { KnowledgeUnavailableError } from "../src/knowledge.js";
import { logBannerOnce } from "../src/banner.js";
import { CACHE_TTL_SECONDS } from "../src/config.js";

logBannerOnce();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Public read-only feed: allow any origin so browser-based consumers (and
  // Track 3 app prototypes) can call it directly.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Anchor answers the whole FRAUD_DETECTION intent from this one endpoint: a
  // `wallet` runs the on-chain solvency path; a `query` (fraud-knowledge
  // question) runs the LLM path. Gather both from the query string OR the body,
  // since a routed request's shape isn't under our control; the classifier
  // decides which path to take.
  const input = extractInput(req.query, req.body);

  if (!input.wallet && !input.query) {
    res.status(400).json({
      error: "Missing input. Provide a wallet to assess, or a query to answer.",
      examples: {
        wallet: "/api/risk-check?wallet=0x50B75AaCb1ed974F5c901a32BeE767de39CBb060",
        query: "/api/risk-check?query=What+characterized+the+BitConnect+Ponzi+scheme%3F",
      },
    });
    return;
  }

  try {
    const result = await answerFraudQuery(input);
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_TTL_SECONDS * 2}`,
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidWalletError || err instanceof MissingInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof KnowledgeUnavailableError) {
      // The knowledge path is configured-but-unavailable (missing key, LLM down,
      // timeout). 503 = try again / operator action needed, distinct from a bad
      // request and from the on-chain 502.
      console.error("[anchor] knowledge path unavailable:", err);
      res.status(503).json({ error: "Knowledge service temporarily unavailable", detail: err.message });
      return;
    }
    console.error("[anchor] risk check failed:", err);
    res.status(502).json({
      error: "Failed to read on-chain risk data",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
