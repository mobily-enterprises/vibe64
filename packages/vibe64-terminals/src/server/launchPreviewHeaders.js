// Preview proxy headers: what is forwarded to the app and back, the Preview access token, its cookie and
// query parameter, and the origins and redirects the browser sees.

import crypto from "node:crypto";
import { withoutWideningCookieDomain } from "@local/vibe64-core/server/cookieDomainGuard";
import { isLoopbackAddress } from "@local/vibe64-core/server/localStudioRequest";
import { USAGE_RECORDING_INTERACTION_HEADER, USAGE_RECORDING_REQUEST_HEADER } from "@local/vibe64-usage-recording/shared/contract";
import { PREVIEW_PROXY_TOKEN_QUERY_PARAM } from "../shared/launchPreviewProtocol.js";

const HTML_CONTENT_TYPE_PATTERN = /\btext\/html\b/iu;

const PREVIEW_PROXY_TOKEN_COOKIE = PREVIEW_PROXY_TOKEN_QUERY_PARAM;

const VIBE64_LAUNCH_ALIAS_PATTERN = /^vibe64-launch-[a-f0-9]{12}$/u;

function normalizePreviewTargetHref(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error("Launch preview target URL is missing.");
  }
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Launch preview target URL must use HTTP.");
  }
  if (!isLoopbackAddress(url.hostname) && !VIBE64_LAUNCH_ALIAS_PATTERN.test(url.hostname)) {
    throw new Error("Launch preview target URL must be loopback.");
  }
  return url;
}

/**
 * The proxy alone names recorded requests: a client's own recording headers
 * never reach the application.
 */
function stripUsageRecordingHeaders(headers) {
  delete headers[USAGE_RECORDING_REQUEST_HEADER];
  delete headers[USAGE_RECORDING_INTERACTION_HEADER];
  return headers;
}

function proxyRequestHeaders(headers, targetUrl, options = {}) {
  const {
    clientAddress = "",
    freshDocument = false,
    proxyOrigin = "",
    targetHost = "",
    usageRequestId = ""
  } = options;
  const nextHeaders = stripUsageRecordingHeaders({ ...headers });
  if (usageRequestId) {
    nextHeaders[USAGE_RECORDING_REQUEST_HEADER] = usageRequestId;
  }
  delete nextHeaders["accept-encoding"];
  delete nextHeaders.connection;
  delete nextHeaders.host;
  delete nextHeaders.upgrade;
  if (freshDocument) {
    delete nextHeaders["if-modified-since"];
    delete nextHeaders["if-none-match"];
  }
  const cookie = stripPreviewTokenCookie(nextHeaders.cookie, { proxyOrigin });
  if (cookie) {
    nextHeaders.cookie = cookie;
  } else {
    delete nextHeaders.cookie;
  }
  nextHeaders["accept-encoding"] = "identity";
  nextHeaders.host = targetHost || targetUrl.host;
  forwardedHeaders(nextHeaders, proxyOrigin, clientAddress);
  remapPreviewOrigin(nextHeaders, proxyOrigin);
  return nextHeaders;
}

function proxyUpgradeHeaders(headers, targetUrl, options = {}) {
  const {
    clientAddress = "",
    proxyOrigin = "",
    targetHost = ""
  } = options;
  const nextHeaders = stripUsageRecordingHeaders({ ...headers });
  const cookie = stripPreviewTokenCookie(nextHeaders.cookie, { proxyOrigin });
  if (cookie) {
    nextHeaders.cookie = cookie;
  } else {
    delete nextHeaders.cookie;
  }
  nextHeaders.host = targetHost || targetUrl.host;
  forwardedHeaders(nextHeaders, proxyOrigin, clientAddress);
  remapPreviewOrigin(nextHeaders, proxyOrigin);
  return nextHeaders;
}

function forwardedHeaders(headers, browserOrigin, clientAddress = "") {
  // Host addresses the loopback app. Proxy-aware apps build absolute URLs and
  // secure cookies from these, so only the proxy's own origin supplies them.
  // X-Forwarded-For names the proxy's own TCP peer, never a value that peer
  // sent. A private Unix-socket listener is reached only through the host's
  // ingress, so its X-Forwarded-For chain is kept.
  for (const name of Object.keys(headers)) {
    if (name === "forwarded" || (name.startsWith("x-forwarded-") && name !== "x-forwarded-for")) {
      delete headers[name];
    }
  }
  if (clientAddress) {
    headers["x-forwarded-for"] = clientAddress;
  }
  if (!browserOrigin) {
    return;
  }
  const url = new URL(browserOrigin);
  headers["x-forwarded-host"] = url.host;
  headers["x-forwarded-proto"] = url.protocol.slice(0, -1);
  headers["x-forwarded-port"] = url.port || (url.protocol === "https:" ? "443" : "80");
}

