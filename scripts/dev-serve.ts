/**
 * DEV-ONLY local server. Mirrors the Vercel routes so we can validate the full
 * request path in this sandbox, where Node's socket egress is firewalled.
 * Importing the curl-transport shim first makes ethers' HTTP go through curl.
 * Nothing in src/ or api/ imports this file.
 *
 *   npm run dev            # serve on :3000
 *   curl localhost:3000/api/health-factor?wallet=0x...
 */
import "./curl-transport.js";
import { createServer } from "node:http";
import { answerFraudQuery, getRiskSignal, InvalidWalletError, MissingInputError } from "../src/service.js";
import { extractInput } from "../src/classify.js";
import { KnowledgeUnavailableError } from "../src/knowledge.js";
import { renderBanner, serviceDescriptor } from "../src/banner.js";

const PORT = Number(process.env.PORT ?? 3000);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/") {
    if (String(req.headers.accept ?? "").includes("application/json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(serviceDescriptor(), null, 2));
    } else {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(renderBanner());
    }
    return;
  }

  if (url.pathname === "/api/health-factor") {
    const wallet = url.searchParams.get("wallet");
    if (!wallet) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required query parameter: wallet" }));
      return;
    }
    try {
      const signal = await getRiskSignal(wallet);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(signal, null, 2));
    } catch (err) {
      const code = err instanceof InvalidWalletError ? 400 : 502;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url.pathname === "/api/risk-check") {
    const input = extractInput(Object.fromEntries(url.searchParams));
    if (!input.wallet && !input.query) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Missing input: provide a wallet to assess, or a query to answer." }));
      return;
    }
    try {
      const result = await answerFraudQuery(input);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (err) {
      const code =
        err instanceof InvalidWalletError || err instanceof MissingInputError
          ? 400
          : err instanceof KnowledgeUnavailableError
            ? 503
            : 502;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(renderBanner());
  console.log(`\n[dev] Anchor listening on http://localhost:${PORT}\n`);
});
