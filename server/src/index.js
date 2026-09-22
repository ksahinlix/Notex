import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { pool } from "./db.js";

for (const name of ["SESSION_SECRET", "APP_PASSWORD_HASH"]) {
  if (!process.env[name]) throw new Error(`${name} is not set (see server/.env.example)`);
}

const app = createApp({
  pool,
  sessionSecret: process.env.SESSION_SECRET,
  passwordHash: process.env.APP_PASSWORD_HASH,
  secureCookies: process.env.NODE_ENV === "production",
  webDist: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});

const port = Number(process.env.PORT) || 8000;
app.listen(port, () => console.log(`Notex server listening on http://localhost:${port}`));
