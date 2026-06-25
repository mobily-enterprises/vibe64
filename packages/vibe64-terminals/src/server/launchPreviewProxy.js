import {
  createServer,
  request as httpRequest
} from "node:http";
import {
  request as httpsRequest
} from "node:https";
import crypto from "node:crypto";
import {
  chmod,
  mkdir,
  unlink
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import {
  isLoopbackAddress
} from "@local/vibe64-core/server/localStudioRequest";
import {
  PREVIEW_PROXY_HOST_ENV,
  PREVIEW_PROXY_PORT_END,
  PREVIEW_PROXY_PORT_START,
  PREVIEW_PROXY_PUBLIC_HOST_ENV,
  previewProxyPortRange
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import {
  normalizePreviewAuthKind,
  previewAuthCookieNames,
  previewAuthCookieHeader
} from "@local/vibe64-core/server/previewAuth";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

import {
  injectLaunchPreviewBridge
} from "./launchPreviewBridge.js";

const LOOPBACK_HOST = "127.0.0.1";
const HTML_CONTENT_TYPE_PATTERN = /\btext\/html\b/iu;
const REQUEST_BODY_METHODS = new Set(["PATCH", "POST", "PUT"]);
const PREVIEW_PROXY_TOKEN_QUERY_PARAM = "vibe64_preview_token";
const PREVIEW_PROXY_TOKEN_COOKIE = "vibe64_preview_token";
const PREVIEW_PROXY_SOCKET_DIR_ENV = "VIBE64_PREVIEW_PROXY_SOCKET_DIR";
const PREVIEW_PROXY_DEBUG_ENV = "VIBE64_PREVIEW_DEBUG";
const PREVIEW_PROXY_SOCKET_DIR = "/run/vibe64/apps";
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

function proxyRequestHeaders(headers = {}, targetUrl, {
  previewAuth = null,
  proxyOrigin = "",
  targetHost = ""
} = {}) {
  const nextHeaders = { ...headers };
  delete nextHeaders["accept-encoding"];
  delete nextHeaders.connection;
  delete nextHeaders["content-length"];
  delete nextHeaders.host;
  delete nextHeaders.upgrade;
  nextHeaders.cookie = stripPreviewTokenCookie(nextHeaders.cookie, {
    proxyOrigin
  });
  nextHeaders.cookie = mergeCookieHeaders(
    nextHeaders.cookie,
    previewAuthCookieHeaderForRequest(previewAuth)
  );
  if (!nextHeaders.cookie) {
    delete nextHeaders.cookie;
  }
  nextHeaders["accept-encoding"] = "identity";
  nextHeaders.host = targetHost || targetUrl.host;
  return nextHeaders;
}

function proxyUpgradeHeaders(headers = {}, targetUrl, {
  previewAuth = null,
  proxyOrigin = "",
  targetHost = ""
} = {}) {
  const nextHeaders = { ...headers };
  nextHeaders.cookie = stripPreviewTokenCookie(nextHeaders.cookie, {
    proxyOrigin
  });
  nextHeaders.cookie = mergeCookieHeaders(
    nextHeaders.cookie,
    previewAuthCookieHeaderForRequest(previewAuth)
  );
  if (!nextHeaders.cookie) {
    delete nextHeaders.cookie;
  }
  nextHeaders.host = targetHost || targetUrl.host;
  return nextHeaders;
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

function previewTokenScopeMaterial({
  sessionId = "",
  targetHref = "",
  terminalSessionId = "",
  projectScope = ""
} = {}) {
  return JSON.stringify([
    String(projectScope || "").trim(),
    String(sessionId || "").trim(),
    String(terminalSessionId || "").trim(),
    String(targetHref || "").trim()
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

function previewRequestToken(request, requestUrl, {
  proxyOrigin = ""
} = {}) {
  const cookies = parseCookies(request.headers?.cookie || "");
  return requestUrl.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM) ||
    cookies[previewTokenCookieName(proxyOrigin)] ||
    "";
}

function previewRequestTokenDiagnostics(request, requestUrl, {
  proxyOrigin = ""
} = {}) {
  const cookieName = previewTokenCookieName(proxyOrigin);
  const cookies = parseCookies(request.headers?.cookie || "");
  return {
    cookieName,
    hasCookieToken: Boolean(cookies[cookieName]),
    hasQueryToken: requestUrl.searchParams.has(PREVIEW_PROXY_TOKEN_QUERY_PARAM)
  };
}

function previewProxyDebugEnabled(env = process.env) {
  return /^(1|true|yes|on)$/iu.test(String(env?.[PREVIEW_PROXY_DEBUG_ENV] || "").trim());
}

function previewProxyDebugLog(event = "", details = {}) {
  if (!previewProxyDebugEnabled()) {
    return null;
  }
  return vibe64SessionDebugLog(event, details);
}

function previewTokenCookieName(proxyOrigin = "") {
  try {
    const url = new URL(proxyOrigin);
    const suffix = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${PREVIEW_PROXY_TOKEN_COOKIE}_${suffix}`;
  } catch {
    return PREVIEW_PROXY_TOKEN_COOKIE;
  }
}

function previewTokenCookie(token = "", {
  proxyOrigin = ""
} = {}) {
  return `${previewTokenCookieName(proxyOrigin)}=${encodeURIComponent(String(token || ""))}; Path=/; SameSite=Lax; HttpOnly`;
}

function stripPreviewTokenCookie(header = "", {
  proxyOrigin = ""
} = {}) {
  const cookieName = previewTokenCookieName(proxyOrigin);
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) {
        return false;
      }
      const separatorIndex = part.indexOf("=");
      const name = separatorIndex < 0 ? part : part.slice(0, separatorIndex).trim();
      return name !== cookieName;
    })
    .join("; ");
}

function mergeCookieHeaders(header = "", injectedHeader = "") {
  const injectedNames = new Set(cookieNames(injectedHeader));
  const existing = String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) {
        return false;
      }
      const separatorIndex = part.indexOf("=");
      const name = separatorIndex < 0 ? part : part.slice(0, separatorIndex).trim();
      return !injectedNames.has(name);
    });
  const injected = String(injectedHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  return [...existing, ...injected].join("; ");
}

function cookieNames(header = "") {
  return String(header || "")
    .split(";")
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      return (separatorIndex < 0 ? part : part.slice(0, separatorIndex)).trim();
    })
    .filter(Boolean);
}

function previewAuthCookieHeaderForRequest(previewAuth = null) {
  return previewAuthCookieHeader(previewAuth || {});
}

function rejectPreviewRequest(response) {
  response.writeHead(403, {
    "Cache-Control": "no-store",
    "Connection": "close",
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end("Launch preview token is missing or invalid.");
}

function rejectPreviewUpgrade(socket, {
  message = "Launch preview token is missing or invalid.",
  statusCode = 403,
  statusMessage = "Forbidden"
} = {}) {
  socket.on("error", recordPreviewUpgradeSocketError("server.launchPreviewProxy.upgrade.rejectSocketError"));
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end([
    `HTTP/1.1 ${statusCode} ${statusMessage}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(message)}`,
    "",
    message
  ].join("\r\n"));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function responseHeaders(response, {
  injected = false,
  previewAuth = null,
  proxyOrigin = "",
  targetOrigin = ""
} = {}) {
  const headers = {};
  if (typeof response.headers?.forEach === "function") {
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
  } else {
    for (const [key, value] of Object.entries(response.headers || {})) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }
  }
  delete headers["content-length"];
  if (injected) {
    delete headers["content-encoding"];
  }
  if (headers.location && proxyOrigin && targetOrigin) {
    headers.location = proxiedLocation(headers.location, {
      proxyOrigin,
      targetOrigin
    });
  }
  filterPreviewAuthSetCookieHeaders(headers, previewAuth);
  headers.connection = "close";
  return headers;
}

function filterPreviewAuthSetCookieHeaders(headers = {}, previewAuth = null) {
  const ownedNames = new Set(previewAuthCookieNames(previewAuth || {}));
  if (ownedNames.size === 0) {
    return;
  }
  const headerKey = Object.hasOwn(headers, "set-cookie")
    ? "set-cookie"
    : Object.hasOwn(headers, "Set-Cookie")
      ? "Set-Cookie"
      : "";
  if (!headerKey) {
    return;
  }
  const current = headers[headerKey];
  const entries = (Array.isArray(current) ? current : [current])
    .filter((entry) => !ownedNames.has(setCookieName(entry)));
  if (entries.length === 0) {
    delete headers[headerKey];
    return;
  }
  headers[headerKey] = Array.isArray(current) ? entries : entries[0];
}

function setCookieName(header = "") {
  const firstPart = String(header || "").split(";")[0] || "";
  const separatorIndex = firstPart.indexOf("=");
  return (separatorIndex < 0 ? firstPart : firstPart.slice(0, separatorIndex)).trim();
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

function redirectPreviewTokenBootstrap(response, {
  location = "",
  proxyOrigin = "",
  token = ""
} = {}) {
  response.writeHead(302, {
    "Cache-Control": "no-store",
    "Connection": "close",
    "Location": location,
    "Set-Cookie": previewTokenCookie(token, { proxyOrigin })
  });
  response.end();
}

function previewStartingHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Starting preview</title>
  <style>
    html, body {
      height: 100%;
      margin: 0;
    }
    body {
      align-items: center;
      background: #f8fafc;
      color: #64748b;
      display: flex;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      justify-content: center;
    }
    .preview-starting {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .preview-starting__icon {
      animation: vibe64-preview-pulse 1.4s ease-in-out infinite;
      align-items: center;
      background: #e8f2ff;
      border: 1px solid #d6e8ff;
      border-radius: 999px;
      color: #5b9de8;
      display: flex;
      font-size: 2.4rem;
      height: 5rem;
      justify-content: center;
      width: 5rem;
    }
    .preview-starting__icon::before {
      border: 0.22rem solid currentColor;
      border-bottom-color: transparent;
      border-radius: 999px;
      content: "";
      display: block;
      height: 2.1rem;
      width: 2.1rem;
    }
    .preview-starting__text {
      font-size: 1rem;
      line-height: 1.4;
    }
    @keyframes vibe64-preview-pulse {
      0%,
      100% {
        opacity: 0.55;
        transform: scale(0.96);
      }
      50% {
        opacity: 1;
        transform: scale(1);
      }
    }
  </style>
</head>
<body>
  <div class="preview-starting">
    <div class="preview-starting__icon" aria-hidden="true"></div>
    <div class="preview-starting__text">Starting preview.</div>
  </div>
</body>
</html>`;
}

function proxiedLocation(location = "", {
  proxyOrigin = "",
  targetOrigin = ""
} = {}) {
  const text = String(location || "").trim();
  if (!text || !proxyOrigin || !targetOrigin) {
    return text;
  }
  try {
    const target = new URL(text, targetOrigin);
    if (target.origin !== targetOrigin) {
      return text;
    }
    const proxy = new URL(proxyOrigin);
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

async function proxyPreviewRequest(request, response, {
  connectOrigin = "",
  previewAuth = null,
  proxyOrigin = "",
  tokenScope = {},
  token = "",
  tokenHash = "",
  targetHost = "",
  targetOrigin = ""
} = {}) {
  const startedAtMs = Date.now();
  const requestUrl = new URL(String(request.url || "/"), proxyOrigin || targetOrigin);
  const tokenDiagnostics = previewRequestTokenDiagnostics(request, requestUrl, {
    proxyOrigin
  });
  const requestDetails = {
    ...tokenDiagnostics,
    method: String(request.method || "GET").toUpperCase(),
    pathname: requestUrl.pathname,
    proxyOrigin,
    search: requestUrl.search,
    sessionId: String(tokenScope.sessionId || ""),
    connectOrigin,
    targetOrigin,
    terminalSessionId: String(tokenScope.terminalSessionId || "")
  };
  if (!tokenMatches(previewRequestToken(request, requestUrl, { proxyOrigin }), tokenHash, tokenScope)) {
    previewProxyDebugLog("server.launchPreviewProxy.request.rejected", {
      ...requestDetails,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      reason: "preview_token_invalid"
    });
    rejectPreviewRequest(response);
    return;
  }
  if (requestShouldCleanPreviewToken(request, requestUrl)) {
    const location = cleanPreviewTokenRedirectLocation(requestUrl);
    redirectPreviewTokenBootstrap(response, {
      location,
      proxyOrigin,
      token
    });
    previewProxyDebugLog("server.launchPreviewProxy.request.bootstrapRedirect", {
      ...requestDetails,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      location
    });
    return;
  }
  try {
    const targetUrl = targetRequestUrl(request.url, connectOrigin || targetOrigin);
    const method = String(request.method || "GET").toUpperCase();
    const fetchOptions = {
      headers: proxyRequestHeaders(request.headers, targetUrl, {
        previewAuth,
        proxyOrigin,
        targetHost
      }),
      method,
      redirect: "manual"
    };
    if (REQUEST_BODY_METHODS.has(method)) {
      fetchOptions.body = await requestBody(request);
    }

    const targetResponse = await requestPreviewTarget(targetUrl, fetchOptions);
    const contentType = String(targetResponse.headers["content-type"] || "");
    if (HTML_CONTENT_TYPE_PATTERN.test(contentType)) {
      const html = await streamText(targetResponse);
      const body = injectLaunchPreviewBridge(html, {
        debug: previewProxyDebugEnabled(),
        targetOrigin
      });
      response.writeHead(targetResponse.statusCode || 200, previewResponseHeaders(targetResponse, {
        injected: true,
        previewAuth,
        proxyOrigin,
        targetOrigin,
        token
      }));
      response.end(body);
      previewProxyDebugLog("server.launchPreviewProxy.request.done", {
        ...requestDetails,
        contentType,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        injectedBridge: body !== html,
        responseStatus: targetResponse.statusCode || 200,
        targetHref: targetUrl.toString()
      });
      return;
    }

    response.writeHead(targetResponse.statusCode || 200, previewResponseHeaders(targetResponse, {
      previewAuth,
      proxyOrigin,
      targetOrigin,
      token
    }));
    previewProxyDebugLog("server.launchPreviewProxy.request.done", {
      ...requestDetails,
      contentType,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      injectedBridge: false,
      responseStatus: targetResponse.statusCode || 200,
      targetHref: targetUrl.toString()
    });
    pipePreviewResponseBody(targetResponse, response);
  } catch (error) {
    if (String(request.method || "GET").toUpperCase() === "GET" && requestAcceptsHtml(request)) {
      response.writeHead(503, {
        "Cache-Control": "no-store",
        "Connection": "close",
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": previewTokenCookie(token, { proxyOrigin })
      });
      response.end(previewStartingHtml());
      previewProxyDebugLog("server.launchPreviewProxy.request.startingHtml", {
        ...requestDetails,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error)
      });
      return;
    }
    response.writeHead(502, {
      "Connection": "close",
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(`Launch preview proxy failed: ${String(error?.message || error)}`);
    previewProxyDebugLog("server.launchPreviewProxy.request.error", {
      ...requestDetails,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error)
    });
  }
}

function requestPreviewTarget(targetUrl, {
  body = null,
  headers = {},
  method = "GET"
} = {}) {
  const requestFactory = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const upstreamRequest = requestFactory(targetUrl, {
      headers,
      method
    }, (upstreamResponse) => {
      resolve(upstreamResponse);
    });
    upstreamRequest.once("error", reject);
    if (body) {
      upstreamRequest.end(body);
      return;
    }
    upstreamRequest.end();
  });
}

async function streamText(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pipePreviewResponseBody(body, response) {
  const stream = typeof body?.getReader === "function" ? Readable.fromWeb(body) : body;
  stream.once("error", (error) => {
    if (!response.destroyed) {
      response.destroy(error);
    }
  });
  response.once("error", () => {
    stream.destroy();
  });
  response.once("close", () => {
    stream.destroy();
  });
  stream.pipe(response);
}

function proxyPreviewUpgrade(request, socket, head, {
  connectOrigin = "",
  previewAuth = null,
  proxyOrigin = "",
  tokenScope = {},
  tokenHash = "",
  targetHost = "",
  targetOrigin = ""
} = {}) {
  const requestUrl = new URL(String(request.url || "/"), proxyOrigin || targetOrigin);
  if (!tokenMatches(previewRequestToken(request, requestUrl, { proxyOrigin }), tokenHash, tokenScope)) {
    rejectPreviewUpgrade(socket);
    return;
  }

  let targetUrl;
  try {
    targetUrl = targetRequestUrl(request.url, connectOrigin || targetOrigin);
  } catch (error) {
    rejectPreviewUpgrade(socket, {
      message: String(error?.message || error),
      statusCode: 400,
      statusMessage: "Bad Request"
    });
    return;
  }

  let settled = false;
  const requestFactory = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;
  const upstreamRequest = requestFactory(targetUrl, {
    headers: proxyUpgradeHeaders(request.headers, targetUrl, {
      previewAuth,
      proxyOrigin,
      targetHost
    }),
    method: request.method || "GET"
  });
  socket.on("error", (error) => {
    recordPreviewUpgradeSocketError("server.launchPreviewProxy.upgrade.browserSocketError")(error);
    upstreamRequest.destroy();
  });
  socket.on("close", () => {
    upstreamRequest.destroy();
  });

  upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    settled = true;
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => socket.destroy());
    socket.on("close", () => upstreamSocket.destroy());
    safeSocketWrite(socket, upgradeResponseHead(upstreamResponse));
    if (upstreamHead?.length) {
      safeSocketWrite(socket, upstreamHead);
    }
    if (head?.length && !upstreamSocket.destroyed && upstreamSocket.writable) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });

  upstreamRequest.on("response", (upstreamResponse) => {
    settled = true;
    upstreamResponse.on("error", () => socket.destroy());
    socket.on("close", () => upstreamResponse.destroy());
    safeSocketWrite(socket, upgradeResponseHead(upstreamResponse));
    upstreamResponse.on("data", (chunk) => {
      safeSocketWrite(socket, chunk);
    });
    upstreamResponse.on("end", () => {
      if (!socket.destroyed && socket.writable) {
        socket.end();
      }
    });
  });

  upstreamRequest.on("error", (error) => {
    if (settled) {
      socket.destroy();
      return;
    }
    rejectPreviewUpgrade(socket, {
      message: `Launch preview WebSocket proxy failed: ${String(error?.message || error)}`,
      statusCode: 502,
      statusMessage: "Bad Gateway"
    });
  });

  upstreamRequest.end();
}

function safeSocketWrite(socket, chunk) {
  try {
    if (!socket.destroyed && socket.writable) {
      socket.write(chunk);
    }
  } catch (error) {
    recordPreviewUpgradeSocketError("server.launchPreviewProxy.upgrade.browserSocketWriteError")(error);
    socket.destroy();
  }
}

function recordPreviewUpgradeSocketError(event) {
  return (error) => {
    previewProxyDebugLog(event, {
      error: vibe64SessionDebugError(error)
    });
  };
}

function trackPreviewServerSockets(server) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });
  return sockets;
}