function presentsOnLoopbackOrigin(headers, proxyOrigin) {
  return Boolean(proxyOrigin) && headers?.origin === proxyOrigin;
}

function remapPreviewOrigin(headers, proxyOrigin) {
  // Host addresses the loopback app. Translate only this preview's own browser
  // origin to match it; foreign and opaque origins must still fail app checks.
  // The forwarded host and port go too, so an app that trusts them compares
  // the same loopback origin; only the browser-facing scheme is kept.
  if (presentsOnLoopbackOrigin(headers, proxyOrigin)) {
    const protocol = new URL(proxyOrigin).protocol;
    headers.origin = new URL(`${protocol}//${headers.host}`).origin;
    delete headers["x-forwarded-host"];
    delete headers["x-forwarded-port"];
  }
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    if (!name) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      cookies[name] = part.slice(separatorIndex + 1).trim();
    }
  }
  return cookies;
}

/**
 * A token belongs to one session's Preview at one public origin. The app run
 * behind it, its terminal and loopback port, changes on every restart and so
 * is no part of the token's scope.
 */
function previewTokenScopeMaterial({
  projectScope = "",
  publicOrigin = "",
  sessionId = ""
} = {}) {
  return JSON.stringify([
    String(projectScope || "").trim(),
    String(sessionId || "").trim(),
    String(publicOrigin || "").trim()
  ]);
}

function previewTokenHash(token = "", scope = {}) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .update("\0")
    .update(previewTokenScopeMaterial(scope))
    .digest("hex");
}

function tokenMatches(token = "", expectedHash = "", scope = {}) {
  const tokenHash = Buffer.from(previewTokenHash(token, scope), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return tokenHash.length === expected.length && crypto.timingSafeEqual(tokenHash, expected);
}

function previewRequestToken(request, requestUrl, options = {}) {
  const {
    proxyOrigin = ""
  } = options;
  const cookies = parseCookies(request.headers?.cookie || "");
  return requestUrl.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM) ||
    cookies[previewTokenCookieName(proxyOrigin)] ||
    "";
}

function previewRequestTokenDiagnostics(request, requestUrl, options = {}) {
  const {
    proxyOrigin = ""
  } = options;
  const cookieName = previewTokenCookieName(proxyOrigin);
  const cookies = parseCookies(request.headers?.cookie || "");
  return {
    cookieName,
    hasCookieToken: Boolean(cookies[cookieName]),
    hasQueryToken: requestUrl.searchParams.has(PREVIEW_PROXY_TOKEN_QUERY_PARAM)
  };
}

/**
 * HTTPS Preview gates use a __Host- cookie: Secure, Path=/ and no Domain, so a
 * sibling host under the same parent domain cannot set or replace it.
 */
function previewTokenCookieName(proxyOrigin = "") {
  try {
    const url = new URL(proxyOrigin);
    const https = url.protocol === "https:";
    const suffix = url.port || (https ? "443" : "80");
    return `${https ? "__Host-" : ""}${PREVIEW_PROXY_TOKEN_COOKIE}_${suffix}`;
  } catch {
    return PREVIEW_PROXY_TOKEN_COOKIE;
  }
}

/**
 * An HTTPS Preview is on another site than the editor that frames it (a host
 * gives Previews a domain of their own), so its cookies are third-party ones
 * in the editor's Preview pane: SameSite=None lets the pane send them, and
 * Partitioned keeps them to the site of the page that frames the Preview, so a
 * browser that blocks third-party cookies still keeps them there. A page of
 * another site that frames the Preview gets a partition of its own, with no
 * token cookie and so no application page; a Preview opened in its own tab is
 * its own site's page and gets its token from its address, as the pane does.
 */
const CROSS_SITE_COOKIE_ATTRIBUTES = Object.freeze(["Secure", "SameSite=None", "Partitioned"]);

function previewTokenCookie(token = "", options = {}) {
  const {
    proxyOrigin = ""
  } = options;
  // An HTTP Preview runs on this computer beside its editor, on the editor's
  // own loopback name (vibe64LaunchPreviewDestination's sameSiteLoopbackPreviewUrl),
  // so it is same-site with it and Lax suffices; a browser need not keep a
  // Secure cookie there.
  const policy = previewOriginUsesHttps(proxyOrigin)
    ? `HttpOnly; ${CROSS_SITE_COOKIE_ATTRIBUTES.join("; ")}`
    : "SameSite=Lax; HttpOnly";
  return `${previewTokenCookieName(proxyOrigin)}=${encodeURIComponent(String(token || ""))}; Path=/; ${policy}`;
}

/**
 * One app cookie as an HTTPS Preview's browser gets it: the app's own
 * SameSite, Secure and Partitioned give way to the Preview's cross-site ones
 * (CROSS_SITE_COOKIE_ATTRIBUTES), so signing in to the app inside the pane
 * keeps working; every other attribute is the app's.
 * @param {string} header
 */
