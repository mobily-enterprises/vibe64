import {
  createServer,
  request as httpRequest
} from "node:http";
import {
  request as httpsRequest
} from "node:https";
import crypto from "node:crypto";
import { Readable } from "node:stream";

import {
  isLoopbackAddress
} from "@local/vibe64-core/server/localStudioRequest";
import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
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
const PREVIEW_PROXY_PORT_START = 49100;
const PREVIEW_PROXY_PORT_END = 49999;
const PREVIEW_PROXY_TOKEN_QUERY_PARAM = "vibe64_preview_token";
const PREVIEW_PROXY_TOKEN_COOKIE = "vibe64_preview_token";
const PREVIEW_PROXY_HOST_ENV = "VIBE64_PREVIEW_PROXY_HOST";
const PREVIEW_PROXY_PUBLIC_HOST_ENV = "VIBE64_PREVIEW_PROXY_PUBLIC_HOST";
const PREVIEW_PROXY_DEBUG_ENV = "VIBE64_PREVIEW_DEBUG";

function normalizePreviewTargetHref(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error("Launch preview target URL is missing.");
  }
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Launch preview target URL must use HTTP.");
  }
  if (!isLoopbackAddress(url.hostname)) {
    throw new Error("Launch preview target URL must be loopback.");
  }
  return url;
}

function proxyRequestHeaders(headers = {}, targetUrl, {
  proxyOrigin = ""
} = {}) {
  const nextHeaders = { ...headers };
  delete nextHeaders.connection;
  delete nextHeaders["content-length"];
  delete nextHeaders.host;
  delete nextHeaders.upgrade;
  nextHeaders.cookie = stripPreviewTokenCookie(nextHeaders.cookie, {
    proxyOrigin
  });
  if (!nextHeaders.cookie) {
    delete nextHeaders.cookie;
  }
  nextHeaders.host = targetUrl.host;
  return nextHeaders;
}

function proxyUpgradeHeaders(headers = {}, targetUrl, {
  proxyOrigin = ""
} = {}) {
  const nextHeaders = { ...headers };
  nextHeaders.cookie = stripPreviewTokenCookie(nextHeaders.cookie, {
    proxyOrigin
  });
  if (!nextHeaders.cookie) {
    delete nextHeaders.cookie;
  }
  nextHeaders.host = targetUrl.host;
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
  proxyOrigin = "",
  targetOrigin = ""
} = {}) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
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
  headers.connection = "close";
  return headers;
}

function requestAcceptsHtml(request) {
  const accept = String(request?.headers?.accept || "");
  return !accept || HTML_CONTENT_TYPE_PATTERN.test(accept) || accept.includes("*/*");
}

function previewStartingHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="1">
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
    proxy.search = target.search;
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
  proxyOrigin = "",
  tokenScope = {},
  token = "",
  tokenHash = "",
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
  try {
    const targetUrl = targetRequestUrl(request.url, targetOrigin);
    const method = String(request.method || "GET").toUpperCase();
    const fetchOptions = {
      headers: proxyRequestHeaders(request.headers, targetUrl, {
        proxyOrigin
      }),
      method,
      redirect: "manual"
    };
    if (REQUEST_BODY_METHODS.has(method)) {
      fetchOptions.body = await requestBody(request);
    }

    const targetResponse = await fetch(targetUrl, fetchOptions);
    const contentType = String(targetResponse.headers.get("content-type") || "");
    if (HTML_CONTENT_TYPE_PATTERN.test(contentType)) {
      const html = await targetResponse.text();
      const body = injectLaunchPreviewBridge(html, {
        debug: previewProxyDebugEnabled(),
        targetOrigin
      });
      response.writeHead(targetResponse.status, previewResponseHeaders(targetResponse, {
        injected: true,
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
        responseStatus: targetResponse.status,
        targetHref: targetUrl.toString()
      });
      return;
    }

    response.writeHead(targetResponse.status, previewResponseHeaders(targetResponse, {
      proxyOrigin,
      targetOrigin,
      token
    }));
    previewProxyDebugLog("server.launchPreviewProxy.request.done", {
      ...requestDetails,
      contentType,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      injectedBridge: false,
      responseStatus: targetResponse.status,
      targetHref: targetUrl.toString()
    });
    if (targetResponse.body) {
      Readable.fromWeb(targetResponse.body).pipe(response);
    } else {
      response.end();
    }
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

function proxyPreviewUpgrade(request, socket, head, {
  proxyOrigin = "",
  tokenScope = {},
  tokenHash = "",
  targetOrigin = ""
} = {}) {
  const requestUrl = new URL(String(request.url || "/"), proxyOrigin || targetOrigin);
  if (!tokenMatches(previewRequestToken(request, requestUrl, { proxyOrigin }), tokenHash, tokenScope)) {
    rejectPreviewUpgrade(socket);
    return;
  }

  let targetUrl;
  try {
    targetUrl = targetRequestUrl(request.url, targetOrigin);
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
      proxyOrigin
    }),
    method: request.method || "GET"
  });

  upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    settled = true;
    socket.write(upgradeResponseHead(upstreamResponse));
    if (upstreamHead?.length) {
      socket.write(upstreamHead);
    }
    if (head?.length) {
      upstreamSocket.write(head);
    }
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });

  upstreamRequest.on("response", (upstreamResponse) => {
    settled = true;
    socket.write(upgradeResponseHead(upstreamResponse));
    upstreamResponse.on("data", (chunk) => socket.write(chunk));
    upstreamResponse.on("end", () => socket.end());
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

function upgradeResponseHead(response) {
  const headers = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage || ""}`];
  const rawHeaders = Array.isArray(response.rawHeaders) ? response.rawHeaders : [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
  }
  headers.push("", "");
  return headers.join("\r\n");
}

function createLaunchPreviewProxyRegistry() {
  const proxies = new Map();

  async function ensure(input = {}, targetHref = "") {
    const scope = previewProxyScope(input, {
      targetHref
    });
    const targetUrl = normalizePreviewTargetHref(scope.targetHref);
    const key = previewProxyKey(scope);
    const existing = proxies.get(key);
    previewProxyDebugLog("server.launchPreviewProxy.ensure", {
      existingProxy: Boolean(existing),
      existingTargetHref: String(existing?.targetHref || ""),
      key,
      projectScope: String(scope.projectScope || ""),
      sessionId: String(scope.sessionId || ""),
      targetHref: targetUrl.toString(),
      terminalSessionId: String(scope.terminalSessionId || "")
    });
    if (existing && existing.targetHref === targetUrl.toString()) {
      previewProxyDebugLog("server.launchPreviewProxy.reuse", {
        key,
        projectScope: String(scope.projectScope || ""),
        proxyOrigin: String(existing.origin || ""),
        sessionId: String(scope.sessionId || ""),
        targetHref: targetUrl.toString(),
        terminalSessionId: String(scope.terminalSessionId || "")
      });
      return proxyDescriptor(existing, targetUrl);
    }
    await close(scope);

    const proxy = await startLaunchPreviewProxy(targetUrl, {
      ...scope,
      targetHref: targetUrl.toString()
    });
    proxies.set(key, proxy);
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
  targetHref = ""
} = {}) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      sessionId: String(input.sessionId || "").trim(),
      targetHref: String(input.targetHref || targetHref || "").trim(),
      terminalSessionId: String(input.terminalSessionId || "").trim(),
      projectScope: String(input.projectScope || currentProjectScopeKey()).trim() || "global"
    };
  }
  return {
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
    `terminal:${scope.terminalSessionId || "default"}`
  ].join(":");
}

async function startLaunchPreviewProxy(targetUrl, scope = {}) {
  const server = createServer();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenScope = {
    ...scope,
    targetHref: targetUrl.toString()
  };
  const tokenHash = previewTokenHash(token, tokenScope);
  let proxyOrigin = "";
  server.on("request", (request, response) => {
    void proxyPreviewRequest(request, response, {
      proxyOrigin,
      token,
      tokenScope,
      tokenHash,
      targetOrigin: targetUrl.origin
    });
  });
  server.on("upgrade", (request, socket, head) => {
    proxyPreviewUpgrade(request, socket, head, {
      proxyOrigin,
      tokenScope,
      tokenHash,
      targetOrigin: targetUrl.origin
    });
  });

  const listen = await listenOnPreviewPort(server);

  server.unref();
  proxyOrigin = `http://${listen.publicHost}:${listen.port}`;
  previewProxyDebugLog("server.launchPreviewProxy.started", {
    port: listen.port,
    projectScope: String(scope.projectScope || ""),
    proxyOrigin,
    sessionId: String(scope.sessionId || ""),
    targetHref: targetUrl.toString(),
    terminalSessionId: String(scope.terminalSessionId || "")
  });
  return {
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
    }),
    origin: proxyOrigin,
    scope: Object.freeze({
      sessionId: String(scope.sessionId || "").trim(),
      terminalSessionId: String(scope.terminalSessionId || "").trim(),
      projectScope: String(scope.projectScope || "").trim()
    }),
    token,
    targetHref: targetUrl.toString()
  };
}

async function listenOnPreviewPort(server, {
  env = process.env,
  host = previewProxyListenHost(env),
  portEnd = PREVIEW_PROXY_PORT_END,
  portStart = PREVIEW_PROXY_PORT_START
} = {}) {
  const publicHost = previewProxyPublicHost(host, env);
  for (let port = portStart; port <= portEnd; port += 1) {
    const listened = await tryListen(server, port, host);
    if (listened) {
      return {
        host,
        port,
        publicHost
      };
    }
  }
  throw new Error(`No launch preview proxy port is available in ${portStart}-${portEnd}.`);
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
  previewProxyListenHost,
  previewTokenCookieName,
  proxiedLocation,
  stripPreviewTokenQueryParam
};
