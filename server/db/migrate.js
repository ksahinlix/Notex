// Applies db/schema.sql to the database in DATABASE_URL.
// Usage: npm run migrate
import { readFile } from "node:fs/promises";
import { pool } from "../src/db.js";

const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
try {
  await pool.query(sql);
  console.log("Schema applied.");
} finally {
  await pool.end();
}
