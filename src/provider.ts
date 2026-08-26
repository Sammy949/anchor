import { JsonRpcProvider } from "ethers";
import { NETWORK, RPC_TIMEOUT_MS, RPC_URLS } from "./config.js";

/**
 * RPC transport with a private primary + public fallback and a per-endpoint
 * timeout.
 *
 * The wallet-read path expresses its work as a `ProviderOp` — an on-chain read
 * against a single provider — so the *same* read can be retried verbatim on the
 * fallback endpoint if the primary fails or hangs. This keeps the fallback
 * decision in one place and leaves the read logic (src/aave.ts, src/service.ts)
 * transport-agnostic.
 */

/** An on-chain read expressed against a single provider, so it can be retried
 *  verbatim against a fallback endpoint. */
export type ProviderOp<T> = (provider: JsonRpcProvider) => Promise<T>;

/** Thrown when every configured RPC endpoint fails or times out. */
export class AllRpcsFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllRpcsFailedError";
  }
}

// One provider per configured URL, reused across warm invocations. staticNetwork
// skips a per-call eth_chainId round-trip since the chain is fixed.
let providers: JsonRpcProvider[] | null = null;
export function getProviders(): JsonRpcProvider[] {
  if (!providers) {
    providers = RPC_URLS.map(
      (url) => new JsonRpcProvider(url, NETWORK.chainId, { staticNetwork: true }),
    );
  }
  return providers;
}

/**
 * Reject with a timeout error if `promise` hasn't settled within `ms`. The
 * underlying request is NOT cancelled (ethers has no per-call abort on the
 * default transport); we simply stop waiting and let the caller fall back. A
 * stranded request on a serverless invocation is harmless.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`RPC timed out after ${ms}ms (${label})`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Run `op` against each configured RPC in order — private primary first, public
 * fallback next — with each attempt bounded by `timeoutMs`. Returns the first
 * success. If an endpoint errors OR exceeds the timeout, the next is tried; if
 * every endpoint is exhausted, throws AllRpcsFailedError carrying each reason.
 *
 * `providersList` and `timeoutMs` are injectable so the fallback logic is
 * unit-testable without the network.
 */
export async function withRpcFallback<T>(
  op: ProviderOp<T>,
  providersList: JsonRpcProvider[] = getProviders(),
  timeoutMs: number = RPC_TIMEOUT_MS,
): Promise<T> {
  if (providersList.length === 0) {
    throw new AllRpcsFailedError("No RPC endpoints are configured");
  }
  const reasons: string[] = [];
  for (const [i, provider] of providersList.entries()) {
    const isLast = i === providersList.length - 1;
    try {
      return await withTimeout(op(provider), timeoutMs, `rpc#${i + 1}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      reasons.push(`rpc#${i + 1}: ${reason}`);
      if (!isLast) {
        console.warn(`[anchor] RPC endpoint #${i + 1} failed, falling back to #${i + 2}: ${reason}`);
      }
    }
  }
  throw new AllRpcsFailedError(
    `All ${providersList.length} RPC endpoint(s) failed: ${reasons.join("; ")}`,
  );
}

/** Test hook: drop memoized providers so a later getProviders() rebuilds them. */
export function resetProviders(): void {
  providers = null;
}
