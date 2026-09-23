// Test database: uses TEST_DATABASE_URL if set (e.g. a Postgres in CI or a
// cloud session), otherwise starts a throwaway local Postgres through the
// `embedded-postgres` package, so database tests also run on a plain Windows PC.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");

/** Returns { pool, stop }. The schema is applied and all tables are empty. */
export async function startTestDb() {
  let url = process.env.TEST_DATABASE_URL;
  let embedded = null;
  let dir = null;
  if (!url) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(tmpdir(), "notex-pg-"));
    const port = 40000 + Math.floor(Math.random() * 20000); // test files run in parallel
    embedded = new EmbeddedPostgres({
      databaseDir: dir, user: "notex", password: "notex", port, persistent: false,
      // Windows locale names like "Turkish_Türkiye.1252" break initdb.
      initdbFlags: ["--locale=C", "--encoding=UTF8"],
      onLog: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase("notex_test");
    url = `postgresql://notex:notex@localhost:${port}/notex_test`;
  }
  const pool = new pg.Pool({ connectionString: url });
  await pool.query(schema);
  await pool.query("TRUNCATE notes, protected_folders, note_vectors");
  return {
    pool,
    async stop() {
      await pool.end();
      if (embedded) {
        await embedded.stop();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
