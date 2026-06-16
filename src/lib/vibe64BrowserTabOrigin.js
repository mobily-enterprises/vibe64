const VIBE64_BROWSER_TAB_ORIGIN_KEY = "__vibe64BrowserTabOriginId";

function normalizeOriginId(value = "") {
  return String(value || "").trim();
}

function createBrowserTabOriginId(root = globalThis) {
  const cryptoApi = root?.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `tab:${cryptoApi.randomUUID()}`;
  }
  return `tab:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function vibe64BrowserTabOriginId(root = globalThis) {
  const existing = normalizeOriginId(root?.[VIBE64_BROWSER_TAB_ORIGIN_KEY]);
  if (existing) {
    return existing;
  }
  const nextOriginId = createBrowserTabOriginId(root);
  try {
    Object.defineProperty(root, VIBE64_BROWSER_TAB_ORIGIN_KEY, {
      configurable: false,
      enumerable: false,
      value: nextOriginId,
      writable: false
    });
  } catch {
    root[VIBE64_BROWSER_TAB_ORIGIN_KEY] = nextOriginId;
  }
  return nextOriginId;
}

function vibe64RealtimeOriginPayload(fields = {}, root = globalThis) {
  return {
    ...(fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {}),
    originId: vibe64BrowserTabOriginId(root)
  };
}

function vibe64RealtimePayloadFromCurrentTab(payload = {}, {
  originId = vibe64BrowserTabOriginId()
} = {}) {
  const payloadOriginId = normalizeOriginId(payload?.originId);
  const currentOriginId = normalizeOriginId(originId);
  return Boolean(payloadOriginId && currentOriginId && payloadOriginId === currentOriginId);
}

export {
  VIBE64_BROWSER_TAB_ORIGIN_KEY,
  normalizeOriginId,
  vibe64BrowserTabOriginId,
  vibe64RealtimeOriginPayload,
  vibe64RealtimePayloadFromCurrentTab
};
