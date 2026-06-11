import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import {
  currentProjectSlugFromLocation
} from "@/lib/vibe64ProjectScope.js";

function studioApiPath(relativePath) {
  return resolveScopedApiBasePath({
    routeBase: "/",
    relativePath,
    strictParams: false
  });
}

function resolveStudioRequestUrl(url) {
  return scopedDevelopmentApiUrl(url, currentProjectSlugFromLocation());
}

function scopedDevelopmentApiUrl(url, slug = currentProjectSlugFromLocation()) {
  const projectSlug = String(slug || "").trim();
  if (!projectSlug) {
    return url;
  }
  const source = String(url || "").trim();
  if (!source) {
    return url;
  }

  const absolute = /^[a-z][a-z0-9+.-]*:\/\//iu.test(source);
  const base = typeof window === "undefined" ? "http://vibe64.local" : window.location.origin;
  const parsed = new URL(source, base);
  const pathname = scopedDevelopmentApiPathname(parsed.pathname, projectSlug);
  if (pathname === parsed.pathname) {
    return url;
  }
  parsed.pathname = pathname;
  return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function scopedDevelopmentApiPathname(pathname = "", slug = "") {
  const normalizedPathname = String(pathname || "").trim();
  if (
    !slug ||
    normalizedPathname.startsWith("/api/app/") ||
    isGlobalApiPathname(normalizedPathname) ||
    !isDevelopmentApiPathname(normalizedPathname)
  ) {
    return normalizedPathname;
  }
  return `/api/app/${encodeURIComponent(slug)}${normalizedPathname.slice("/api".length)}`;
}

function isGlobalApiPathname(pathname = "") {
  return pathname === "/api/studio/studio-setup" ||
    pathname.startsWith("/api/studio/studio-setup/") ||
    pathname === "/api/studio/browser-lifecycle/ws" ||
    pathname === "/api/vibe64/accounts" ||
    pathname.startsWith("/api/vibe64/accounts/");
}

function isDevelopmentApiPathname(pathname = "") {
  return (
    pathname === "/api/studio" ||
    pathname.startsWith("/api/studio/") ||
    pathname === "/api/vibe64" ||
    pathname.startsWith("/api/vibe64/")
  );
}

function resolveWebSocketUrl(pathname, browserWindow = window) {
  const protocol = browserWindow.location.protocol === "https:" ? "wss:" : "ws:";
  const scopedPathname = scopedDevelopmentApiUrl(pathname, currentProjectSlugFromLocation());
  return `${protocol}//${browserWindow.location.host}${scopedPathname}`;
}

export {
  resolveStudioRequestUrl,
  resolveWebSocketUrl,
  scopedDevelopmentApiPathname,
  scopedDevelopmentApiUrl,
  studioApiPath
};
