// AWS Signature Version 4, written with node:crypto alone: the Authorization header every request to AWS carries when
// the editor holds the person's own AWS credential. A request is signed over its method, path, query, the headers named
// in SignedHeaders (always host and x-amz-date, plus the session token and any x-amz-* or content-type the request
// sends) and the SHA-256 of its body, with a key derived from the secret for one day, region and service. The tests
// check it against AWS's published Signature Version 4 test suite.
import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";

/** The SHA-256 of bytes or text, as lowercase hex. @param {string | Buffer} data */
function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** @param {string | Buffer} key @param {string} data */
function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986 encoding as SigV4 wants it: every byte but A-Z a-z 0-9 - _ . ~ as %XY in capitals; "/" kept when asked.
 * @param {string} text @param {boolean} [keepSlash]
 */
function uriEncode(text, keepSlash = false) {
  return [...Buffer.from(String(text), "utf8")].map((byte) => {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/u.test(char) || (keepSlash && char === "/")) return char;
    return `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

/**
 * The canonical path: each segment of the path decoded and encoded once. The paths this engine sends hold only
 * unreserved characters, where AWS's single (S3) and double (every other service) encoding agree.
 * @param {string} path
 */
function canonicalPath(path) {
  const decoded = String(path || "/").split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  return decoded.map((segment) => uriEncode(segment)).join("/") || "/";
}

/** The canonical query: each name and value encoded, sorted by name then value. @param {URLSearchParams} params */
function canonicalQuery(params) {
  return [...params.entries()]
    .map(([name, value]) => [uriEncode(name), uriEncode(value)])
    .sort(([one, oneValue], [other, otherValue]) => (one < other ? -1 : one > other ? 1 : oneValue < otherValue ? -1 : oneValue > otherValue ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

/** The signing key of one day, region and service. @param {string} secret @param {string} day @param {string} region @param {string} service */
function signingKey(secret, day, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
}

/** AWS's request time, `YYYYMMDDTHHMMSSZ`. @param {Date} date */
function amzDate(date) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
}

/**
 * Signs a request: answers its headers with `x-amz-date`, the session token when there is one and `authorization`
 * added, the canonical request and the string to sign (for the tests; neither holds the secret).
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.url the full URL, its path percent-encoded as it is sent
 * @param {Record<string, string>} [request.headers] the headers sent, any case; host is taken from the URL
 * @param {string | Buffer} [request.body]
 * @param {string} request.service the signing name, such as ecs or s3
 * @param {string} request.region
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string | null }} request.credentials
 * @param {Date} [request.date]
 * @param {string} [request.payloadHash] the body's SHA-256 when it is given already (S3's x-amz-content-sha256)
 * @returns {{ headers: Record<string, string>, canonicalRequest: string, stringToSign: string }}
 */
function signRequest({ method, url, headers = {}, body = "", service, region, credentials, date = new Date(), payloadHash }) {
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) throw new TypeError("An AWS credential has an access key id and a secret access key.");
  const target = new URL(url);
  const time = amzDate(date);
  const day = time.slice(0, 8);
  const signed = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
  signed.host = target.host;
  signed["x-amz-date"] = time;
  if (credentials.sessionToken) signed["x-amz-security-token"] = credentials.sessionToken;
  const names = Object.keys(signed).filter((name) => name === "host" || name === "content-type" || name === "content-md5" || name.startsWith("x-amz-")).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed[name].trim().replace(/\s+/gu, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(target.pathname),
    canonicalQuery(target.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash ?? sha256Hex(body ?? "")
  ].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, time, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(credentials.secretAccessKey, day, region, service)).update(stringToSign, "utf8").digest("hex");
  const { host, ...sent } = signed;
  return {
    headers: { ...sent, authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    canonicalRequest,
    stringToSign
  };
}

export { amzDate, canonicalPath, canonicalQuery, sha256Hex, signRequest, signingKey, uriEncode };
