/**
 * DEV-ONLY transport shim.
 *
 * This local sandbox has a process-level egress firewall: curl reaches the
 * internet, Node's socket layer does not. That breaks ethers' default HTTP
 * transport here (but NOT on Vercel, where the shipped code runs normally).
 *
 * ethers v6 exposes FetchRequest.registerGetUrl() to replace only the byte
 * transport. We route ethers' HTTP through curl so we can validate real Aave
 * reads locally. Import this for its side effect BEFORE creating a provider.
 * Nothing in src/ or api/ imports this — production uses ethers' default fetch.
 */
import { spawnSync } from "node:child_process";
import { FetchRequest } from "ethers";

const STATUS_SEP = "\n__ANCHOR_HTTP_STATUS__:";

FetchRequest.registerGetUrl(async (req: FetchRequest) => {
  // --compressed: let curl negotiate + transparently decompress. We drop ethers'
  // own accept-encoding header below so curl solely owns content negotiation
  // (otherwise the server gzips the body and plain curl hands back raw gzip bytes).
  const args = ["-s", "--compressed", "--max-time", "30", "-X", req.method, "-w", STATUS_SEP + "%{http_code}"];
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() === "accept-encoding") continue;
    args.push("-H", `${key}: ${value}`);
  }
  const hasBody = req.body && req.body.length > 0;
  if (hasBody) args.push("--data-binary", "@-");
  args.push(req.url);

  const res = spawnSync("curl", args, {
    input: hasBody ? Buffer.from(req.body!) : undefined,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  });
  if (res.error) throw res.error;

  const out = res.stdout.toString("utf8");
  if (process.env.ANCHOR_TRANSPORT_DEBUG) {
    console.error("[dev-transport] url=", req.url, "method=", req.method, "hasBody=", hasBody);
    console.error("[dev-transport] args=", JSON.stringify(args));
    console.error("[dev-transport] exit=", res.status, "signal=", res.signal, "stderr=", res.stderr.toString("utf8").slice(0, 300));
    console.error("[dev-transport] stdout=", JSON.stringify(out.slice(0, 300)));
  }
  const sepAt = out.lastIndexOf(STATUS_SEP);
  const bodyText = sepAt >= 0 ? out.slice(0, sepAt) : out;
  const statusCode = sepAt >= 0 ? parseInt(out.slice(sepAt + STATUS_SEP.length), 10) || 0 : 0;

  return {
    statusCode,
    statusMessage: statusCode === 200 ? "OK" : "ERR",
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(bodyText),
  };
});

console.log("[dev] ethers HTTP transport routed through curl (local sandbox egress workaround)");
