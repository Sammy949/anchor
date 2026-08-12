import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderBanner, serviceDescriptor } from "../src/banner";

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const accept = String(req.headers.accept ?? "");
  if (accept.includes("application/json")) {
    res.status(200).json(serviceDescriptor());
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.status(200).send(renderBanner());
}
