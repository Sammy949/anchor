import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRiskSignal, InvalidWalletError } from "../src/service";
import { logBannerOnce } from "../src/banner";
import { CACHE_TTL_SECONDS } from "../src/config";

logBannerOnce();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.query.wallet;
  const wallet = Array.isArray(raw) ? raw[0] : raw;

  if (!wallet) {
    res.status(400).json({
      error: "Missing required query parameter: wallet",
      example: "/api/health-factor?wallet=0xA83a8e4A4923Eee175170df78b59103D254F86eF",
    });
    return;
  }

  try {
    const signal = await getRiskSignal(wallet);
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_TTL_SECONDS * 2}`,
    );
    res.status(200).json(signal);
  } catch (err) {
    if (err instanceof InvalidWalletError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error("[anchor] risk signal failed:", err);
    res.status(502).json({
      error: "Failed to read on-chain risk data",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
