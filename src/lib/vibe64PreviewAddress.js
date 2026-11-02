// The Preview's addresses: the page a frame loads, the route and address the
// editor shows for it, and where an address typed in the toolbar may go.

import { PREVIEW_PROXY_TOKEN_QUERY_PARAM } from "@local/vibe64-terminals/shared/launchPreviewProtocol";

const PREVIEW_DISPLAY_QUERY_PARAMS = Object.freeze([
  PREVIEW_PROXY_TOKEN_QUERY_PARAM
]);

function previewUrlWithoutDisplayParams(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    for (const param of PREVIEW_DISPLAY_QUERY_PARAMS) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return stripPreviewDisplayQueryParams(text);
  }
}

function stripPreviewDisplayQueryParams(value = "") {
  const text = String(value || "");
  const hashIndex = text.indexOf("#");
  const beforeHash = hashIndex >= 0 ? text.slice(0, hashIndex) : text;
  const hash = hashIndex >= 0 ? text.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex < 0) {
    return text;
  }
  const base = beforeHash.slice(0, queryIndex);
  const parts = beforeHash
    .slice(queryIndex + 1)
    .split("&")
    .filter((part) => !PREVIEW_DISPLAY_QUERY_PARAMS.includes(queryParamName(part)));
  return `${base}${parts.length > 0 ? `?${parts.join("&")}` : ""}${hash}`;
}

function queryParamName(part = "") {
  const separatorIndex = String(part || "").indexOf("=");
  const rawName = separatorIndex < 0 ? String(part || "") : String(part || "").slice(0, separatorIndex);
  try {
    return decodeURIComponent(rawName.replace(/\+/gu, " "));
  } catch {
    return rawName;
  }
}

function normalizePreviewRoute(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("/")) {
    return text;
  }
  if (text.startsWith("?") || text.startsWith("#")) {
    return `/${text}`;
  }
  return "";
}

function previewRouteFromUrl(value = "") {
  const text = previewUrlWithoutDisplayParams(value);
  if (!text) {
    return "";
  }
  const route = normalizePreviewRoute(text);
  if (route) {
    return route;
  }
  try {
    const url = new URL(text);
    return `${url.pathname || "/"}${url.search}${url.hash}` || "/";
  } catch {
    return "";
  }
}

function previewUrlForRoute(route = "", baseUrl = "") {
  const normalizedRoute = normalizePreviewRoute(route);
  const baseText = previewUrlWithoutDisplayParams(baseUrl);
  if (!normalizedRoute || !baseText) {
    return "";
  }
  try {
    return new URL(normalizedRoute, baseText).toString();
  } catch {
    return "";
  }
}

function previewAddressDisplayText(value = "", {
  displayBaseUrl = "",
  previewBaseUrl = ""
} = {}) {
  const displayUrl = previewUrlWithoutDisplayParams(value);
  if (!displayUrl) {
    return "";
  }
  try {
    const url = new URL(displayUrl);
    const sameAppOrigins = [
      displayBaseUrl,
      previewBaseUrl
    ].map((baseUrl) => {
      try {
        return previewUrlWithoutDisplayParams(baseUrl)
          ? new URL(previewUrlWithoutDisplayParams(baseUrl)).origin
          : "";
      } catch {
        return "";
      }
    }).filter(Boolean);
    if (sameAppOrigins.includes(url.origin)) {
      return `${url.pathname || "/"}${url.search}${url.hash}` || "/";
    }
  } catch {
    return displayUrl;
  }
  return displayUrl;
}

function launchPreviewFrameUrl({
  baseUrl = "",
  displayBaseUrl = "",
  visitedUrl = ""
} = {}) {
  const baseText = String(baseUrl || "").trim();
  if (!baseText) {
    return "";
  }
  const routeSource = String(visitedUrl || displayBaseUrl || baseText).trim();
  try {
    const base = new URL(baseText);
    const route = new URL(routeSource, String(displayBaseUrl || baseText));
    const token = base.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM) || "";
    base.pathname = route.pathname;
    base.search = route.search;
    base.hash = route.hash;
    if (token) {
      base.searchParams.set(PREVIEW_PROXY_TOKEN_QUERY_PARAM, token);
    }
    return base.toString();
  } catch {
    return baseText;
  }
}

function normalizePreviewAddressInput(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (
    /^[a-z][a-z\d+.-]*:/iu.test(text) ||
    /^[/?#]/u.test(text) ||
    text.startsWith("./") ||
    text.startsWith("../")
  ) {
    return text;
  }
  return `/${text}`;
}

function launchPreviewAddressNavigationUrl({
  address = "",
  currentUrl = "",
  displayBaseUrl = "",
  previewBaseUrl = ""
} = {}) {
  const previewBaseText = String(previewBaseUrl || "").trim();
  const displayBaseText = previewUrlWithoutDisplayParams(displayBaseUrl || previewBaseText);
  const currentText = previewUrlWithoutDisplayParams(currentUrl || displayBaseText);
  const input = normalizePreviewAddressInput(address);
  if (!input || !previewBaseText || !displayBaseText) {
    return {
      displayUrl: "",
      error: "Preview URL is not available yet.",
      ok: false,
      previewUrl: ""
    };
  }
  try {
    const previewBase = new URL(previewBaseText);
    const displayBase = new URL(displayBaseText);
    const target = new URL(input, currentText || displayBaseText);
    const allowedOrigins = new Set([
      displayBase.origin,
      previewBase.origin
    ]);
    if (!allowedOrigins.has(target.origin)) {
      return {
        displayUrl: "",
        error: "Preview URL must stay inside this app.",
        ok: false,
        previewUrl: ""
      };
    }
    const previewTarget = target.origin === previewBase.origin
      ? new URL(target)
      : new URL(previewBase);
    const displayTarget = target.origin === displayBase.origin
      ? new URL(target)
      : new URL(displayBase);
    if (target.origin !== previewBase.origin) {
      previewTarget.pathname = target.pathname;
      previewTarget.search = target.search;
      previewTarget.hash = target.hash;
    }
    if (target.origin !== displayBase.origin) {
      displayTarget.pathname = target.pathname;
      displayTarget.search = target.search;
      displayTarget.hash = target.hash;
    }
    return {
      displayUrl: previewUrlWithoutDisplayParams(displayTarget.toString()),
      error: "",
      ok: true,
      previewUrl: launchPreviewFrameUrl({
        baseUrl: previewBaseText,
        displayBaseUrl: displayBaseText,
        visitedUrl: displayTarget.toString()
      })
    };
  } catch {
    return {
      displayUrl: "",
      error: "Preview URL is invalid.",
      ok: false,
      previewUrl: ""
    };
  }
}

function redactPreviewDebugDetails(value) {
  if (typeof value === "string") {
    return value.includes(PREVIEW_PROXY_TOKEN_QUERY_PARAM)
      ? previewUrlWithoutDisplayParams(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPreviewDebugDetails(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    redactPreviewDebugDetails(entry)
  ]));
}

export {
  launchPreviewAddressNavigationUrl,
  launchPreviewFrameUrl,
  normalizePreviewRoute,
  previewAddressDisplayText,
  previewRouteFromUrl,
  previewUrlForRoute,
  previewUrlWithoutDisplayParams,
  redactPreviewDebugDetails
};
