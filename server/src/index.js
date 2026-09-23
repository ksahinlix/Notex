import { fileURLToPath } from "node:url";
import { createCloudflareAi } from "./ai/cloudflare.js";
import { createAiService } from "./ai/service.js";
import { createApp } from "./app.js";
import { pool } from "./db.js";

for (const name of ["SESSION_SECRET", "APP_PASSWORD_HASH"]) {
  if (!process.env[name]) throw new Error(`${name} is not set (see server/.env.example)`);
}

// AI is optional: without Cloudflare credentials the app works without it.
const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = process.env;
const aiService = accountId && token ? createAiService({ pool, ai: createCloudflareAi({ accountId, token }) }) : null;
if (!aiService) console.warn("AI disabled: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set");

const app = createApp({
  aiService,
  pool,
  sessionSecret: process.env.SESSION_SECRET,
  passwordHash: process.env.APP_PASSWORD_HASH,
  secureCookies: process.env.NODE_ENV === "production",
  webDist: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});

const port = Number(process.env.PORT) || 8000;
app.listen(port, () => console.log(`Notex server listening on http://localhost:${port}`));
