// Puts a backup file (D23) back into a database.
//
// Usage (from server/):
//   node --env-file=.env scripts/restore-backup.mjs <file.json|file.json.gz>
//   ... --yes                 actually write (without it nothing is changed)
//   ... --database-url=...    somewhere other than DATABASE_URL
//
// The writing itself is restoreBackup() in src/backup.js, so what runs here is
// what the tests exercise. Run db/migrate.js first if the target is empty.
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import pg from "pg";
import { restoreBackup } from "../src/backup.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const write = args.includes("--yes");
const url = args.find((a) => a.startsWith("--database-url="))?.slice("--database-url=".length) ?? process.env.DATABASE_URL;

if (!file) {
  console.error("usage: node scripts/restore-backup.mjs <file.json[.gz]> [--yes] [--database-url=...]");
  process.exit(1);
}
if (!url) {
  console.error("No database: set DATABASE_URL or pass --database-url=...");
  process.exit(1);
}

const raw = readFileSync(file);
const dump = JSON.parse(file.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8"));

console.log(`${file}\n  taken ${dump.takenAt} · scope ${dump.scope} · server ${dump.serverVersion ?? "?"}`);
for (const [what, n] of Object.entries(dump.counts ?? {})) console.log(`  ${String(n).padStart(6)} ${what}`);
if (!write) {
  console.log("\nNothing written. Add --yes to restore into:\n  " + url.replace(/:\/\/[^@]*@/, "://***@"));
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await restoreBackup(client, dump);
  await client.query("COMMIT");
  console.log("\nRestored.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("\nNothing was written:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