function crossSiteSetCookie(header = "") {
  const [pair = "", ...attributes] = String(header || "").split(";");
  const kept = attributes.filter((part) => !["partitioned", "samesite", "secure"].includes(cookiePairName(part).toLowerCase()));
  return [pair, ...kept, ...CROSS_SITE_COOKIE_ATTRIBUTES.map((attribute) => ` ${attribute}`)].join(";");
}

/**
 * The app's Set-Cookie headers as the browser gets them from its Preview: no
 * Domain attribute shares a cookie beyond the Preview's own host (each one
 * taken off is reported, so a project that tries it shows in the log), and an
 * HTTPS Preview's cookies are cross-site ones (crossSiteSetCookie).
 * @template {string | string[] | undefined} T
 * @param {T} value one header, a list of them, or none
 * @param {{ proxyOrigin?: string, reportWidenedCookieDomain?: (widened: { cookie: string, domain: string, host: string }) => void }} [options]
 * @returns {T}
 */
function previewSetCookies(value, options = {}) {
  const {
    proxyOrigin = "",
    reportWidenedCookieDomain = ignoreWidenedCookieDomain
  } = options;
  if (value === undefined) {
    return value;
  }
  const host = previewOriginHost(proxyOrigin);
  const https = previewOriginUsesHttps(proxyOrigin);
  const headers = (Array.isArray(value) ? value : [value]).map((entry) => {
    const guarded = withoutWideningCookieDomain(String(entry ?? ""), host);
    for (const domain of guarded.widenedDomains) {
      reportWidenedCookieDomain({ cookie: guarded.name, domain, host });
    }
    return https ? crossSiteSetCookie(guarded.header) : guarded.header;
  });
  return /** @type {T} */ (Array.isArray(value) ? headers : headers[0]);
}

function ignoreWidenedCookieDomain() {}

/** The host name of a Preview's origin, or "" for none. */
function previewOriginHost(value = "") {
  try {
    return new URL(String(value || "")).hostname;
  } catch {
    return "";
  }
}

function previewOriginUsesHttps(value = "") {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The app sees the browser's cookies without this proxy's token cookie.
 */
function stripPreviewTokenCookie(header = "", options = {}) {
  const {
    proxyOrigin = ""
  } = options;
  const cookieName = previewTokenCookieName(proxyOrigin);
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && cookiePairName(part) !== cookieName)
    .join("; ");
}

/**
 * The name of one `name=value` cookie pair; a bare token is all name.
 */
function cookiePairName(part = "") {
  const separatorIndex = part.indexOf("=");
  return (separatorIndex < 0 ? part : part.slice(0, separatorIndex)).trim();
}

function responseHeaders(response, options = {}) {
  const {
    injected = false,
    proxyOrigin = "",
    reportWidenedCookieDomain = ignoreWidenedCookieDomain,
    targetOrigin = ""
  } = options;
  const headers = {};
  for (const [key, value] of Object.entries(response.headers || {})) {
    if (value !== undefined) {
      headers[key] = value;
    }
  }
  if (headers["set-cookie"] !== undefined) {
    headers["set-cookie"] = previewSetCookies(headers["set-cookie"], { proxyOrigin, reportWidenedCookieDomain });
  }
  delete headers["content-length"];
  if (injected) {
    headers["cache-control"] = "no-store";
    delete headers["content-encoding"];
    delete headers.etag;
    delete headers.expires;
    delete headers["last-modified"];
  }
  if (headers.location && proxyOrigin && targetOrigin) {
    headers.location = proxiedLocation(headers.location, {
      proxyOrigin,
      targetOrigin
    });
  }
  headers.connection = "close";
  return headers;
}

function requestAcceptsHtml(request) {
  const accept = String(request?.headers?.accept || "");
  return !accept || HTML_CONTENT_TYPE_PATTERN.test(accept) || accept.includes("*/*");
}

