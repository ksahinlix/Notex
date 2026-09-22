import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, hashPassword, verifyPassword, verifySessionToken } from "../src/auth.js";

test("password hash round-trip", async () => {
  const stored = await hashPassword("correct horse");
  assert.equal(await verifyPassword("correct horse", stored), true);
  assert.equal(await verifyPassword("wrong", stored), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("session tokens are signed and expire", () => {
  const token = createSessionToken("secret", 0);
  assert.equal(verifySessionToken(token, "secret", 1000), true);
  assert.equal(verifySessionToken(token, "other-secret", 1000), false);
  assert.equal(verifySessionToken(token, "secret", 31 * 86400_000), false);
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ exp: 9e15 })).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${sig}`, "secret", 1000), false);
  assert.equal(verifySessionToken(payload, "secret", 1000), false);
  assert.equal(verifySessionToken(undefined, "secret"), false);
});
