// AI features on the server (D15): folder suggestions and search by meaning.
// Only notes that are NOT encrypted are ever sent to the AI or get vectors,
// and every query is limited to one user's notes (D16).
import crypto from "node:crypto";
import { AiError, MODELS } from "./cloudflare.js";
import { CATEGORY_SYSTEM, SEARCH_SYSTEM, categoryUserPrompt, cleanPath, searchUserPrompt } from "./prompts.js";

const SHORTLIST = 20; // notes the language model re-ranks for a search
const FALLBACK_RESULTS = 8; // results when re-ranking fails
const MAX_EMBED_PER_CALL = 300; // bounds the first-time backfill per request

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Text used for a note's search vector: its folder path gives useful context. */
export function vectorText(path, content) {
  const body = content?.listItemText || content?.text || "";
  return `${path.join(" / ")}\n${body}`.slice(0, 1500);
}
const hashOf = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function createAiService({ pool, ai }) {
  const syncing = new Map(); // userId -> running sync

  /** Brings a user's note_vectors up to date with their plain notes (lazily, on use). */
  function syncVectors(userId) {
    if (syncing.has(userId)) return syncing.get(userId);
    const job = (async () => {
      try {
        await pool.query(
          `DELETE FROM note_vectors v USING notes n
           WHERE v.note_id = n.id AND n.user_id = $1 AND (n.encrypted OR n.deleted_at IS NOT NULL)`,
          [userId],
        );
        const { rows } = await pool.query(
          `SELECT n.id, n.path, n.content, v.text_hash FROM notes n
           LEFT JOIN note_vectors v ON v.note_id = n.id
           WHERE n.user_id = $1 AND n.deleted_at IS NULL AND NOT n.encrypted`,
          [userId],
        );
        const stale = rows
          .map((r) => ({ id: r.id, text: vectorText(r.path, r.content), old: r.text_hash }))
          .map((r) => ({ ...r, hash: hashOf(r.text) }))
          .filter((r) => r.hash !== r.old)
          .slice(0, MAX_EMBED_PER_CALL);
        if (!stale.length) return;
        const vecs = await ai.embed(stale.map((r) => r.text));
        for (let i = 0; i < stale.length; i++) {
          await pool.query(
            `INSERT INTO note_vectors (note_id, text_hash, vector) VALUES ($1, $2, $3)
             ON CONFLICT (note_id) DO UPDATE SET text_hash = EXCLUDED.text_hash, vector = EXCLUDED.vector, updated_at = now()`,
            [stale[i].id, stale[i].hash, vecs[i]],
          );
        }
      } finally {
        syncing.delete(userId);
      }
    })();
    syncing.set(userId, job);
    return job;
  }

  /** Plain notes ranked by similarity to `vec` (best first). */
  async function nearest(userId, vec, limit) {
    const { rows } = await pool.query(
      `SELECT n.id, n.path, n.content, v.vector FROM note_vectors v
       JOIN notes n ON n.id = v.note_id
       WHERE n.user_id = $1 AND n.deleted_at IS NULL AND NOT n.encrypted`,
      [userId],
    );
    return rows
      .map((r) => ({ id: r.id, path: r.path, content: r.content, score: dot(vec, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async function existingFolders(userId) {
    const { rows } = await pool.query(
      `SELECT path, count(*)::int AS n FROM notes WHERE user_id = $1 AND deleted_at IS NULL GROUP BY path ORDER BY n DESC, path`,
      [userId],
    );
    return rows.map((r) => r.path);
  }

  return {
    /**
     * A folder for new note text: the language model's pick (existing or new),
     * plus up to 3 existing folders whose notes are most similar.
     */
    async classify(userId, text) {
      const folders = await existingFolders(userId);
      const user = categoryUserPrompt(text, folders);

      const pickFolder = async () => {
        let lastError;
        for (const model of [MODELS.category, MODELS.categoryFallback]) {
          try {
            const path = cleanPath((await ai.chatJson(model, CATEGORY_SYSTEM, user)).path, folders);
            if (path) return { path, model };
          } catch (e) {
            lastError = e;
          }
        }
        throw lastError ?? new AiError("no folder suggested", 502);
      };
      const similarFolders = async () => {
        try {
          await syncVectors(userId);
          const [vec] = await ai.embed([text.slice(0, 1500)]);
          const seen = new Set();
          const out = [];
          for (const n of await nearest(userId, vec, 30)) {
            const key = n.path.join("/");
            if (!seen.has(key)) {
              seen.add(key);
              out.push(n.path);
            }
          }
          return out.slice(0, 4);
        } catch {
          return []; // alternatives are optional
        }
      };

      const [pick, similar] = await Promise.all([pickFolder(), similarFolders()]);
      const key = pick.path.join("/");
      return {
        path: pick.path,
        isNew: !folders.some((f) => f.join("/") === key),
        alternatives: similar.filter((p) => p.join("/") !== key).slice(0, 3),
        model: pick.model,
      };
    },

    /**
     * Notes matching `query` by meaning: the 20 closest by vector, then the
     * language model keeps the relevant ones, best first. Returns note ids.
     */
    async search(userId, query) {
      await syncVectors(userId);
      const [vec] = await ai.embed([query]);
      const shortlist = (await nearest(userId, vec, SHORTLIST)).map((n) => ({ id: n.id, text: vectorText(n.path, n.content), score: n.score }));
      if (!shortlist.length) return { ids: [], reranked: false };
      try {
        const { ids } = await ai.chatJson(MODELS.rerank, SEARCH_SYSTEM, searchUserPrompt(query, shortlist), { maxTokens: 200 });
        const picked = [...new Set((Array.isArray(ids) ? ids : []).map(Number))]
          .filter((i) => Number.isInteger(i) && i >= 1 && i <= shortlist.length)
          .map((i) => shortlist[i - 1].id);
        return { ids: picked, reranked: true };
      } catch {
        return { ids: shortlist.slice(0, FALLBACK_RESULTS).map((n) => n.id), reranked: false };
      }
    },

    syncVectors,
  };
}
