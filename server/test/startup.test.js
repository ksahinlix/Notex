import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDbError, migrateWithRetry, missingSettings } from "../src/startup.js";

test("missing settings are named", () => {
  assert.deepEqual(missingSettings({ DATABASE_URL: "x", SESSION_SECRET: "y", GOOGLE_CLIENT_ID: "z" }), []);
  assert.deepEqual(missingSettings({ DATABASE_URL: "x" }), ["SESSION_SECRET", "GOOGLE_CLIENT_ID"]);
});

test("database errors become short reasons without secrets", () => {
  const cases = [
    [{ code: "28P01", message: "password authentication failed for user 'neondb_owner'" }, /wrong database password/],
    [{ message: "Your project has exceeded the compute time quota" }, /free quota/],
    [{ message: "The endpoint has been disabled. Enable it using Neon API and retry." }, /disabled or deleted/],
    [{ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND ep-x.neon.tech" }, /host not found/],
    [{ message: "Connection terminated due to connection timeout" }, /did not answer in time/],
    [{ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }, /refused/],
    [{ code: "XX000", message: "something else" }, /database error \(XX000\)/],
  ];
  for (const [err, expected] of cases) {
    const reason = describeDbError(err);
    assert.match(reason, expected);
    assert.doesNotMatch(reason, /neondb_owner|ep-x/);
  }
});

test("the schema is retried until the database answers", async () => {
  let calls = 0;
  const pool = { query: async () => { if (++calls < 3) throw Object.assign(new Error("timeout"), {}); } };
  const logs = [];
  const log = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  await migrateWithRetry(pool, "select 1", { delayMs: 1, log });
  assert.equal(calls, 3);
  assert.match(logs.at(-1), /Schema applied \(attempt 3\)/);
  assert.equal(logs.filter((m) => /not applied/.test(m)).length, 2);
});
