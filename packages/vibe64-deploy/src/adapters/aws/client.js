import { performance } from "node:perf_hooks";

import { sha256Hex, signRequest } from "./sigv4.js";
import { parseXml } from "./xml.js";

// The deploy engine's client of AWS: one region of one AWS account, in AWS's three wire protocols. JSON 1.1 (ECS, ECR,
// CodeBuild, Secrets Manager, CloudWatch Logs, ACM, Cloud Map and the Price List: a POST naming its
// action in X-Amz-Target), Query (EC2, Auto Scaling, Elastic Load Balancing, RDS, IAM: a form POST naming Action and
// Version, answered in XML) and S3's REST. It takes `{ region, credential }`, the credential one of:
//
//   - the person's own: `{ accessKeyId, secretAccessKey, sessionToken? }`, or a source of short-lived ones
//     (`{ credentials(), refresh? }`); each request is signed here with Signature Version 4 (sigv4.js);
//   - a gateway that signs: `{ gateway, token(), refresh? }`, its https address and a short-lived token. Each request
//     goes to `<gateway>/<signing name>/<signing region>/<AWS host><path>` with the token as its bearer and no AWS
//     signature; the gateway signs it with an account's credential it keeps and forwards it to the host.
//
// Every request follows no redirect and is tried once: the engine's next step tries again. A refusal is an AwsError
// with AWS's code and message and `retryable` (no answer, a 5xx or a throttle may answer later; anything else waits
// for a person). `onRequest` hears of each request, never its body or headers: they can hold secrets.

const JSON_TARGETS = Object.freeze({
  ecs: "AmazonEC2ContainerServiceV20141113",
  ecr: "AmazonEC2ContainerRegistry_V20150921",
  codebuild: "CodeBuild_20161006",
  secretsmanager: "secretsmanager",
  logs: "Logs_20140328",
  acm: "CertificateManager",
  servicediscovery: "Route53AutoNaming_v20170314",
  pricing: "AWSPriceListService"
});
const QUERY_VERSIONS = Object.freeze({
  ec2: "2016-11-15",
  autoscaling: "2011-01-01",
  elasticloadbalancing: "2015-12-01",
  rds: "2014-10-31",
  iam: "2010-05-08"
});
// The errors that may answer later: throttles and AWS's own failures. A credential that expired gets one refresh.
const RETRYABLE = new Set([
  "Throttling", "ThrottlingException", "ThrottledException", "RequestLimitExceeded", "TooManyRequestsException", "SlowDown",
  "RequestThrottled", "RequestThrottledException", "PriorRequestNotComplete", "ServiceUnavailable", "ServiceUnavailableException",
  "InternalError", "InternalFailure", "InternalServerError", "ServerException", "unreachable"
]);
const EXPIRED = new Set(["ExpiredToken", "ExpiredTokenException", "RequestExpired", "unauthenticated"]);
const REQUEST_TIMEOUT_MS = 30_000;
// An upload (a service's release: at most about 48 MiB) has longer.
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/u;

/** AWS's answer when it was not a success, or no answer at all (`status` null, code `unreachable`). */
class AwsError extends Error {
  /** @param {{ status: number | null, code: string, message: string, requestId?: string | null, service?: string, retryable?: boolean }} answer */
  constructor({ status, code, message, requestId = null, service = "", retryable }) {
    super(message);
    this.name = "AwsError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.service = service;
    this.retryable = retryable ?? (RETRYABLE.has(code) || status === null || status >= 500 || status === 429);
  }
}

/**
 * Where a service of a region answers, and the name and region its requests are signed for.
 * @param {string} service @param {string} region @param {string} [bucket] S3's bucket, addressed by its own host
 */
function endpointOf(service, region, bucket) {
  if (service === "iam") return { host: "iam.amazonaws.com", signingName: "iam", signingRegion: "us-east-1" };
  if (service === "pricing") return { host: "api.pricing.us-east-1.amazonaws.com", signingName: "pricing", signingRegion: "us-east-1" };
  if (service === "ecr") return { host: `api.ecr.${region}.amazonaws.com`, signingName: "ecr", signingRegion: region };
  if (service === "s3") return { host: bucket ? `${bucket}.s3.${region}.amazonaws.com` : `s3.${region}.amazonaws.com`, signingName: "s3", signingRegion: region };
  return { host: `${service}.${region}.amazonaws.com`, signingName: service, signingRegion: region };
}

