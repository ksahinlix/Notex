import { fileURLToPath } from "node:url";
import { createCloudflareAi } from "./ai/cloudflare.js";
import { createAiService } from "./ai/service.js";
import { createApp } from "./app.js";
import { createPush } from "./push.js";
import { createR2 } from "./r2.js";
import { pool } from "./db.js";

for (const name of ["SESSION_SECRET", "GOOGLE_CLIENT_ID"]) {
  if (!process.env[name]) throw new Error(`${name} is not set (see server/.env.example)`);
}

// AI is optional: without Cloudflare credentials the app works without it.
const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = process.env;
const aiService = accountId && token ? createAiService({ pool, ai: createCloudflareAi({ accountId, token }) }) : null;
if (!aiService) console.warn("AI disabled: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set");

// Notifications are optional too: without VAPID keys the app runs, the
// button just says they are not set up (D21).
const push = createPush({
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT || "mailto:notex@example.com",
});
if (!push) console.warn("Push disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set");
if (push && !process.env.CRON_SECRET) console.warn("CRON_SECRET not set: /api/reminders/due stays closed");

// Backups are optional as well: without the R2 credentials /api/backup
// answers "not configured" and nothing else changes (D23).
const r2 = createR2({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
});
if (!r2) console.warn("Backups disabled: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET not set");

const app = createApp({
  aiService,
  push,
  r2,
  cronSecret: process.env.CRON_SECRET || null,
  pool,
  sessionSecret: process.env.SESSION_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  // The first sign-in with this email takes over notes from the single-user era.
  ownerEmail: process.env.OWNER_EMAIL || null,
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT) || undefined,
  secureCookies: process.env.NODE_ENV === "production",
  webDist: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});

const port = Number(process.env.PORT) || 8000;
app.listen(port, () => console.log(`Notex server listening on http://localhost:${port}`));