async function closePreviewServer({
  listen = {},
  server,
  sockets = new Set()
} = {}) {
  await new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    for (const socket of [...sockets]) {
      socket.destroy();
    }
  });
  if (listen.socketPath) {
    await unlinkIfExists(listen.socketPath);
  }
}

function upgradeResponseHead(response) {
  const headers = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage || ""}`];
  const rawHeaders = Array.isArray(response.rawHeaders) ? response.rawHeaders : [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
  }
  headers.push("", "");
  return headers.join("\r\n");
}

function createLaunchPreviewProxyRegistry({
  env = process.env
} = {}) {
  const proxies = new Map();

  async function ensure(input = {}, connectHref = "") {
    const publicOrigin = normalizePreviewPublicOrigin(input.previewPublicOrigin);
    const scope = previewProxyScope(input, {
      publicOrigin,
      targetHref: connectHref
    });
    const targetUrl = normalizePreviewTargetHref(scope.targetHref);
    const connectUrl = normalizePreviewTargetHref(connectHref || targetUrl.toString());
    const key = previewProxyKey(scope);
    const existing = proxies.get(key);
    const previewAuth = normalizePreviewAuth(input.previewAuth, {
      targetHref: targetUrl.toString()
    });
    previewProxyDebugLog("server.launchPreviewProxy.ensure", {
      existingProxy: Boolean(existing),
      existingConnectHref: String(existing?.connectHref || ""),
      existingTargetHref: String(existing?.targetHref || ""),
      connectHref: connectUrl.toString(),
      key,
      projectScope: String(scope.projectScope || ""),
      publicOrigin,
      sessionId: String(scope.sessionId || ""),
      targetHref: targetUrl.toString(),
      terminalSessionId: String(scope.terminalSessionId || "")
    });
    if (
      existing &&
      existing.connectHref === connectUrl.toString() &&
      existing.targetHref === targetUrl.toString() &&
      existing.publicOrigin === publicOrigin &&
      previewAuthFingerprint(existing.previewAuth) === previewAuthFingerprint(previewAuth)
    ) {
      previewProxyDebugLog("server.launchPreviewProxy.reuse", {
        key,
        projectScope: String(scope.projectScope || ""),
        proxyOrigin: String(existing.origin || ""),
        sessionId: String(scope.sessionId || ""),
        connectHref: connectUrl.toString(),
        targetHref: targetUrl.toString(),
        terminalSessionId: String(scope.terminalSessionId || "")
      });
      return proxyDescriptor(existing, targetUrl);
    }
    if (existing) {
      previewProxyDebugLog("server.launchPreviewProxy.replace", {
        key,
        projectScope: String(scope.projectScope || ""),
        proxyOrigin: String(existing.origin || ""),
        publicOrigin,
        reason: "proxy_identity_changed",
        sessionId: String(scope.sessionId || ""),
        terminalSessionId: String(scope.terminalSessionId || "")
      });
      proxies.delete(key);
      await existing.close();
    }

    const proxy = await startLaunchPreviewProxy({
      connectUrl,
      targetUrl
    }, {
      ...scope,
      targetHref: targetUrl.toString()
    }, {
      env,
      previewAuth,
      publicOrigin
    });
    proxies.set(key, proxy);
    previewProxyDebugLog("server.launchPreviewProxy.created", {
      key,
      projectScope: String(scope.projectScope || ""),
      proxyOrigin: String(proxy.origin || ""),
      publicOrigin,
      sessionId: String(scope.sessionId || ""),
      targetHref: targetUrl.toString(),
      terminalSessionId: String(scope.terminalSessionId || "")
    });
    return proxyDescriptor(proxy, targetUrl);
  }

  async function close(input = {}) {
    const scope = previewProxyScope(input);
    const closeEntries = [...proxies.entries()].filter(([, proxy]) => {
      return proxy.scope.projectScope === scope.projectScope &&
        proxy.scope.sessionId === scope.sessionId &&
        (!scope.terminalSessionId || proxy.scope.terminalSessionId === scope.terminalSessionId);
    });
    if (closeEntries.length > 0) {
      previewProxyDebugLog("server.launchPreviewProxy.close", {
        count: closeEntries.length,
        projectScope: String(scope.projectScope || ""),
        sessionId: String(scope.sessionId || ""),
        terminalSessionId: String(scope.terminalSessionId || ""),
        targets: closeEntries.map(([, proxy]) => ({
          connectHref: String(proxy.connectHref || ""),
          proxyOrigin: String(proxy.origin || ""),
          targetHref: String(proxy.targetHref || ""),
          terminalSessionId: String(proxy.scope?.terminalSessionId || "")
        }))
      });
    }
    await Promise.all(closeEntries.map(async ([key, proxy]) => {
      proxies.delete(key);
      await proxy.close();
    }));
  }

  async function closeAll() {
    const closeEntries = [...proxies.entries()];
    if (closeEntries.length > 0) {
      previewProxyDebugLog("server.launchPreviewProxy.closeAll", {
        count: closeEntries.length,
        targets: closeEntries.map(([, proxy]) => ({
          connectHref: String(proxy.connectHref || ""),
          projectScope: String(proxy.scope?.projectScope || ""),
          proxyOrigin: String(proxy.origin || ""),
          sessionId: String(proxy.scope?.sessionId || ""),
          targetHref: String(proxy.targetHref || ""),
          terminalSessionId: String(proxy.scope?.terminalSessionId || "")
        }))
      });
    }
    await Promise.all(closeEntries.map(async ([key, proxy]) => {
      proxies.delete(key);
      await proxy.close();
    }));
  }

  return Object.freeze({
    close,
    closeAll,
    ensure
  });
}

function previewProxyScope(input = {}, {
  publicOrigin = "",
  targetHref = ""
} = {}) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      publicOrigin: String(publicOrigin || input.previewPublicOrigin || "").trim(),
      sessionId: String(input.sessionId || "").trim(),
      targetHref: String(input.targetHref || targetHref || "").trim(),
      terminalSessionId: String(input.terminalSessionId || "").trim(),
      projectScope: String(input.projectScope || currentProjectScopeKey()).trim() || "global"
    };
  }
  return {
    publicOrigin: String(publicOrigin || "").trim(),
    sessionId: String(input || "").trim(),
    targetHref: String(targetHref || "").trim(),
    terminalSessionId: "",
    projectScope: currentProjectScopeKey()
  };
}

function previewProxyKey(scope = {}) {
  return [
    scope.projectScope,
    `session:${scope.sessionId}`,
    `terminal:${scope.terminalSessionId || "default"}`,
    `origin:${scope.publicOrigin || "local"}`
  ].join(":");
}

async function startLaunchPreviewProxy({
  connectUrl,
  targetUrl
} = {}, scope = {}, {
  env = process.env,
  previewAuth = null,
  publicOrigin = ""
} = {}) {
  const server = createServer();
  const sockets = trackPreviewServerSockets(server);
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenScope = {
    ...scope,
    targetHref: targetUrl.toString()
  };
  const connectOrigin = connectUrl.origin;
  const tokenHash = previewTokenHash(token, tokenScope);
  let proxyOrigin = "";
  server.on("request", (request, response) => {
    void proxyPreviewRequest(request, response, {
      connectOrigin,
      previewAuth,
      proxyOrigin,
      token,
      tokenScope,
      tokenHash,
      targetHost: targetUrl.host,
      targetOrigin: targetUrl.origin
    });
  });
  server.on("upgrade", (request, socket, head) => {
    proxyPreviewUpgrade(request, socket, head, {
      connectOrigin,
      previewAuth,
      proxyOrigin,
      tokenScope,
      tokenHash,
      targetHost: targetUrl.host,
      targetOrigin: targetUrl.origin
    });
  });

  const listen = publicOrigin
    ? await listenOnPreviewSocket(server, {
        env,
        publicOrigin
      })
    : await listenOnPreviewPort(server, {
        env
      });

  server.unref();
  proxyOrigin = listen.origin;
  previewProxyDebugLog("server.launchPreviewProxy.started", {
    connectHref: connectUrl.toString(),
    listenKind: listen.kind,
    port: listen.port,
    projectScope: String(scope.projectScope || ""),
    proxyOrigin,
    sessionId: String(scope.sessionId || ""),
    socketPath: listen.socketPath || "",
    targetHref: targetUrl.toString(),
    terminalSessionId: String(scope.terminalSessionId || "")
  });
  return {
    close: () => closePreviewServer({
      listen,
      server,
      sockets
    }),
    origin: proxyOrigin,
    connectHref: connectUrl.toString(),
    publicOrigin,
    previewAuth,
    scope: Object.freeze({
      sessionId: String(scope.sessionId || "").trim(),
      terminalSessionId: String(scope.terminalSessionId || "").trim(),
      projectScope: String(scope.projectScope || "").trim(),
      publicOrigin: String(scope.publicOrigin || "").trim()
    }),
    token,
    targetHref: targetUrl.toString()
  };
}

function normalizePreviewAuth(value = {}, {
  targetHref = ""
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const kind = normalizePreviewAuthKind(value.kind);
  if (!kind) {
    return null;
  }
  return {
    kind,
    profilePath: String(value.profilePath || ""),
    projectScope: String(value.projectScope || ""),
    sessionId: String(value.sessionId || ""),
    sessionRoot: String(value.sessionRoot || ""),
    targetHref: String(value.targetHref || targetHref || ""),
    targetRoot: String(value.targetRoot || ""),
    terminalSessionId: String(value.terminalSessionId || "")
  };
}

function previewAuthFingerprint(value = null) {
  if (!value) {
    return "";
  }
  return JSON.stringify([
    value.kind,
    value.profilePath,
    value.projectScope,
    value.sessionId,
    value.sessionRoot,
    value.targetHref,
    value.targetRoot,
    value.terminalSessionId
  ]);
}

async function listenOnPreviewPort(server, {
  env = process.env,
  host = previewProxyListenHost(env),
  portEnd = undefined,
  portStart = undefined
} = {}) {
  const configuredRange = previewProxyPortRange(env);
  const firstPort = portStart || configuredRange.start;
  const lastPort = portEnd || configuredRange.end;
  const publicHost = previewProxyPublicHost(host, env);
  for (let port = firstPort; port <= lastPort; port += 1) {
    const listened = await tryListen(server, port, host);
    if (listened) {
      return {
        host,
        kind: "port",
        origin: `http://${publicHost}:${port}`,
        port,
        publicHost
      };
    }
  }
  throw new Error(`No launch preview proxy port is available in ${firstPort}-${lastPort}.`);
}

