// Applies db/schema.sql to the database in DATABASE_URL.
// Usage: npm run migrate
//
// The server also applies the schema itself at startup, retrying until the
// database answers (src/index.js). So on Render a failure here only logs a
// warning and exits 0: an older start command ("npm run migrate && npm start")
// must not keep the server from starting and reporting the problem.
import { readFile } from "node:fs/promises";
import { describeDbError } from "../src/startup.js";

const onRender = !!process.env.RENDER;
try {
  const { pool } = await import("../src/db.js");
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  try {
    await pool.query(sql);
    console.log("Schema applied.");
  } finally {
    await pool.end();
  }
} catch (err) {
  console.error(`Schema not applied: ${describeDbError(err)} — ${err.message}`);
  if (onRender) console.error("Continuing: the server will retry the schema itself once it is up.");
  process.exitCode = onRender ? 0 : 1;
}
