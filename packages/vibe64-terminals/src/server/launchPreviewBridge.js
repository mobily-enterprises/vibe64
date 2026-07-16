import {
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_QUERY_MESSAGE_TYPE
} from "../shared/launchPreviewProtocol.js";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "@local/vibe64-core/server/previewAuth";

function launchPreviewBridgeScript({
  debug = false,
  targetOrigin = ""
} = {}) {
  const config = JSON.stringify({
    debug: debug === true,
    diagnosticsRequestMessageType: PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
    diagnosticsResponseMessageType: PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
    identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
    identityRequestMessageType: PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
    identityResponseMessageType: PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
    locationMessageType: PREVIEW_LOCATION_MESSAGE_TYPE,
    queryMessageType: PREVIEW_QUERY_MESSAGE_TYPE,
    targetOrigin: String(targetOrigin || ""),
    version: PREVIEW_BRIDGE_VERSION
  });

  return `<script data-vibe64-preview-bridge="1">(() => {
  const config = ${config};
  if (window.__vibe64PreviewBridge && window.__vibe64PreviewBridge.version >= config.version) {
    return;
  }
  let lastHref = "";
  let consoleCharacterCount = 0;
  let consoleDroppedEntryCount = 0;
  let consoleSequence = 0;
  let networkDroppedEntryCount = 0;
  let networkSequence = 0;
  let networkSuppressedResourceCount = 0;
  const consoleEntries = [];
  const networkEntries = [];
  const maxConsoleCharacters = 200000;
  const maxConsoleEntries = 500;
  const maxConsoleEntryCharacters = 12000;
  const maxNetworkCharacters = 350000;
  const maxNetworkEntries = 250;
  const maxNetworkValueCharacters = 24000;
  function clippedConsoleText(value, limit = maxConsoleEntryCharacters) {
    const text = String(value ?? "");
    return text.length > limit
      ? text.slice(0, Math.max(0, limit - 18)) + "… [truncated]"
      : text;
  }
  function consoleErrorValue(value) {
    return {
      message: String(value?.message || ""),
      name: String(value?.name || "Error"),
      stack: String(value?.stack || "")
    };
  }
  function consoleJsonValue(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, candidate) => {
      if (typeof candidate === "bigint") {
        return String(candidate) + "n";
      }
      if (typeof candidate === "function") {
        return "[Function " + String(candidate.name || "anonymous") + "]";
      }
      if (typeof candidate === "symbol") {
        return String(candidate);
      }
      if (candidate instanceof Error) {
        return consoleErrorValue(candidate);
      }
      if (candidate && typeof candidate === "object") {
        if (seen.has(candidate)) {
          return "[Circular]";
        }
        seen.add(candidate);
        if (typeof Element === "function" && candidate instanceof Element) {
          return "<" + String(candidate.tagName || "element").toLowerCase() + ">";
        }
      }
      return candidate;
    });
  }
  function formatConsoleValue(value) {
    if (typeof value === "string") {
      return clippedConsoleText(value);
    }
    if (value instanceof Error) {
      return clippedConsoleText(value.stack || (value.name + ": " + value.message));
    }
    if (value === undefined) {
      return "undefined";
    }
    if (value === null) {
      return "null";
    }
    try {
      const json = consoleJsonValue(value);
      if (json !== undefined) {
        return clippedConsoleText(json);
      }
    } catch {
      // Fall through to the value's string representation.
    }
    try {
      return clippedConsoleText(String(value));
    } catch {
      return "[Unserializable value]";
    }
  }
  function appendConsoleEntry(level, values = [], source = "console") {
    const args = Array.from(values || []).slice(0, 20);
    const extraCount = Math.max(0, Number(values?.length || 0) - args.length);
    const text = clippedConsoleText([
      ...args.map(formatConsoleValue),
      ...(extraCount > 0 ? ["… " + extraCount + " more values"] : [])
    ].join(" "));
    const entry = {
      level: String(level || "log"),
      sequence: ++consoleSequence,
      source: String(source || "console"),
      text,
      timestamp: new Date().toISOString()
    };
    consoleEntries.push(entry);
    consoleCharacterCount += text.length;
    while (
      consoleEntries.length > maxConsoleEntries ||
      consoleCharacterCount > maxConsoleCharacters
    ) {
      const removed = consoleEntries.shift();
      consoleCharacterCount = Math.max(0, consoleCharacterCount - String(removed?.text || "").length);
      consoleDroppedEntryCount += 1;
    }
  }
  function networkEntryCharacters(entry) {
    try {
      return JSON.stringify(entry).length;
    } catch {
      return maxNetworkValueCharacters;
    }
  }
  function pruneNetworkEntries() {
    let characters = networkEntries.reduce((total, entry) => total + networkEntryCharacters(entry), 0);
    while (networkEntries.length > maxNetworkEntries || characters > maxNetworkCharacters) {
      const removed = networkEntries.shift();
      characters = Math.max(0, characters - networkEntryCharacters(removed));
      networkDroppedEntryCount += 1;
    }
  }
  function appendNetworkEntry(values = {}) {
    const entry = {
      durationMs: 0,
      error: "",
      phase: String(values.phase || "complete"),
      requestBody: "",
      requestHeaders: {},
      responseBody: "",
      responseHeaders: {},
      sequence: ++networkSequence,
      status: 0,
      statusText: "",
      timestamp: new Date().toISOString(),
      ...values,
      kind: String(values.kind || "resource"),
      method: String(values.method || "GET").toUpperCase(),
      url: targetResourceHref(values.url || window.location.href)
    };
    networkEntries.push(entry);
    pruneNetworkEntries();
    return entry;
  }
  function updateNetworkEntry(entry, values = {}) {
    if (!entry || !networkEntries.includes(entry)) {
      return;
    }
    Object.assign(entry, values);
    pruneNetworkEntries();
  }
  function networkHeaders(value) {
    const result = {};
    try {
      const headers = new Headers(value || {});
      let count = 0;
      for (const [name, headerValue] of headers.entries()) {
        if (count >= 100) {
          result["…"] = "additional headers omitted";
          break;
        }
        result[String(name)] = clippedConsoleText(headerValue, 4000);
        count += 1;
      }
    } catch {
      return {};
    }
    return result;
  }
  function networkBodyValue(value) {
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string") {
      return clippedConsoleText(value, maxNetworkValueCharacters);
    }
    if (typeof URLSearchParams === "function" && value instanceof URLSearchParams) {
      return clippedConsoleText(value.toString(), maxNetworkValueCharacters);
    }
    if (typeof FormData === "function" && value instanceof FormData) {
      const fields = [];
      for (const [name, fieldValue] of value.entries()) {
        const text = typeof fieldValue === "string"
          ? fieldValue
          : "[File " + String(fieldValue?.name || "unnamed") + ", " + Number(fieldValue?.size || 0) + " bytes]";
        fields.push(String(name) + "=" + text);
      }
      return clippedConsoleText(fields.join("&"), maxNetworkValueCharacters);
    }
    if (typeof Blob === "function" && value instanceof Blob) {
      return "[Blob " + String(value.type || "application/octet-stream") + ", " + value.size + " bytes]";
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return "[Binary data, " + Number(value.byteLength || 0) + " bytes]";
    }
    return clippedConsoleText(formatConsoleValue(value), maxNetworkValueCharacters);
  }
  function responseBodyIsText(response) {
    const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
    return !contentType || /(?:json|text|xml|javascript|x-www-form-urlencoded)/u.test(contentType);
  }
  async function streamedTextPreview(body) {
    const reader = body?.getReader?.();
    if (!reader || typeof TextDecoder !== "function") {
      return null;
    }
    const decoder = new TextDecoder();
    let byteCount = 0;
    let text = "";
    let truncated = false;
    try {
      while (byteCount < maxNetworkValueCharacters) {
        const chunk = await reader.read();
        if (chunk.done) {
          text += decoder.decode();
          return clippedConsoleText(text, maxNetworkValueCharacters);
        }
        const value = chunk.value instanceof Uint8Array ? chunk.value : new Uint8Array(chunk.value || []);
        const remaining = maxNetworkValueCharacters - byteCount;
        const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        byteCount += accepted.byteLength;
        text += decoder.decode(accepted, { stream: true });
        if (accepted.byteLength < value.byteLength) {
          truncated = true;
          break;
        }
      }
      truncated = true;
    } finally {
      if (truncated) {
        await reader.cancel?.().catch?.(() => null);
      }
    }
    return clippedConsoleText(text + "… [truncated]", maxNetworkValueCharacters);
  }
  async function responseBodyPreview(response) {
    if (!responseBodyIsText(response)) {
      const contentType = String(response?.headers?.get?.("content-type") || "binary response");
      const length = String(response?.headers?.get?.("content-length") || "unknown size");
      return "[" + contentType + ", " + length + "]";
    }
    try {
      const streamed = await streamedTextPreview(response.body);
      return streamed === null
        ? clippedConsoleText(await response.text(), maxNetworkValueCharacters)
        : streamed;
    } catch (error) {
      return "[Response body unavailable: " + formatConsoleValue(error) + "]";
    }
  }
  async function requestBodyPreview(input, init = {}) {
    if (init?.body !== undefined && init.body !== null) {
      return networkBodyValue(init.body);
    }
    if (typeof Request === "function" && input instanceof Request && !input.bodyUsed) {
      try {
        const clone = input.clone();
        const streamed = await streamedTextPreview(clone.body);
        return streamed === null
          ? clippedConsoleText(await clone.text(), maxNetworkValueCharacters)
          : streamed;
      } catch {
        return "[Request body unavailable]";
      }
    }
    return "";
  }
  function elapsedMilliseconds(startedAt) {
    return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
  }
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function vibe64PreviewFetch(input, init = {}) {
      const startedAt = performance.now();
      const entry = appendNetworkEntry({
        kind: "fetch",
        method: String(init?.method || input?.method || "GET"),
        phase: "pending",
        requestHeaders: networkHeaders(init?.headers || input?.headers),
        url: String(input?.url || input || "")
      });
      void requestBodyPreview(input, init).then((requestBody) => {
        updateNetworkEntry(entry, { requestBody });
      });
      try {
        const response = await originalFetch.apply(this, arguments);
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          phase: "complete",
          responseHeaders: networkHeaders(response.headers),
          status: Number(response.status || 0),
          statusText: String(response.statusText || ""),
          url: targetResourceHref(response.url || entry.url)
        });
        void responseBodyPreview(response.clone()).then((responseBody) => {
          updateNetworkEntry(entry, { responseBody });
        });
        return response;
      } catch (error) {
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          error: formatConsoleValue(error),
          phase: "failed"
        });
        throw error;
      }
    };
  }
  const xhrMetadata = new WeakMap();
  const xhrPrototype = window.XMLHttpRequest?.prototype;
  const originalXhrOpen = xhrPrototype?.open;
  const originalXhrSend = xhrPrototype?.send;
  const originalXhrSetRequestHeader = xhrPrototype?.setRequestHeader;
  if (typeof originalXhrOpen === "function" && typeof originalXhrSend === "function") {
    xhrPrototype.open = function vibe64PreviewXhrOpen(method, url, ...args) {
      xhrMetadata.set(this, {
        headers: {},
        method: String(method || "GET"),
        url: String(url || "")
      });
      return originalXhrOpen.call(this, method, url, ...args);
    };
    if (typeof originalXhrSetRequestHeader === "function") {
      xhrPrototype.setRequestHeader = function vibe64PreviewXhrSetRequestHeader(name, value) {
        const metadata = xhrMetadata.get(this);
        if (metadata) {
          metadata.headers[String(name)] = String(value);
        }
        return originalXhrSetRequestHeader.call(this, name, value);
      };
    }
    xhrPrototype.send = function vibe64PreviewXhrSend(body) {
      const metadata = xhrMetadata.get(this) || { headers: {}, method: "GET", url: "" };
      const startedAt = performance.now();
      const entry = appendNetworkEntry({
        kind: "xhr",
        method: metadata.method,
        phase: "pending",
        requestBody: networkBodyValue(body),
        requestHeaders: networkHeaders(metadata.headers),
        url: metadata.url
      });
      this.addEventListener("loadend", () => {
        let responseBody = "";
        try {
          if (!this.responseType || this.responseType === "text") {
            responseBody = clippedConsoleText(this.responseText, maxNetworkValueCharacters);
          } else if (this.responseType === "json") {
            responseBody = clippedConsoleText(formatConsoleValue(this.response), maxNetworkValueCharacters);
          } else {
            responseBody = networkBodyValue(this.response);
          }
        } catch (error) {
          responseBody = "[Response body unavailable: " + formatConsoleValue(error) + "]";
        }
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          error: this.status === 0 ? String(this.statusText || "Request failed") : "",
          phase: this.status === 0 ? "failed" : "complete",
          responseBody,
          responseHeaders: networkHeaders(String(this.getAllResponseHeaders?.() || "")
            .split(/\\r?\\n/u)
            .filter(Boolean)
            .map((line) => {
              const separator = line.indexOf(":");
              return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1).trim()] : [line, ""];
            })),
          status: Number(this.status || 0),
          statusText: String(this.statusText || ""),
          url: targetResourceHref(this.responseURL || entry.url)
        });
      }, { once: true });
      try {
        return originalXhrSend.call(this, body);
      } catch (error) {
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          error: formatConsoleValue(error),
          phase: "failed"
        });
        throw error;
      }
    };
  }
  function recordPerformanceResource(resource) {
    const initiatorType = String(resource?.initiatorType || "resource");
    if (["fetch", "xmlhttprequest"].includes(initiatorType)) {
      return;
    }
    if (Number(resource?.responseStatus || 0) >= 400) {
      return;
    }
    networkSuppressedResourceCount += 1;
  }
  if (typeof PerformanceObserver === "function") {
    try {
      const resourceObserver = new PerformanceObserver((list) => {
        for (const resource of list.getEntries()) {
          recordPerformanceResource(resource);
        }
      });
      resourceObserver.observe({ buffered: true, type: "resource" });
    } catch {
      // Resource timing remains optional in older browsers.
    }
  }
  const OriginalWebSocket = window.WebSocket;
  if (typeof OriginalWebSocket === "function") {
    window.WebSocket = class Vibe64PreviewWebSocket extends OriginalWebSocket {
      constructor(url, protocols) {
        if (protocols === undefined) {
          super(url);
        } else {
          super(url, protocols);
        }
        const socketUrl = targetResourceHref(url);
        appendNetworkEntry({ kind: "websocket", method: "CONNECT", phase: "pending", url: socketUrl });
        this.addEventListener("open", () => {
          appendNetworkEntry({ kind: "websocket", method: "OPEN", phase: "complete", url: socketUrl });
        });
        this.addEventListener("message", (event) => {
          appendNetworkEntry({
            kind: "websocket",
            method: "RECEIVE",
            phase: "complete",
            responseBody: networkBodyValue(event.data),
            url: socketUrl
          });
        });
        this.addEventListener("close", (event) => {
          appendNetworkEntry({
            kind: "websocket",
            method: "CLOSE",
            phase: "complete",
            status: Number(event.code || 0),
            statusText: String(event.reason || ""),
            url: socketUrl
          });
        });
        this.addEventListener("error", () => {
          appendNetworkEntry({ kind: "websocket", method: "ERROR", phase: "failed", url: socketUrl });
        });
      }
      send(data) {
        appendNetworkEntry({
          kind: "websocket",
          method: "SEND",
          phase: "complete",
          requestBody: networkBodyValue(data),
          url: targetResourceHref(this.url)
        });
        return super.send(data);
      }
    };
  }
  function internalConsoleMessage(values = []) {
    return typeof values?.[0] === "string" && values[0].startsWith("[VIBE64_SESSION_DEBUG]");
  }
  for (const level of ["debug", "error", "info", "log", "warn"]) {
    const original = window.console?.[level];
    if (typeof original !== "function") {
      continue;
    }
    window.console[level] = function vibe64PreviewConsoleMethod(...values) {
      if (!internalConsoleMessage(values)) {
        appendConsoleEntry(level, values);
      }
      return original.apply(this, values);
    };
  }
  window.addEventListener("error", (event) => {
    if (event instanceof ErrorEvent) {
      appendConsoleEntry("error", [
        event.error || event.message || "Uncaught error",
        event.filename ? "at " + event.filename + ":" + event.lineno + ":" + event.colno : ""
      ].filter(Boolean), "exception");
      return;
    }
    const target = event.target;
    const resourceUrl = String(target?.currentSrc || target?.src || target?.href || "");
    if (target && target !== window && resourceUrl) {
      const resourceKind = String(target.tagName || "resource").toLowerCase();
      appendConsoleEntry("error", [
        "Failed to load " + resourceKind + ":",
        resourceUrl
      ], "resource");
      appendNetworkEntry({
        error: "Resource failed to load",
        kind: resourceKind,
        method: "GET",
        phase: "failed",
        url: resourceUrl
      });
    }
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    appendConsoleEntry("error", ["Unhandled promise rejection:", event.reason], "unhandledrejection");
  });
  function debugLog(event, details = {}) {
    if (config.debug !== true) {
      return;
    }
    const entry = {
      marker: "VIBE64_SESSION_DEBUG",
      timestamp: new Date().toISOString(),
      event: "browser.launchPreviewBridge." + String(event || ""),
      ...details
    };
    try {
      console.info("[VIBE64_SESSION_DEBUG] " + JSON.stringify(entry));
    } catch {
      console.info("[VIBE64_SESSION_DEBUG] " + entry.timestamp + " " + entry.event);
    }
  }
  function targetHref() {
    try {
      const current = new URL(window.location.href);
      if (!config.targetOrigin) {
        return current.toString();
      }
      const target = new URL(config.targetOrigin);
      target.pathname = current.pathname;
      target.search = current.search;
      target.hash = current.hash;
      return target.toString();
    } catch {
      return String(window.location.href || "");
    }
  }
  function targetResourceHref(value) {
    try {
      const resource = new URL(String(value || ""), window.location.href);
      resource.searchParams.delete("vibe64_preview_token");
      if (!config.targetOrigin || resource.host !== window.location.host) {
        return resource.toString();
      }
      const target = new URL(config.targetOrigin);
      if (["ws:", "wss:"].includes(resource.protocol)) {
        target.protocol = resource.protocol;
      }
      target.pathname = resource.pathname;
      target.search = resource.search;
      target.hash = resource.hash;
      return target.toString();
    } catch {
      return String(value || "");
    }
  }
  function publishLocation(reason, options = {}) {
    const href = targetHref();
    if (!href || (options.force !== true && href === lastHref)) {
      return;
    }
    lastHref = href;
    debugLog("location.publish", {
      href,
      reason: String(reason || "location")
    });
    window.parent.postMessage({
      href,
      reason: String(reason || "location"),
      title: String(document.title || ""),
      type: config.locationMessageType,
      version: config.version
    }, "*");
  }
  function wrapHistoryMethod(methodName) {
    const original = window.history && window.history[methodName];
    if (typeof original !== "function") {
      return;
    }
    window.history[methodName] = function vibe64PreviewHistoryMethod(...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => publishLocation(methodName));
      return result;
    };
  }
  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("hashchange", () => publishLocation("hashchange"));
  window.addEventListener("popstate", () => publishLocation("popstate"));
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) {
      return;
    }
    if (event.data?.type === config.queryMessageType) {
      debugLog("query.received", {
        href: targetHref()
      });
      publishLocation("query", {
        force: true
      });
      return;
    }
    if (event.data?.type === config.identityRequestMessageType) {
      const requestId = String(event.data?.requestId || "");
      const grant = String(event.data?.grant || "");
      void (async () => {
        let payload = {};
        try {
          const response = await originalFetch.call(window, config.identityControlPath, {
            body: JSON.stringify({ grant }),
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              "content-type": "application/json"
            },
            method: "POST"
          });
          try {
            payload = await response.json();
          } catch {
            payload = {};
          }
          if (!response.ok || payload?.ok === false) {
            throw Object.assign(new Error(String(
              payload?.error || "Preview identity exchange failed."
            )), {
              code: String(payload?.code || "vibe64_preview_identity_exchange_failed"),
              signedOut: payload?.signedOut === true
            });
          }
          window.parent.postMessage({
            identity: payload?.identity || null,
            ok: true,
            requestId,
            type: config.identityResponseMessageType,
            version: config.version
          }, "*");
        } catch (error) {
          window.parent.postMessage({
            code: String(error?.code || "vibe64_preview_identity_exchange_failed"),
            error: String(error?.message || error || "Preview identity exchange failed."),
            ok: false,
            requestId,
            signedOut: error?.signedOut === true,
            type: config.identityResponseMessageType,
            version: config.version
          }, "*");
        }
      })();
      return;
    }
    if (event.data?.type === config.diagnosticsRequestMessageType) {
      window.parent.postMessage({
        diagnostics: {
          capturedAt: new Date().toISOString(),
          console: {
            droppedEntryCount: consoleDroppedEntryCount,
            entries: consoleEntries.slice()
          },
          href: targetHref(),
          network: {
            droppedEntryCount: networkDroppedEntryCount,
            entries: networkEntries.slice(),
            suppressedResourceCount: networkSuppressedResourceCount
          },
          title: String(document.title || "")
        },
        requestId: String(event.data?.requestId || ""),
        type: config.diagnosticsResponseMessageType,
        version: config.version
      }, "*");
      return;
    }
  });
  window.__vibe64PreviewBridge = Object.freeze({
    publishLocation: () => publishLocation("manual"),
    version: config.version
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      publishLocation("ready");
    }, { once: true });
  } else {
    publishLocation("ready");
  }
  debugLog("init", {
    href: targetHref(),
    readyState: document.readyState,
    targetOrigin: config.targetOrigin,
    version: config.version
  });
})();</script>`;
}

function injectLaunchPreviewBridge(html = "", options = {}) {
  const source = String(html || "");
  if (!source || source.includes("data-vibe64-preview-bridge")) {
    return source;
  }
  const bridge = launchPreviewBridgeScript(options);
  if (/<head(?:\s[^>]*)?>/iu.test(source)) {
    return source.replace(/<head(?:\s[^>]*)?>/iu, (match) => `${match}${bridge}`);
  }
  if (/<body(?:\s[^>]*)?>/iu.test(source)) {
    return source.replace(/<body(?:\s[^>]*)?>/iu, (match) => `${match}${bridge}`);
  }
  return `${bridge}${source}`;
}

export {
  injectLaunchPreviewBridge,
  launchPreviewBridgeScript
};
