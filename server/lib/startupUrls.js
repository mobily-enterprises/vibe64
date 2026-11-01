import { normalizeProjectSlug } from "@local/vibe64-core/server/studioProjectContext";

function startupBrowserPath({
  startupSlug = ""
} = {}) {
  const slug = String(startupSlug || "").trim();
  return slug ? `/app/project/${encodeURIComponent(normalizeProjectSlug(slug))}` : "/app";
}

function startupRedirectPathForRequest(requestUrl = "", options = {}) {
  const {
    startupSlug = ""
  } = options;
  const path = startupBrowserPath({
    startupSlug
  });
  if (path === "/app") {
    return "";
  }
  const search = new URL(String(requestUrl || "/"), "http://localhost").search;
  return `${path}${search}`;
}

function browserUrlForListenAddress(address = "", options = {}) {
  const url = new URL(address);
  if (["0.0.0.0", "[::]"].includes(url.hostname)) {
    url.hostname = "127.0.0.1";
  }
  return `${url.origin}${startupBrowserPath(options)}`;
}

function browserUrlForPublicOrigin(origin = "", options = {}) {
  const normalizedOrigin = String(origin || "").trim();
  if (!normalizedOrigin) {
    return "";
  }
  const url = new URL(normalizedOrigin);
  return `${url.origin}${startupBrowserPath(options)}`;
}

export {
  browserUrlForListenAddress,
  browserUrlForPublicOrigin,
  startupBrowserPath,
  startupRedirectPathForRequest
};
