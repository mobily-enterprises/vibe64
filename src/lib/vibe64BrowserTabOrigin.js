const VIBE64_BROWSER_TAB_ORIGIN_KEY = "__vibe64BrowserTabOriginId";
const VIBE64_BROWSER_TAB_ORIGIN_STORAGE_KEY = "vibe64:browser-tab-origin-id";

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

function browserTabSessionStorage(root = globalThis) {
  try {
    return root?.sessionStorage || root?.window?.sessionStorage || null;
  } catch {
    return null;
  }
}

function readStoredBrowserTabOriginId(root = globalThis) {
  try {
    return normalizeOriginId(browserTabSessionStorage(root)?.getItem(VIBE64_BROWSER_TAB_ORIGIN_STORAGE_KEY));
  } catch {
    return "";
  }
}

function writeStoredBrowserTabOriginId(root = globalThis, originId = "") {
  const normalizedOriginId = normalizeOriginId(originId);
  if (!normalizedOriginId) {
    return;
  }
  try {
    browserTabSessionStorage(root)?.setItem(VIBE64_BROWSER_TAB_ORIGIN_STORAGE_KEY, normalizedOriginId);
  } catch {
    // Session storage is a convenience for reload stability; the in-memory id remains authoritative for this tab runtime.
  }
}

function vibe64BrowserTabOriginId(root = globalThis) {
  const existing = normalizeOriginId(root?.[VIBE64_BROWSER_TAB_ORIGIN_KEY]);
  if (existing) {
    return existing;
  }
  const nextOriginId = readStoredBrowserTabOriginId(root) || createBrowserTabOriginId(root);
  writeStoredBrowserTabOriginId(root, nextOriginId);
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
  VIBE64_BROWSER_TAB_ORIGIN_STORAGE_KEY,
  normalizeOriginId,
  vibe64BrowserTabOriginId,
  vibe64RealtimeOriginPayload,
  vibe64RealtimePayloadFromCurrentTab
};
