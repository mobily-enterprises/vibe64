import { performance } from "node:perf_hooks";

// The deploy engine's client of Google Cloud's REST APIs: each call names the API (run, compute, sqladmin, storage,
// secretmanager, certificatemanager, artifactregistry, cloudbuild, iam, servicenetworking, cloudbilling,
// cloudresourcemanager) and its path below that API's root. It takes `{ baseUrl, credential }`: with no baseUrl each
// API is at https://<api>.googleapis.com, the person's own Google Cloud project reached directly; with one, every API
// is at `<baseUrl>/<api>`, the same calls through a gateway in front of Google. The credential is an access token, or a
// token source whose `token()` answers the token now and `refresh()` a new one after Google refused the last (401),
// tried once a request. Every request is JSON both ways but an upload (bytes with their content type), follows no
// redirect and is tried once: the engine's next step tries again. A refusal is a GoogleError with Google's
// `{ code, message, status, details }` or, for the older APIs, `{ code, message, errors: [{ reason }] }`.

// The older APIs' reasons that a thing is busy with another of its operations: tried again, as are no answer, a 5xx,
// the rate limit and a write that lost a race (ABORTED). Anything else is a refusal that waits for a person.
const BUSY = new Set(["operationInProgress", "resourceNotReady", "resourceInUseByAnotherResource", "ABORTED", "UNAVAILABLE"]);
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const API = /^[a-z][a-z0-9]{1,40}$/u;

/** Google's answer when it was not a success, or no answer (`status` null, code `unreachable`). */
class GoogleError extends Error {
  /**
   * @param {{ status: number | null, code: string, message: string, details?: unknown, retryable?: boolean }} answer
   */
  constructor({ status, code, message, details = null, retryable }) {
    super(message);
    this.name = "GoogleError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable ?? (status === null || status >= 500 || BUSY.has(code) || (status === 429 && code !== "quotaExceeded"));
  }
}

/**
 * The root a call to `api` goes to: https://<api>.googleapis.com directly, or `<baseUrl>/<api>/` through a gateway
 * (https, or http on this machine only: a stand-in or a tunnel).
 * @param {string | undefined} baseUrl @param {string} api
 */
function apiRoot(baseUrl, api) {
  if (!API.test(api)) throw new TypeError(`No Google API ${api}.`);
  if (!baseUrl) return new URL(`https://${api}.googleapis.com/`);
  const root = new URL(String(baseUrl));
  if (!(root.protocol === "https:" || (root.protocol === "http:" && LOOPBACK.has(root.hostname)))) {
    throw new TypeError(`The gateway's address is https://…, or http:// on this machine only; ${root.protocol} was given.`);
  }
  return new URL(`${root.pathname.replace(/\/+$/u, "")}/${api}/`, root);
}

/** The credential's access token now. @param {string | { token: () => string | Promise<string> }} credential */
async function tokenOf(credential) {
  const token = typeof credential === "string" ? credential : await credential.token();
  if (typeof token !== "string" || token.length === 0) throw new TypeError("The Google credential gave no token.");
  return token;
}

/** Google's error body as a GoogleError. @param {number} status @param {any} body */
function errorOf(status, body) {
  const error = body?.error ?? {};
  const reason = Array.isArray(error.errors) ? error.errors[0]?.reason : undefined;
  return new GoogleError({
    status,
    code: String(reason || error.status || `http_${status}`),
    message: String(error.message || `Google answered ${status}`),
    details: error.details ?? error.errors ?? null
  });
}

/**
 * The client.
 * @param {object} options
 * @param {string} [options.baseUrl] a gateway in front of Google's APIs; none: each API directly
 * @param {string | { token: () => string | Promise<string>, refresh?: () => string | Promise<string> }} options.credential
 * @param {typeof fetch} [options.fetch] the stand-in's in tests
 * @param {(entry: { api: string, method: string, path: string, status: number | null, errorCode: string | null, ms: number }) => void} [options.onRequest]
 *   told of each request, never its body: a body can hold secrets
 * @param {number} [options.timeoutMs]
 */