/** The error AWS answered, from its JSON or XML body, whichever the protocol uses. */
function errorOf({ status, text, headers, service }) {
  const requestId = headers.get("x-amzn-requestid") ?? headers.get("x-amz-request-id") ?? null;
  let code = headers.get("x-amzn-errortype")?.split(":")[0] ?? "";
  let message = "";
  let id = requestId;
  if (text.trim().startsWith("{")) {
    try {
      const body = JSON.parse(text);
      code ||= String(body.__type ?? body.code ?? "");
      message = String(body.message ?? body.Message ?? "");
    } catch {
      // Not JSON after all: the status speaks.
    }
  } else if (text.trim().startsWith("<")) {
    try {
      const { name, value } = parseXml(text);
      const error = name === "Response" ? value.Errors?.Error : name === "ErrorResponse" ? value.Error : value;
      code ||= String(error?.Code ?? "");
      message = String(error?.Message ?? "");
      id = value.RequestID ?? value.RequestId ?? error?.RequestId ?? requestId;
    } catch {
      // Not XML after all: the status speaks.
    }
  }
  code = code.includes("#") ? code.split("#").pop() : code;
  return new AwsError({ status, code: code || (status === 404 ? "NotFound" : `http_${status}`), message: message || `AWS ${service} answered ${status}.`, requestId: id, service });
}

/**
 * Query parameters as AWS's Query protocol takes them: nested objects and lists flattened to `A.B.1.C`, a list's items
 * numbered from 1 under the member name the caller writes into the key (`Tags.member`, `SubnetIds.SubnetIdentifier`,
 * or none for EC2). Values undefined or null are left out; booleans are `true` or `false`.
 * @param {Record<string, unknown>} params @param {string} [prefix]
 * @returns {Array<[string, string]>}
 */
function flatParams(params, prefix = "") {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") pairs.push(...flatParams(item, `${name}.${index + 1}`));
        else pairs.push([`${name}.${index + 1}`, String(item)]);
      });
    } else if (typeof value === "object") pairs.push(...flatParams(value, name));
    else pairs.push([name, String(value)]);
  }
  return pairs;
}

/**
 * The client.
 * @param {object} options
 * @param {string} options.region such as us-east-1
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string } | { credentials: () => any, refresh?: () => any } | { gateway: string, token: () => string | Promise<string>, refresh?: () => any }} options.credential
 * @param {typeof fetch} [options.fetch] the stand-in's in tests
 * @param {(entry: { service: string, action: string, status: number | null, errorCode: string | null, requestId: string | null, ms: number }) => void} [options.onRequest]
 * @param {() => Date} [options.now] the signing time
 * @param {number} [options.timeoutMs]
 */