function requestHeader(request, name = "") {
  const headers = request?.headers || {};
  const key = String(name || "").toLowerCase();
  const value = headers[key] ?? headers[name];
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function requestPreviewOrigin(request, proxyOrigin) {
  const proxyUrl = new URL(proxyOrigin);
  if (!isLoopbackAddress(proxyUrl.hostname)) {
    return proxyOrigin;
  }
  try {
    const host = requestHeader(request, "host").toLowerCase();
    const requestOrigin = new URL(`${proxyUrl.protocol}//${host}`);
    return requestOrigin.host === host &&
      isLoopbackAddress(requestOrigin.hostname) &&
      requestOrigin.port === proxyUrl.port
      ? requestOrigin.origin
      : proxyOrigin;
  } catch {
    return proxyOrigin;
  }
}

function requestIsBrowserDocumentNavigation(request) {
  const fetchDest = requestHeader(request, "sec-fetch-dest").toLowerCase();
  const fetchMode = requestHeader(request, "sec-fetch-mode").toLowerCase();
  const accept = requestHeader(request, "accept");
  return ["document", "iframe"].includes(fetchDest) ||
    fetchMode === "navigate" ||
    HTML_CONTENT_TYPE_PATTERN.test(accept);
}

function requestShouldCleanPreviewToken(request, requestUrl) {
  const method = String(request?.method || "GET").toUpperCase();
  return ["GET", "HEAD"].includes(method) &&
    requestUrl.searchParams.has(PREVIEW_PROXY_TOKEN_QUERY_PARAM) &&
    requestIsBrowserDocumentNavigation(request);
}

function cleanPreviewTokenRedirectLocation(requestUrl) {
  const redirectUrl = new URL(requestUrl.toString());
  redirectUrl.search = stripPreviewTokenQueryParam(redirectUrl.search);
  return redirectUrl.toString();
}

function proxiedLocation(location = "", options = {}) {
  const {
    proxyOrigin = "",
    targetOrigin = ""
  } = options;
  const text = String(location || "").trim();
  if (!text || !proxyOrigin || !targetOrigin) {
    return text;
  }
  try {
    const target = new URL(text, targetOrigin);
    const proxy = new URL(proxyOrigin);
    const forwardedTarget = new URL(targetOrigin);
    forwardedTarget.protocol = proxy.protocol;
    if (target.origin !== targetOrigin && target.origin !== forwardedTarget.origin) {
      return text;
    }
    proxy.pathname = target.pathname;
    proxy.search = stripPreviewTokenQueryParam(target.search);
    proxy.hash = target.hash;
    return proxy.toString();
  } catch {
    return text;
  }
}

function targetRequestUrl(requestUrl = "/", targetOrigin = "") {
  const url = new URL(String(requestUrl || "/"), targetOrigin);
  if (url.origin !== targetOrigin) {
    throw new Error("Launch preview request escaped the target origin.");
  }
  url.search = stripPreviewTokenQueryParam(url.search);
  return url;
}

function stripPreviewTokenQueryParam(search = "") {
  const text = String(search || "");
  if (!text || text === "?") {
    return "";
  }
  const query = text.startsWith("?") ? text.slice(1) : text;
  if (!query) {
    return "";
  }
  const parts = query.split("&").filter((part) => {
    const separatorIndex = part.indexOf("=");
    const rawName = separatorIndex < 0 ? part : part.slice(0, separatorIndex);
    return queryParamName(rawName) !== PREVIEW_PROXY_TOKEN_QUERY_PARAM;
  });
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function appendPreviewTokenQueryParam(search = "", token = "") {
  const text = String(search || "");
  const tokenPart = `${encodeURIComponent(PREVIEW_PROXY_TOKEN_QUERY_PARAM)}=${encodeURIComponent(String(token || ""))}`;
  if (!text || text === "?") {
    return `?${tokenPart}`;
  }
  return `${text}&${tokenPart}`;
}

function queryParamName(rawName = "") {
  try {
    return decodeURIComponent(String(rawName || "").replace(/\+/gu, " "));
  } catch {
    return String(rawName || "");
  }
}

function previewResponseHeaders(response, options = {}) {
  const headers = responseHeaders(response, options);
  appendResponseHeader(headers, "set-cookie", previewTokenCookie(options.token, options));
  return headers;
}

/**
 * An editor origin is the scheme, host and port of the page that shows the
 * Preview; anything else cannot name a page that frames it.
 */
function normalizePreviewEditorOrigin(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

function appendResponseHeader(headers, name, value) {
  const current = headers[name];
  if (!current) {
    headers[name] = value;
    return;
  }
  headers[name] = Array.isArray(current) ? [...current, value] : [current, value];
}

const __testables = Object.freeze({ previewTokenCookieName, proxiedLocation });

export {
  appendPreviewTokenQueryParam,
  cleanPreviewTokenRedirectLocation,
  HTML_CONTENT_TYPE_PATTERN,
  normalizePreviewEditorOrigin,
  normalizePreviewTargetHref,
  presentsOnLoopbackOrigin,
  previewOriginHost,
  previewRequestToken,
  previewRequestTokenDiagnostics,
  previewResponseHeaders,
  previewSetCookies,
  previewTokenCookie,
  previewTokenHash,
  proxyRequestHeaders,
  proxyUpgradeHeaders,
  requestAcceptsHtml,
  requestHeader,
  requestIsBrowserDocumentNavigation,
  requestPreviewOrigin,
  requestShouldCleanPreviewToken,
  stripPreviewTokenQueryParam,
  targetRequestUrl,
  tokenMatches,
  VIBE64_LAUNCH_ALIAS_PATTERN,
  __testables
};
