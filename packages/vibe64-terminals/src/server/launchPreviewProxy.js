import { createServer } from "node:http";
import { Readable } from "node:stream";

import {
  isLoopbackAddress
} from "@local/vibe64-core/server/localStudioRequest";

import {
  injectLaunchPreviewBridge
} from "./launchPreviewBridge.js";

const LOOPBACK_HOST = "127.0.0.1";
const HTML_CONTENT_TYPE_PATTERN = /\btext\/html\b/iu;
const REQUEST_BODY_METHODS = new Set(["PATCH", "POST", "PUT"]);

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

function proxyRequestHeaders(headers = {}, targetUrl) {
  const nextHeaders = { ...headers };
  delete nextHeaders.connection;
  delete nextHeaders["content-length"];
  delete nextHeaders.host;
  delete nextHeaders.upgrade;
  nextHeaders.host = targetUrl.host;
  return nextHeaders;
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
  return url;
}

async function proxyPreviewRequest(request, response, {
  proxyOrigin = "",
  targetOrigin = ""
} = {}) {
  try {
    const targetUrl = targetRequestUrl(request.url, targetOrigin);
    const method = String(request.method || "GET").toUpperCase();
    const fetchOptions = {
      headers: proxyRequestHeaders(request.headers, targetUrl),
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
        targetOrigin
      });
      response.writeHead(targetResponse.status, responseHeaders(targetResponse, {
        injected: true,
        proxyOrigin,
        targetOrigin
      }));
      response.end(body);
      return;
    }

    response.writeHead(targetResponse.status, responseHeaders(targetResponse, {
      proxyOrigin,
      targetOrigin
    }));
    if (targetResponse.body) {
      Readable.fromWeb(targetResponse.body).pipe(response);
    } else {
      response.end();
    }
  } catch (error) {
    if (String(request.method || "GET").toUpperCase() === "GET" && requestAcceptsHtml(request)) {
      response.writeHead(503, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(previewStartingHtml());
      return;
    }
    response.writeHead(502, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(`Launch preview proxy failed: ${String(error?.message || error)}`);
  }
}

function createLaunchPreviewProxyRegistry() {
  const proxies = new Map();

  async function ensure(sessionId = "", targetHref = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    const targetUrl = normalizePreviewTargetHref(targetHref);
    const existing = proxies.get(normalizedSessionId);
    if (existing && existing.targetHref === targetUrl.toString()) {
      return proxyDescriptor(existing, targetUrl);
    }
    await close(normalizedSessionId);

    const proxy = await startLaunchPreviewProxy(targetUrl);
    proxies.set(normalizedSessionId, proxy);
    return proxyDescriptor(proxy, targetUrl);
  }

  async function close(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    const existing = proxies.get(normalizedSessionId);
    if (!existing) {
      return;
    }
    proxies.delete(normalizedSessionId);
    await existing.close();
  }

  async function closeAll() {
    await Promise.all([...proxies.keys()].map((sessionId) => close(sessionId)));
  }

  return Object.freeze({
    close,
    closeAll,
    ensure
  });
}

async function startLaunchPreviewProxy(targetUrl) {
  const server = createServer();
  let proxyOrigin = "";
  server.on("request", (request, response) => {
    void proxyPreviewRequest(request, response, {
      proxyOrigin,
      targetOrigin: targetUrl.origin
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  server.unref();
  proxyOrigin = `http://${LOOPBACK_HOST}:${address.port}`;
  return {
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
    }),
    origin: proxyOrigin,
    targetHref: targetUrl.toString()
  };
}

function proxyDescriptor(proxy, targetUrl) {
  const href = new URL(proxy.origin);
  href.pathname = targetUrl.pathname;
  href.search = targetUrl.search;
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
  createLaunchPreviewProxyRegistry,
  injectLaunchPreviewBridge,
  normalizePreviewTargetHref,
  proxiedLocation
};
