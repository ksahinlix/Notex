// Minimal client for Cloudflare Workers AI (D15).
// The account ID and API token stay on the server; the browser never sees them.

export const MODELS = {
  /** Best Turkish folder names in our tests (17/17). ~24 neurons per note. */
  category: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  /** Backup when the main model fails: fast and ~6x cheaper. */
  categoryFallback: "@cf/qwen/qwen3-30b-a3b-fp8",
  /** Picks the relevant notes from the search shortlist. */
  rerank: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  /** Multilingual embeddings, 1024 dimensions. */
  embed: "@cf/baai/bge-m3",
};

export class AiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Pulls the JSON object out of a model reply. Formats differ by model: some
 * return an already-parsed object in `response`, others text in `response` or
 * in OpenAI-style `choices`, sometimes wrapped in <think>…</think> or ```json.
 */
export function extractJson(result) {
  const res = result?.response;
  if (res && typeof res === "object") return res;
  const raw = String(typeof res === "string" ? res : (result?.choices?.[0]?.message?.content ?? ""));
  const json = raw.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new AiError("model returned no JSON", 502);
  try {
    return JSON.parse(json);
  } catch {
    throw new AiError("model returned invalid JSON", 502);
  }
}

export function createCloudflareAi({ accountId, token, fetchImpl = fetch, timeoutMs = 20_000 }) {
  async function run(model, body) {
    let res;
    try {
      res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new AiError(e.name === "TimeoutError" ? "AI timeout" : "AI unreachable", 504);
    }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) {
      const msg = j?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      // 429: rate limit or daily free allowance used up
      throw new AiError(`Cloudflare AI: ${msg}`, res.status === 429 ? 429 : 502);
    }
    return j.result;
  }

  return {
    /** Chat completion that must answer with a JSON object. */
    async chatJson(model, system, user, { maxTokens = 300 } = {}) {
      // Qwen3 "thinks" before answering unless told not to.
      const u = model.includes("qwen3") ? `${user} /no_think` : user;
      const result = await run(model, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: u },
        ],
        temperature: 0,
        max_tokens: maxTokens,
      });
      return extractJson(result);
    },

    /** Normalized embedding vectors (dot product = cosine similarity). */
    async embed(texts) {
      const out = [];
      for (let i = 0; i < texts.length; i += 50) {
        const result = await run(MODELS.embed, { text: texts.slice(i, i + 50) });
        for (const v of result.data) {
          const n = Math.hypot(...v) || 1;
          out.push(v.map((x) => x / n));
        }
      }
      return out;
    },
  };
}
