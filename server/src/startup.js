// Startup checks. The point: whatever is wrong (a missing setting, a database
// that cannot be reached), the server still starts and /api/health says what
// it is. Before this, a bad DATABASE_URL made Render's start command wait
// forever, so the site just hung and nothing outside could tell why.

/** Settings the server cannot run without. */
export const REQUIRED_SETTINGS = ["DATABASE_URL", "SESSION_SECRET", "GOOGLE_CLIENT_ID"];

export function missingSettings(env) {
  return REQUIRED_SETTINGS.filter((name) => !env[name]);
}

/**
 * A short, public-safe reason for a database error: what kind of failure it
 * is, never the connection string or user name. The full error goes to the log.
 */
export function describeDbError(err) {
  const msg = String(err?.message ?? err ?? "");
  const code = err?.code ?? "";
  if (code === "28P01" || /password authentication failed/i.test(msg)) return "wrong database password (check DATABASE_URL)";
  if (/quota|compute time|exceeded the/i.test(msg)) return "database is over its free quota (check Neon)";
  if (/endpoint.*(disabled|suspended|not found|could not be found|does not exist)|project.*(suspended|deleted|not found)/i.test(msg))
    return "database endpoint is disabled or deleted (check Neon)";
  if (code === "3D000") return "database name does not exist (check DATABASE_URL)";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "database host not found (check DATABASE_URL)";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "database refused the connection";
  if (/timeout|timed out/i.test(msg) || code === "ETIMEDOUT") return "database did not answer in time";
  return `database error${code ? ` (${code})` : ""}`;
}

/**
 * Applies the schema, retrying until it works. Resolves on success; never
 * rejects, so it can run in the background while the server is already up.
 */
export async function migrateWithRetry(pool, sql, { delayMs = 30_000, log = console } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      log.log(`Schema applied${attempt > 1 ? ` (attempt ${attempt})` : ""}.`);
      return;
    } catch (err) {
      log.error(`Schema not applied (attempt ${attempt}): ${describeDbError(err)} — ${err.message}. Retrying in ${delayMs / 1000}s.`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
