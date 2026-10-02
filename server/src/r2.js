// Cloudflare R2, the backup's home (D23).
//
// R2 speaks S3, and S3 wants AWS Signature V4. That is about sixty lines of
// hashing, so we sign it here rather than pull in the AWS SDK for one PUT.
// Without the credentials this returns null and backups are simply off, the
// way notifications are without VAPID keys (D21).
import crypto from "node:crypto";

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

/** The signing key is the secret walked through date, region and service. */
function signingKey(secret, datestamp, region, service) {
  return hmac(hmac(hmac(hmac("AWS4" + secret, datestamp), region), service), "aws4_request");
}

/**
 * Signs and sends one PUT. Only `host`, `x-amz-date` and `x-amz-content-sha256`
 * are signed: S3 requires every `x-amz-*` header to be, and content-type is
 * free to ride along unsigned.
 */
export function createR2({ accountId, accessKeyId, secretAccessKey, bucket, region = "auto" }) {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const host = `${accountId}.r2.cloudflarestorage.com`;

  return {
    bucket,
    /** PUTs one object. Returns its key, or throws with what R2 said. */
    async put(key, body, contentType = "application/octet-stream") {
      const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const now = new Date();
      const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
      const datestamp = amzdate.slice(0, 8);
      const scope = `${datestamp}/${region}/s3/aws4_request`;
      const hashed = sha256hex(payload);
      // The key may contain slashes, which stay as they are; everything else
      // is escaped the way S3 expects.
      const canonicalUri = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

      const canonicalRequest = [
        "PUT",
        canonicalUri,
        "",
        `host:${host}`,
        `x-amz-content-sha256:${hashed}`,
        `x-amz-date:${amzdate}`,
        "",
        "host;x-amz-content-sha256;x-amz-date",
        hashed,
      ].join("\n");

      const stringToSign = ["AWS4-HMAC-SHA256", amzdate, scope, sha256hex(canonicalRequest)].join("\n");
      const signature = hmac(signingKey(secretAccessKey, datestamp, region, "s3"), stringToSign).toString("hex");

      const res = await fetch(`https://${host}${canonicalUri}`, {
        method: "PUT",
        headers: {
          // `host` is not set here: fetch derives it from the URL, and it is
          // the value that was signed above.
          "x-amz-date": amzdate,
          "x-amz-content-sha256": hashed,
          "content-type": contentType,
          authorization:
            `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
            `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
        },
        body: payload,
      });
      if (!res.ok) throw new Error(`R2 ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return key;
    },
  };
}