function createAwsClient({ region, credential, fetch: fetchImpl = globalThis.fetch, onRequest = () => {}, now = () => new Date(), timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (!REGION.test(String(region ?? ""))) throw new TypeError("An AWS region is a name such as us-east-1.");
  const gateway = credential?.gateway ? new URL(credential.gateway) : null;
  if (gateway && !(gateway.protocol === "https:" || (gateway.protocol === "http:" && LOOPBACK.has(gateway.hostname)))) {
    throw new TypeError(`The gateway's address is https://…, or http:// on this machine only; ${gateway.protocol} was given.`);
  }
  if (gateway ? typeof credential.token !== "function" : !(credential?.accessKeyId || typeof credential?.credentials === "function")) {
    throw new TypeError("An AWS credential is an access key (or a source of them), or a gateway with a token.");
  }

  /** The keys to sign with now. */
  async function keysNow() {
    const keys = typeof credential.credentials === "function" ? await credential.credentials() : credential;
    if (!keys?.accessKeyId || !keys?.secretAccessKey) throw new TypeError("The AWS credential gave no access key.");
    return keys;
  }

  /**
   * One exchange: the request signed (or sent through the gateway with its token), its status, headers and text.
   * @param {{ service: string, method: string, host: string, path: string, query?: URLSearchParams, headers: Record<string, string>, body?: string | Buffer, signing: { name: string, region: string }, upload?: boolean, payloadHash?: string }} request
   */
  async function exchange({ method, host, path, query, headers, body, signing, upload, payloadHash }) {
    const search = query && [...query].length > 0 ? `?${query}` : "";
    let url;
    let sent;
    if (gateway) {
      url = new URL(`${gateway.pathname.replace(/\/$/u, "")}/${signing.name}/${signing.region}/${host}${path}${search}`, gateway);
      sent = { ...headers, authorization: `Bearer ${await credential.token()}` };
    } else {
      url = new URL(`https://${host}${path}${search}`);
      sent = signRequest({ method, url: String(url), headers, body, service: signing.name, region: signing.region, credentials: await keysNow(), date: now(), payloadHash }).headers;
    }
    const response = await fetchImpl(url, {
      method,
      headers: sent,
      body: body === undefined || method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
      signal: AbortSignal.timeout(upload ? Math.max(timeoutMs, UPLOAD_TIMEOUT_MS) : timeoutMs)
    });
    return { status: response.status, headers: response.headers, text: method === "HEAD" ? "" : await response.text() };
  }

  /** A request answered with its status, headers and text, or thrown as an AwsError; an expired credential refreshes once. */
  async function call(request, action) {
    let refreshed = false;
    for (;;) {
      const started = performance.now();
      let answer = null;
      let failure = null;
      try {
        answer = await exchange(request);
      } catch (error) {
        failure = error;
      }
      const ok = answer && answer.status >= 200 && answer.status < 300;
      const error = failure
        ? new AwsError({ status: null, code: "unreachable", message: `AWS ${request.service} did not answer: ${failure.message}`, service: request.service })
        : ok ? null : errorOf({ ...answer, service: request.service });
      onRequest({
        service: request.service,
        action,
        status: answer?.status ?? null,
        errorCode: error?.code ?? null,
        requestId: error?.requestId ?? answer?.headers.get("x-amzn-requestid") ?? answer?.headers.get("x-amz-request-id") ?? null,
        ms: Math.round(performance.now() - started)
      });
      if (!error) return answer;
      if (EXPIRED.has(error.code) && !refreshed && typeof credential.refresh === "function") {
        refreshed = true;
        await credential.refresh();
        continue;
      }
      throw error;
    }
  }

  /**
   * A JSON 1.1 action: `json("ecs", "CreateService", { ... })`, answered with AWS's JSON body.
   * @param {keyof typeof JSON_TARGETS} service @param {string} action @param {object} [body]
   */
  async function json(service, action, body = {}) {
    const { host, signingName, signingRegion } = endpointOf(service, region);
    const answer = await call({
      service,
      method: "POST",
      host,
      path: "/",
      headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `${JSON_TARGETS[service]}.${action}` },
      body: JSON.stringify(body),
      signing: { name: signingName, region: signingRegion }
    }, action);
    return answer.text ? JSON.parse(answer.text) : {};
  }

  /**
   * A Query action: `query("rds", "CreateDBInstance", { ... })`, answered with its result element as plain values
   * (xml.js): the `<Action>Result>` of most services, the whole answer of EC2's.
   * @param {keyof typeof QUERY_VERSIONS} service @param {string} action @param {Record<string, unknown>} [params]
   */
  async function query(service, action, params = {}) {
    const { host, signingName, signingRegion } = endpointOf(service, region);
    const form = new URLSearchParams([["Action", action], ["Version", QUERY_VERSIONS[service]], ...flatParams(params)]);
    const answer = await call({
      service,
      method: "POST",
      host,
      path: "/",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: String(form),
      signing: { name: signingName, region: signingRegion }
    }, action);
    const { value } = parseXml(answer.text);
    return value?.[`${action}Result`] ?? value ?? {};
  }

  /**
   * An S3 request of a bucket: answered with its status, headers and body (text, or XML as plain values). A body is sent
   * with its SHA-256 (x-amz-content-sha256) and, for the XML of a bucket's settings, its Content-MD5.
   * @param {string} method @param {string} bucket @param {string} key the object's key, or "" for the bucket
   * @param {{ query?: Record<string, string>, body?: string | Buffer, headers?: Record<string, string>, md5?: string }} [request]
   */
  async function s3(method, bucket, key, { query: params = {}, body, headers = {}, md5 } = {}) {
    const { host, signingName, signingRegion } = endpointOf("s3", region, bucket);
    const payloadHash = sha256Hex(body ?? "");
    const answer = await call({
      service: "s3",
      method,
      host,
      path: `/${key.split("/").map(encodeURIComponent).join("/")}`,
      query: new URLSearchParams(params),
      headers: { ...headers, "x-amz-content-sha256": payloadHash, ...(md5 ? { "content-md5": md5 } : {}) },
      body,
      signing: { name: signingName, region: signingRegion },
      upload: Buffer.isBuffer(body),
      payloadHash
    }, `${method} ${key ? "object" : Object.keys(params)[0] ?? "bucket"}`);
    const xml = answer.text.trim().startsWith("<") ? parseXml(answer.text).value : null;
    return { status: answer.status, headers: answer.headers, text: answer.text, xml };
  }

  return Object.freeze({ region, json, query, s3 });
}

export { AwsError, JSON_TARGETS, QUERY_VERSIONS, createAwsClient, endpointOf, flatParams };
