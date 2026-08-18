import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRiskCheck, InvalidWalletError } from "../src/service.js";
import { logBannerOnce } from "../src/banner.js";
import { CACHE_TTL_SECONDS } from "../src/config.js";

logBannerOnce();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Public read-only feed: allow any origin so browser-based consumers (and
  // Track 3 app prototypes) can call it directly.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const raw = req.query.wallet;
  const wallet = Array.isArray(raw) ? raw[0] : raw;

  if (!wallet) {
    res.status(400).json({
      error: "Missing required query parameter: wallet",
      example: "/api/risk-check?wallet=0x50B75AaCb1ed974F5c901a32BeE767de39CBb060",
    });
    return;
  }

  try {
    const result = await getRiskCheck(wallet);
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_TTL_SECONDS * 2}`,
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidWalletError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error("[anchor] risk check failed:", err);
    res.status(502).json({
      error: "Failed to read on-chain risk data",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
