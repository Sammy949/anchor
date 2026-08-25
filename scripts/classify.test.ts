import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQuery } from "../src/classify.js";

const ADDR = "0x50B75AaCb1ed974F5c901a32BeE767de39CBb060"; // valid checksum
const ADDR_LOWER = ADDR.toLowerCase();

test("direct wallet param (valid checksum) -> wallet, unchanged", () => {
  const c = classifyQuery({ wallet: ADDR });
  assert.equal(c.kind, "wallet");
  assert.equal(c.kind === "wallet" && c.wallet, ADDR);
});

test("lowercase wallet param -> wallet, normalized to checksum", () => {
  const c = classifyQuery({ wallet: ADDR_LOWER });
  assert.equal(c.kind, "wallet");
  assert.equal(c.kind === "wallet" && c.wallet, ADDR); // checksummed
});

test("address embedded in a natural-language query -> wallet", () => {
  const c = classifyQuery({ query: `Is it safe to lend to ${ADDR_LOWER}? Check its risk.` });
  assert.equal(c.kind, "wallet");
  assert.equal(c.kind === "wallet" && c.wallet, ADDR);
});

test("wallet wins when both an address and prose are present", () => {
  const c = classifyQuery({ wallet: ADDR, query: "What characterized BitConnect?" });
  assert.equal(c.kind, "wallet");
});

test("knowledge question with no address -> knowledge, question preserved", () => {
  const q = "What characterized the BitConnect cryptocurrency Ponzi scheme that collapsed in January 2018?";
  const c = classifyQuery({ query: q });
  assert.equal(c.kind, "knowledge");
  assert.equal(c.kind === "knowledge" && c.question, q);
});

test("single-word fraud topic (non-hex letters) -> knowledge, not a wallet attempt", () => {
  const c = classifyQuery({ query: "OneCoin" });
  assert.equal(c.kind, "knowledge");
});

test("router put the NL question in the wallet slot -> knowledge", () => {
  // A router that only has a `wallet` field to fill may drop the question there.
  const c = classifyQuery({ wallet: "What characterized Allen Stanford's $7 billion Ponzi scheme?" });
  assert.equal(c.kind, "knowledge");
});

test("malformed address (right shape, wrong length), no question -> malformed_wallet", () => {
  const c = classifyQuery({ wallet: "0x1234" });
  assert.equal(c.kind, "malformed_wallet");
  assert.equal(c.kind === "malformed_wallet" && c.input, "0x1234");
});

test("bad-checksum 40-hex in the wallet param stays strict (400), NOT lenient-accepted", () => {
  // Existing contract: a mixed-case address that fails EIP-55 is rejected. The
  // classifier must not silently "fix" a value the caller put in the wallet slot.
  const badChecksum = "0x50b75AaCb1ed974F5c901a32BeE767de39CBb060"; // first B lowercased
  const c = classifyQuery({ wallet: badChecksum });
  assert.equal(c.kind, "malformed_wallet");
});

test("that same bad-checksum address, when it appears in FREE TEXT, is extracted leniently", () => {
  // Leniency is only for addresses pulled out of a natural-language query.
  const badChecksum = "0x50b75AaCb1ed974F5c901a32BeE767de39CBb060";
  const c = classifyQuery({ query: `assess ${badChecksum} for me` });
  assert.equal(c.kind, "wallet");
  assert.equal(c.kind === "wallet" && c.wallet, ADDR); // normalized to valid checksum
});

test("malformed address BUT a real question present -> knowledge (answerable)", () => {
  const c = classifyQuery({ wallet: "0x1234", query: "What is the Wirecard fraud?" });
  assert.equal(c.kind, "knowledge");
});

test("empty / whitespace-only input -> empty", () => {
  assert.equal(classifyQuery({}).kind, "empty");
  assert.equal(classifyQuery({ wallet: "", query: "" }).kind, "empty");
  assert.equal(classifyQuery({ wallet: "   ", query: "  " }).kind, "empty");
  assert.equal(classifyQuery({ wallet: null, query: null }).kind, "empty");
});

test("a 64-char tx hash is NOT mistaken for an address", () => {
  const txHash = "0x496ba72f85d5ce381f52f4e3231f4d51ebc0812a714c2b9de7059e879798bd61";
  const c = classifyQuery({ query: `Look up transaction ${txHash}` });
  // No valid 40-nibble address is embedded, so this is not a wallet query.
  assert.notEqual(c.kind, "wallet");
});