function createGoogleClient({ baseUrl, credential, fetch: fetchImpl = globalThis.fetch, onRequest = () => {}, timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (typeof credential !== "string" && typeof credential?.token !== "function") {
    throw new TypeError("A Google credential is an access token, or a token source with token().");
  }
  apiRoot(baseUrl, "run");

  async function exchange(api, method, path, { body, query, upload, raw }, token) {
    const url = new URL(path.replace(/^\/+/u, ""), apiRoot(baseUrl, api));
    for (const [name, value] of Object.entries(query ?? {})) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one !== undefined && one !== null && one !== "") url.searchParams.append(name, String(one));
      }
    }
    const headers = { accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "vibe64-deploy" };
    if (upload) headers["content-type"] = upload.contentType;
    else if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(url, {
      method,
      headers,
      body: upload ? upload.bytes : body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(upload ? Math.max(timeoutMs, UPLOAD_TIMEOUT_MS) : timeoutMs)
    });
    if (raw && response.status >= 200 && response.status < 300) return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: { code: response.status, message: "Google's answer was not JSON.", status: `http_${response.status}` } };
    }
    return { status: response.status, body: parsed };
  }

  /**
   * One request: answered with Google's body, or thrown as a GoogleError. A token source refused its token gets one
   * refresh and the same request again.
   * @param {string} api @param {string} method @param {string} path
   * @param {{ body?: unknown, query?: Record<string, unknown>, upload?: { bytes: Buffer, contentType: string }, raw?: boolean }} [request]
   *   `raw` answers a success's bytes as they are (an object's content)
   */
  async function call(api, method, path, request = {}) {
    let refreshed = false;
    for (;;) {
      const token = await tokenOf(credential);
      const started = performance.now();
      let answer = null;
      let failure = null;
      try {
        answer = await exchange(api, method, path, request, token);
      } catch (error) {
        failure = error;
      }
      const status = answer ? answer.status : null;
      const ok = status !== null && status >= 200 && status < 300;
      const error = answer && !ok ? errorOf(status, answer.body) : null;
      onRequest({ api, method, path, status, errorCode: failure ? "unreachable" : error?.code ?? null, ms: Math.round(performance.now() - started) });
      if (failure) throw new GoogleError({ status: null, code: "unreachable", message: `Google did not answer: ${failure.message}` });
      if (ok) return answer.body ?? {};
      if (status === 401 && !refreshed && typeof credential.refresh === "function") {
        refreshed = true;
        await credential.refresh();
        continue;
      }
      throw error;
    }
  }

  /**
   * Every item of a paged listing: `field` of each page, page after page by `nextPageToken`.
   * @param {string} api @param {string} path @param {string} field @param {Record<string, unknown>} [query]
   * @param {{ method?: string, pageSize?: string, size?: number }} [paging] `pageSize` the name the API gives its page
   *   size (Compute Engine's and Cloud SQL's is maxResults), `size` its largest
   */
  async function listAll(api, path, field, query = {}, { method = "GET", pageSize = "pageSize", size = PAGE_SIZE } = {}) {
    const items = [];
    let pageToken;
    do {
      const page = await call(api, method, path, { query: { ...query, [pageSize]: size, pageToken } });
      items.push(...(page[field] ?? []));
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
    return items;
  }

  /** A read answered null when Google has no such thing (404). @param {() => Promise<any>} read */
  async function orNull(read) {
    try {
      return await read();
    } catch (error) {
      if (error instanceof GoogleError && error.status === 404) return null;
      throw error;
    }
  }

  /** A create answered null when the thing is already there (409): made before, by a step cut short. @param {() => Promise<any>} create */
  async function orExisting(create) {
    try {
      return await create();
    } catch (error) {
      if (error instanceof GoogleError && error.status === 409 && ["ALREADY_EXISTS", "alreadyExists", "conflict"].includes(error.code)) return null;
      throw error;
    }
  }

  /** A removal answered null when Google no longer has it (404). @param {() => Promise<any>} remove */
  const removed = (remove) => orNull(remove);

  return Object.freeze({ call, listAll, orNull, orExisting, removed });
}

export { GoogleError, apiRoot, createGoogleClient };
