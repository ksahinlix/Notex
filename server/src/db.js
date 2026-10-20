import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (see server/.env.example)");
}

// TLS comes from the connection string: Neon's carries sslmode=require, the
// home server's Postgres sits on the Docker network and needs none (D28).
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// Neon closes idle connections when its compute suspends, and a restarted
// Postgres container does the same. Without this
// handler, pg would re-emit that as an unhandled error and crash the server.
pool.on("error", (err) => console.error("Postgres idle client error:", err.message));
