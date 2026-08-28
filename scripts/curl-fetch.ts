/**
 * DEV-ONLY transport shim for the knowledge (Groq) path.
 *
 * Sibling of curl-transport.ts, which does the same job for ethers. This local
 * sandbox has a process-level egress firewall: curl reaches the internet, and
 * Node's socket layer only partly does — GET requests succeed but POSTs with a
 * body reliably fail with ETIMEDOUT (measured 7/8 failures). That breaks the
 * global fetch() that src/knowledge.ts uses, but NOT on Vercel, where the
 * shipped code runs normally.
 *
 * So we replace globalThis.fetch with a curl-backed implementation and return a
 * real Response, so status / ok / text() / json() / headers.get() all behave.
 * Import this for its side effect BEFORE anything calls fetch. Nothing in src/
 * or api/ imports it — production uses the platform fetch.
 *
 * Caveat: curl runs via spawnSync, which blocks the event loop, so an
 * AbortSignal passed by the caller cannot preempt it. curl's own --max-time
 * bounds the call instead. Timeout BEHAVIOUR is therefore covered by unit tests,
 * not by this shim.
 */
import { spawnSync } from "node:child_process";

const STATUS_SEP = "\n__ANCHOR_FETCH_STATUS__:";

// Param types are taken from the global fetch signature rather than named DOM
// types (RequestInfo / HeadersInit), which aren't in this project's ES2022 lib.
type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

globalThis.fetch = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? "GET";

  const args = ["-s", "--compressed", "--max-time", "30", "-X", method, "-D", "-", "-w", STATUS_SEP + "%{http_code}"];
  const headers = new Headers(init?.headers);
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "accept-encoding") return;
    args.push("-H", `${key}: ${value}`);
  });

  const body = typeof init?.body === "string" ? init.body : undefined;
  if (body) args.push("--data-binary", "@-");
  args.push(url);

  const res = spawnSync("curl", args, { input: body, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  if (res.error) throw res.error;

  const out = res.stdout ?? "";
  const sepAt = out.lastIndexOf(STATUS_SEP);
  const withHeaders = sepAt >= 0 ? out.slice(0, sepAt) : out;
  const status = sepAt >= 0 ? parseInt(out.slice(sepAt + STATUS_SEP.length), 10) || 0 : 0;

  // -D - writes response headers ahead of the body; split on the blank line that
  // terminates the final header block (there can be several, e.g. a 100-continue).
  const splitAt = withHeaders.lastIndexOf("\r\n\r\n");
  const rawHeaders = splitAt >= 0 ? withHeaders.slice(0, splitAt) : "";
  const bodyText = splitAt >= 0 ? withHeaders.slice(splitAt + 4) : withHeaders;

  const outHeaders = new Headers();
  for (const line of rawHeaders.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0 || /^HTTP\//i.test(line)) continue;
    try {
      outHeaders.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
    } catch {
      // skip malformed header lines rather than failing the whole request
    }
  }

  if (status === 0) throw new TypeError("fetch failed (curl transport: no response)");
  return new Response(bodyText, { status, statusText: status === 200 ? "OK" : "ERR", headers: outHeaders });
};

console.error("[dev] global fetch routed through curl (local sandbox egress workaround)");
