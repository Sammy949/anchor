import { getAddress, isAddress } from "ethers";

/**
 * Deterministic query classifier.
 *
 * Anchor serves the Telegraph FRAUD_DETECTION intent, whose real query mix is
 * broader than on-chain wallet risk: it also carries general fraud-knowledge
 * questions ("What characterized the BitConnect Ponzi scheme?"). A single
 * endpoint therefore has to decide, per request, which evidence source to use.
 *
 * The classifier is intentionally simple and I/O-free (no LLM call just to
 * classify, so it adds no latency or cost): the primary signal is whether the
 * request carries an extractable, valid EVM address.
 *
 *   - wallet-shaped   -> a valid 0x address is present (either as the `wallet`
 *                        param, or embedded in a natural-language query)
 *   - knowledge-shaped-> no address, but there is a natural-language question
 *   - malformed_wallet-> an address was clearly attempted but is invalid, and
 *                        there is no question to fall back to (preserves the
 *                        existing "bad wallet -> 400" contract)
 *   - empty           -> nothing usable at all
 *
 * How requests arrive matters: a direct caller sends `?wallet=0x...`, but a
 * routed FRAUD_DETECTION query may arrive as natural-language text (the router
 * can only populate the fields Anchor advertises, so the question may land in
 * the `query` param or even in the `wallet` slot). We read from both and let
 * the address be the deciding signal, so classification is robust to either.
 */

export interface RawInput {
  wallet?: string | null;
  query?: string | null;
}

export type Classification =
  | { kind: "wallet"; wallet: string } // checksummed address
  | { kind: "knowledge"; question: string }
  | { kind: "malformed_wallet"; input: string }
  | { kind: "empty" };

// Exactly-40 hex nibbles, not part of a longer hex run (so a 64-char tx hash is
// not mistaken for an address by matching its first 40 nibbles).
const EMBEDDED_ADDRESS_RE = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

// A "bare" address token: "0x" followed only by hex nibbles (any length). This
// is an address that was *attempted* as a value, as opposed to prose that
// happens to contain one.
const BARE_ADDRESS_TOKEN_RE = /^0x[0-9a-fA-F]*$/;

export function classifyQuery(raw: RawInput): Classification {
  const walletRaw = (raw.wallet ?? "").trim();
  const queryRaw = (raw.query ?? "").trim();

  // 1. The `wallet` param is a strictly-valid address: the existing, proven
  //    path, byte-for-byte unchanged (ethers' strict checksum validation, so a
  //    bad-checksum direct input still 400s exactly as before).
  if (walletRaw && isAddress(walletRaw)) {
    return { kind: "wallet", wallet: getAddress(walletRaw) };
  }

  // A bare wallet token is validated strictly (above / step 4). Prose that
  // landed in the wallet slot is free text, same as the query, and is searched
  // leniently for an embedded address below.
  const walletIsBareToken = BARE_ADDRESS_TOKEN_RE.test(walletRaw);

  // 2. An address embedded in free text — a routed natural-language query that
  //    names a wallet, in either field. Lenient: normalize any 40-nibble token
  //    to a checksummed address, since routed/NL text is often not checksummed.
  const freeText = [queryRaw, walletIsBareToken ? "" : walletRaw].filter(Boolean).join(" ");
  const embedded = freeText.match(EMBEDDED_ADDRESS_RE);
  if (embedded) {
    return { kind: "wallet", wallet: getAddress(embedded[0].toLowerCase()) };
  }

  // 3. No usable address. Prefer an explicit natural-language question; else
  //    treat prose that arrived in the wallet slot as the question (a router
  //    with only a `wallet` field to fill may have put it there).
  const question = queryRaw || (walletIsBareToken ? "" : walletRaw);
  if (question) {
    return { kind: "knowledge", question };
  }

  // 4. The wallet param was a bare-but-invalid address (bad checksum or wrong
  //    length) with no question to fall back to: preserve the existing 400
  //    contract rather than guessing.
  if (walletRaw) {
    return { kind: "malformed_wallet", input: walletRaw };
  }

  // 5. Nothing usable.
  return { kind: "empty" };
}

