/**
 * DEV-ONLY: exercise the knowledge path (Groq) directly, without the HTTP
 * server. Calls the same getKnowledgeAnswer the /api/risk-check endpoint uses,
 * so it verifies the real LLM call, the <think> stripping, and the response
 * shaping end to end.
 *
 * Needs GROQ_API_KEY in the environment. In this local sandbox, Node's socket
 * layer cannot reliably POST (measured ETIMEDOUT on 7 of 8 attempts, while curl
 * succeeds every time), so ./curl-fetch.js routes the global fetch through curl.
 * Run with the sandbox disabled. On Vercel that shim is absent and the platform
 * fetch is used directly.
 *
 *   GROQ_API_KEY=gsk_... npx tsx scripts/ask-knowledge.ts "What characterized the BitConnect Ponzi scheme?"
 */
import "./curl-fetch.js"; // local sandbox egress workaround; must precede any fetch
import { getKnowledgeAnswer } from "../src/knowledge.js";
import { GROQ } from "../src/config.js";

const question =
  process.argv[2] ?? "What characterized the BitConnect cryptocurrency Ponzi scheme that collapsed in January 2018?";

async function main(): Promise<void> {
  if (!GROQ.apiKey) {
    console.error("Set GROQ_API_KEY to run the knowledge path. See .env.example.");
    process.exit(1);
  }
  console.error(`[ask-knowledge] model=${GROQ.model}  q=${question}\n`);
  const started = Date.now();
  const res = await getKnowledgeAnswer(question);
  console.error(`[ask-knowledge] answered in ${Date.now() - started}ms\n`);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => {
  console.error("ask-knowledge failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
