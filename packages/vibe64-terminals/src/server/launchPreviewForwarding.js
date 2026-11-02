// Forwards a Preview request or WebSocket upgrade to the app, injecting the Preview bridge into its pages,
// and answers for the app while it starts.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { PREVIEW_IDENTITY_CONTROL_PATH } from "@local/vibe64-core/server/previewAuth";
import { vibe64SessionDebugDurationMs, vibe64SessionDebugError } from "@local/vibe64-runtime/server/sessionDebugLog";
import { activeUsageRecording } from "@local/vibe64-usage-recording/server/activeRecordings";
import { USAGE_RECORDING_INTERACTION_HEADER } from "@local/vibe64-usage-recording/shared/contract";
import { injectLaunchPreviewBridge } from "./launchPreviewBridge.js";
import { previewProxyDebugEnabled, previewProxyDebugLog } from "./launchPreviewDebugLog.js";
import {
  cleanPreviewTokenRedirectLocation,
  HTML_CONTENT_TYPE_PATTERN,
  presentsOnLoopbackOrigin,
  previewRequestToken,
  previewRequestTokenDiagnostics,
  previewResponseHeaders,
  previewTokenCookie,
  proxyRequestHeaders,
  proxyUpgradeHeaders,
  requestAcceptsHtml,
  requestHeader,
  requestIsBrowserDocumentNavigation,
  requestShouldCleanPreviewToken,
  stripPreviewTokenQueryParam,
  targetRequestUrl,
  tokenMatches
} from "./launchPreviewHeaders.js";
import { bindPreviewProxySocketPair, recordPreviewUpgradeSocketError, safeSocketWrite } from "./launchPreviewConnections.js";
import {
  previewIdentityProxyError,
  proxyPreviewIdentityExchange,
  readStreamBuffer,
  writePreviewIdentityJson
} from "./launchPreviewIdentity.js";

// An HTML page is buffered to inject the bridge; anything larger is refused
// rather than held in the daemon's memory.
const PREVIEW_HTML_INJECTION_LIMIT_BYTES = 16 * 1024 * 1024;

