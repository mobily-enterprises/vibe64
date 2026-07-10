import {
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_QUERY_MESSAGE_TYPE
} from "../shared/launchPreviewProtocol.js";

function launchPreviewBridgeScript({
  debug = false,
  targetOrigin = ""
} = {}) {
  const config = JSON.stringify({
    debug: debug === true,
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
  if (/<\/head\s*>/iu.test(source)) {
    return source.replace(/<\/head\s*>/iu, `${bridge}</head>`);
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
