import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken } from "../src/auth.js";

test("session tokens carry the user id, are signed and expire", () => {
  const token = createSessionToken("secret", "user-1", 0);
  assert.equal(verifySessionToken(token, "secret", 1000), "user-1");
  assert.equal(verifySessionToken(token, "other-secret", 1000), null);
  assert.equal(verifySessionToken(token, "secret", 31 * 86400_000), null);
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 9e15 })).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${sig}`, "secret", 1000), null);
  assert.equal(verifySessionToken(payload, "secret", 1000), null);
  assert.equal(verifySessionToken(undefined, "secret"), null);
});
