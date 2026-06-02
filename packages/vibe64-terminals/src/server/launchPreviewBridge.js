const PREVIEW_BRIDGE_MESSAGE_TYPE = "vibe64:preview-location";
const PREVIEW_QUERY_MESSAGE_TYPE = "vibe64:preview-query";
const PREVIEW_READY_MESSAGE_TYPE = "vibe64:preview-ready";
const PREVIEW_BRIDGE_VERSION = 1;

function launchPreviewBridgeScript({
  targetOrigin = ""
} = {}) {
  const config = JSON.stringify({
    messageType: PREVIEW_BRIDGE_MESSAGE_TYPE,
    queryMessageType: PREVIEW_QUERY_MESSAGE_TYPE,
    readyMessageType: PREVIEW_READY_MESSAGE_TYPE,
    targetOrigin: String(targetOrigin || ""),
    version: PREVIEW_BRIDGE_VERSION
  });

  return `<script data-vibe64-preview-bridge="1">(() => {
  const config = ${config};
  if (window.__vibe64PreviewBridge && window.__vibe64PreviewBridge.version >= config.version) {
    return;
  }
  let lastHref = "";
  let readyPublished = false;
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
  function publishLocation(reason) {
    const href = targetHref();
    if (!href || href === lastHref) {
      return;
    }
    lastHref = href;
    window.parent.postMessage({
      href,
      reason: String(reason || "location"),
      type: config.messageType,
      version: config.version
    }, "*");
  }
  function appRoot() {
    return document.querySelector("#app") || document.body || null;
  }
  function appHasRenderedDom() {
    const root = appRoot();
    if (!root) {
      return false;
    }
    if (root.id === "app") {
      return root.childElementCount > 0 || String(root.textContent || "").trim().length > 0;
    }
    return Array.from(root.children || []).some((child) => {
      return child.tagName !== "SCRIPT" && child.tagName !== "STYLE";
    });
  }
  function publishReady(reason, options = {}) {
    const force = options && options.force === true;
    if ((!force && readyPublished) || !appHasRenderedDom()) {
      return false;
    }
    readyPublished = true;
    window.parent.postMessage({
      href: targetHref(),
      reason: String(reason || "rendered"),
      type: config.readyMessageType,
      version: config.version
    }, "*");
    return true;
  }
  function watchPreviewReady() {
    if (publishReady("initial")) {
      return;
    }
    const root = appRoot() || document.documentElement;
    if (!root || typeof MutationObserver !== "function") {
      return;
    }
    const observer = new MutationObserver(() => {
      if (publishReady("mutation")) {
        observer.disconnect();
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true
    });
    window.setTimeout(() => {
      observer.disconnect();
    }, 30000);
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
    if (event.source !== window.parent || event.data?.type !== config.queryMessageType) {
      return;
    }
    publishLocation("query");
    publishReady("query", {
      force: true
    });
  });
  window.__vibe64PreviewBridge = Object.freeze({
    publishLocation: () => publishLocation("manual"),
    publishReady: () => publishReady("manual", {
      force: true
    }),
    version: config.version
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      publishLocation("ready");
      watchPreviewReady();
    }, { once: true });
  } else {
    publishLocation("ready");
    watchPreviewReady();
  }
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
  PREVIEW_BRIDGE_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_QUERY_MESSAGE_TYPE,
  PREVIEW_READY_MESSAGE_TYPE,
  injectLaunchPreviewBridge,
  launchPreviewBridgeScript
};