async function listenOnPreviewSocket(server, {
  env = process.env,
  publicOrigin = ""
} = {}) {
  const socketPath = previewPublicSocketPath(publicOrigin, env);
  await mkdir(path.dirname(socketPath), {
    recursive: true
  });
  await unlinkIfExists(socketPath);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
  await chmod(socketPath, 0o660);
  return {
    kind: "socket",
    origin: publicOrigin,
    port: "",
    publicHost: new URL(publicOrigin).host,
    socketPath
  };
}

async function unlinkIfExists(targetPath = "") {
  if (!targetPath) {
    return;
  }
  try {
    await unlink(targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function normalizePreviewPublicOrigin(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const url = new URL(text);
  if (url.protocol !== "https:") {
    throw new Error("Launch preview public origin must use HTTPS.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function previewPublicSocketPath(publicOrigin = "", env = process.env) {
  const origin = normalizePreviewPublicOrigin(publicOrigin);
  const host = new URL(origin).hostname;
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)--([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.|$)/u.exec(host);
  if (!match) {
    throw new Error("Launch preview public origin must use the <preview>--<workspace> host format.");
  }
  const socketDir = String(env[PREVIEW_PROXY_SOCKET_DIR_ENV] || PREVIEW_PROXY_SOCKET_DIR).trim() || PREVIEW_PROXY_SOCKET_DIR;
  return path.join(socketDir, `${match[1]}--${match[2]}.sock`);
}

function tryListen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function previewProxyListenHost(env = process.env) {
  return String(env[PREVIEW_PROXY_HOST_ENV] || LOOPBACK_HOST).trim() || LOOPBACK_HOST;
}

function previewProxyPublicHost(listenHost = LOOPBACK_HOST, env = process.env) {
  const configured = String(env[PREVIEW_PROXY_PUBLIC_HOST_ENV] || "").trim();
  if (configured) {
    return configured;
  }
  return ["0.0.0.0", "::", "[::]"].includes(String(listenHost || ""))
    ? LOOPBACK_HOST
    : listenHost;
}

function previewResponseHeaders(response, options = {}) {
  const headers = responseHeaders(response, options);
  appendResponseHeader(headers, "set-cookie", previewTokenCookie(options.token, options));
  return headers;
}

function appendResponseHeader(headers, name, value) {
  const current = headers[name];
  if (!current) {
    headers[name] = value;
    return;
  }
  headers[name] = Array.isArray(current) ? [...current, value] : [current, value];
}

function proxyDescriptor(proxy, targetUrl) {
  const href = new URL(proxy.origin);
  href.pathname = targetUrl.pathname;
  href.search = appendPreviewTokenQueryParam(targetUrl.search, proxy.token);
  href.hash = targetUrl.hash;
  return {
    available: true,
    disabledReason: "",
    href: href.toString(),
    kind: "url",
    label: "Preview",
    targetHref: targetUrl.toString()
  };
}

export {
  PREVIEW_PROXY_PORT_END,
  PREVIEW_PROXY_PORT_START,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  appendPreviewTokenQueryParam,
  createLaunchPreviewProxyRegistry,
  injectLaunchPreviewBridge,
  listenOnPreviewPort,
  normalizePreviewTargetHref,
  previewPublicSocketPath,
  previewProxyListenHost,
  previewTokenCookieName,
  proxiedLocation,
  stripPreviewTokenQueryParam
};
