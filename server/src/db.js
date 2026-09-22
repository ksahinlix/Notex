import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (see server/.env.example)");
}

// Neon requires TLS; its connection string already contains sslmode=require.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
