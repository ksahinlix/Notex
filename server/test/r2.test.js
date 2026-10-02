// The S3 signature we send to Cloudflare R2 (D23). Signing it ourselves saves
// a large dependency for one PUT, but it also means a mistake would only show
// up in production, so the request we build is checked here in detail.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createR2 } from "../src/r2.js";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

const CREDS = {
  accountId: "acc123",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cr3t",
  bucket: "notex-backups",
};

/** Captures the request instead of sending it. */
function capture(response = { ok: true, status: 200, text: async () => "" }) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return response;
  };
  return seen;
}

test("no credentials, no client — backups are simply off", () => {
  assert.equal(createR2({}), null);
  assert.equal(createR2({ ...CREDS, bucket: "" }), null);
  assert.equal(createR2({ ...CREDS, secretAccessKey: undefined }), null);
  assert.ok(createR2(CREDS));
});

test("the PUT goes to the bucket and carries a well-formed signature", async () => {
  const seen = capture();
  const r2 = createR2(CREDS);
  const body = Buffer.from("hello");
  await r2.put("notex/2026/notex-20261002T140000Z.json.gz", body, "application/gzip");

  assert.equal(seen.length, 1);
  const { url, init } = seen[0];
  assert.equal(url, "https://acc123.r2.cloudflarestorage.com/notex-backups/notex/2026/notex-20261002T140000Z.json.gz");
  assert.equal(init.method, "PUT");
  assert.equal(init.headers["content-type"], "application/gzip");
  // `host` and `content-length` are left to fetch, which sets both from the
  // URL and the body. Host is the value the signature was built from;
  // content-length is not signed.
  assert.ok(!("host" in init.headers));
  assert.ok(!("content-length" in init.headers));
  assert.equal(init.body.length, 5);

  // The payload is signed, not sent as UNSIGNED-PAYLOAD.
  assert.equal(init.headers["x-amz-content-sha256"], crypto.createHash("sha256").update(body).digest("hex"));
  assert.match(init.headers["x-amz-date"], /^\d{8}T\d{6}Z$/);

  const date = init.headers["x-amz-date"].slice(0, 8);
  const auth = init.headers.authorization;
  assert.ok(
    auth.startsWith(
      `AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/${date}/auto/s3/aws4_request, ` +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=",
    ),
    `credential scope and signed headers: ${auth}`,
  );
  assert.match(auth, /Signature=[0-9a-f]{64}$/, "a 64-character hex signature");
});

test("a different body is a different signature", async () => {
  const seen = capture();
  const r2 = createR2(CREDS);
  await r2.put("k", Buffer.from("one"));
  await r2.put("k", Buffer.from("two"));
  const sig = (i) => /Signature=([0-9a-f]{64})/.exec(seen[i].init.headers.authorization)[1];
  assert.notEqual(sig(0), sig(1));
  assert.notEqual(seen[0].init.headers["x-amz-content-sha256"], seen[1].init.headers["x-amz-content-sha256"]);
});

test("a different secret is a different signature", async () => {
  const seen = capture();
  await createR2(CREDS).put("k", Buffer.from("same"));
  await createR2({ ...CREDS, secretAccessKey: "other" }).put("k", Buffer.from("same"));
  const sig = (i) => /Signature=([0-9a-f]{64})/.exec(seen[i].init.headers.authorization)[1];
  assert.notEqual(sig(0), sig(1));
});

test("a key with spaces or Turkish letters is escaped, but its slashes are not", async () => {
  const seen = capture();
  await createR2(CREDS).put("notex/Alışveriş listesi.json", Buffer.from("x"));
  assert.equal(
    seen[0].url,
    "https://acc123.r2.cloudflarestorage.com/notex-backups/notex/Al%C4%B1%C5%9Fveri%C5%9F%20listesi.json",
  );
});

test("R2 refusing the upload is reported, with what it said", async () => {
  capture({ ok: false, status: 403, text: async () => "<Error><Code>SignatureDoesNotMatch</Code></Error>" });
  await assert.rejects(() => createR2(CREDS).put("k", Buffer.from("x")), /R2 403.*SignatureDoesNotMatch/s);
});