function rejectPreviewRequest(response) {
  response.writeHead(403, {
    "Cache-Control": "no-store",
    "Connection": "close",
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end("Launch preview token is missing or invalid.");
}

function rejectPreviewUpgrade(socket, options = {}) {
  const {
    message = "Launch preview token is missing or invalid.",
    statusCode = 403,
    statusMessage = "Forbidden"
  } = options;
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

function redirectPreviewTokenBootstrap(response, options = {}) {
  const {
    location = "",
    proxyOrigin = "",
    token = ""
  } = options;
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

function proxiedLoopbackHtml(html = "", options = {}) {
  const {
    proxyOrigin = "",
    targetOrigin = ""
  } = options;
  // A write presented on the loopback origin carries no forwarded host, so a
  // proxy-aware app names the loopback target in the page it returns. Translate
  // those absolute URLs back exactly like redirect Locations.
  const proxy = new URL(proxyOrigin);
  const forwardedTarget = new URL(targetOrigin);
  forwardedTarget.protocol = proxy.protocol;
  let text = html;
  for (const origin of new Set([targetOrigin, forwardedTarget.origin])) {
    for (const [from, to] of [[origin, proxy.origin], [origin.replaceAll("/", "\\/"), proxy.origin.replaceAll("/", "\\/")]]) {
      text = text.replace(new RegExp(`${from.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")}(?![0-9])`, "gu"), () => to);
    }
  }
  return text;
}

async function proxyPreviewRequest(request, response, {
  connectOrigin = "",
  consumeIdentityGrant = null,
  editorOrigins = [],
  executePreviewIdentityCommand = null,
  locatorSource = "",
  previewAuth = null,
  proxyOrigin = "",
  tracker,
  tokenScope = {},
  token = "",
  tokenHash = "",
  targetHost = "",
  targetOrigin = ""
}) {
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
    search: stripPreviewTokenQueryParam(requestUrl.search),
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
  if (requestUrl.pathname === PREVIEW_IDENTITY_CONTROL_PATH) {
    if (String(request.method || "GET").toUpperCase() !== "POST") {
      writePreviewIdentityJson(response, 405, {
        code: "vibe64_preview_identity_method_not_allowed",
        error: "Preview identity exchange requires POST.",
        ok: false
      });
      return;
    }
    await proxyPreviewIdentityExchange(request, response, {
      consumeIdentityGrant,
      executePreviewIdentityCommand,
      previewAuth,
      proxyOrigin,
      token
    });
    return;
  }
  try {
    const targetUrl = targetRequestUrl(request.url, connectOrigin || targetOrigin);
    const method = String(request.method || "GET").toUpperCase();
    // While the session's Preview is recorded, each request gets the id its
    // functions are counted under, and its method, path and status are logged.
    // Module and asset loads are only counted.
    const recording = activeUsageRecording(tokenScope.projectScope, tokenScope.sessionId);
    const recordedRequest = recording?.proxyRequest({
      fetchDest: requestHeader(request, "sec-fetch-dest"),
      interaction: requestHeader(request, USAGE_RECORDING_INTERACTION_HEADER),
      method,
      path: requestUrl.pathname
    }) || null;
    if (recordedRequest) {
      response.once("close", () => recordedRequest.finish({ status: response.statusCode }));
    }
    const targetResponse = await requestPreviewTarget(targetUrl, {
      body: request,
      headers: proxyRequestHeaders(request.headers, targetUrl, {
        clientAddress: request.socket?.remoteAddress || "",
        freshDocument: requestIsBrowserDocumentNavigation(request),
        proxyOrigin,
        targetHost,
        usageRequestId: recordedRequest?.requestId || ""
      }),
      method,
      tracker
    });
    const contentType = String(targetResponse.headers["content-type"] || "");
    if (HTML_CONTENT_TYPE_PATTERN.test(contentType)) {
      const html = await streamText(targetResponse, {
        maxBytes: PREVIEW_HTML_INJECTION_LIMIT_BYTES
      });
      const page = presentsOnLoopbackOrigin(request.headers, proxyOrigin)
        ? proxiedLoopbackHtml(html, { proxyOrigin, targetOrigin })
        : html;
      const body = injectLaunchPreviewBridge(page, {
        debug: previewProxyDebugEnabled(),
        locatorSource,
        parentOrigins: editorOrigins,
        recording: {
          active: recording?.web === true,
          recordingId: recording?.web === true ? recording.recordingId : null
        },
        targetOrigin
      });
      response.writeHead(targetResponse.statusCode || 200, previewResponseHeaders(targetResponse, {
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
        responseStatus: targetResponse.statusCode || 200,
        targetHref: targetUrl.toString()
      });
      return;
    }

    response.writeHead(targetResponse.statusCode || 200, previewResponseHeaders(targetResponse, {
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
    if (error?.code === "vibe64_preview_html_too_large") {
      response.writeHead(error.statusCode, {
        "Cache-Control": "no-store",
        "Connection": "close",
        "Content-Type": "text/plain; charset=utf-8",
        "Set-Cookie": previewTokenCookie(token, { proxyOrigin })
      });
      response.end(error.message);
      previewProxyDebugLog("server.launchPreviewProxy.request.htmlTooLarge", {
        ...requestDetails,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs)
      });
      return;
    }
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

/**
 * @param {URL} targetUrl
 * @param {object} options
 * @param {import("node:http").IncomingMessage} options.body the browser's request, streamed upstream
 */
function requestPreviewTarget(targetUrl, {
  body,
  headers = {},
  method = "GET",
  tracker
}) {
  const requestFactory = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const upstreamRequest = requestFactory(targetUrl, {
      headers,
      method
    }, (upstreamResponse) => {
      resolve(upstreamResponse);
    });
    tracker.trackRequest(upstreamRequest, "upstream-http-request");
    upstreamRequest.once("error", reject);
    // The browser's body streams through for every method, keeping its own
    // content-length or chunked framing; an aborted upload aborts upstream.
    body.once("close", () => {
      if (!body.readableEnded) {
        upstreamRequest.destroy();
      }
    });
    body.once("error", (error) => upstreamRequest.destroy(error));
    body.pipe(upstreamRequest);
  });
}

async function streamText(stream, {
  maxBytes
}) {
  return (await readStreamBuffer(stream, {
    maxBytes,
    tooLargeError: () => previewIdentityProxyError(
      "Preview page is too large to inject the bridge.",
      "vibe64_preview_html_too_large",
      502
    )
  })).toString("utf8");
}

function pipePreviewResponseBody(stream, response) {
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
  proxyOrigin = "",
  tracker,
  tokenScope = {},
  tokenHash = "",
  targetHost = "",
  targetOrigin = ""
}) {
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
      clientAddress: request.socket?.remoteAddress || "",
      proxyOrigin,
      targetHost
    }),
    method: request.method || "GET"
  });
  tracker.trackSocket(socket, "browser-upgrade");
  tracker.trackRequest(upstreamRequest, "upstream-upgrade-request");
  socket.on("error", (error) => {
    recordPreviewUpgradeSocketError("server.launchPreviewProxy.upgrade.browserSocketError")(error);
    upstreamRequest.destroy();
  });
  socket.on("close", () => {
    upstreamRequest.destroy();
  });

  upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    settled = true;
    bindPreviewProxySocketPair(socket, upstreamSocket, {
      tracker
    });
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
    upstreamResponse.on("aborted", () => socket.destroy());
    socket.on("close", () => upstreamResponse.destroy());
    socket.on("end", () => upstreamResponse.destroy());
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

function upgradeResponseHead(response) {
  const headers = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage || ""}`];
  const rawHeaders = Array.isArray(response.rawHeaders) ? response.rawHeaders : [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
  }
  headers.push("", "");
  return headers.join("\r\n");
}

export {
  proxyPreviewRequest,
  proxyPreviewUpgrade
};
