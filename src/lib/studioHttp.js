import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";

const studioHttpClient = createTransientRetryHttpClient({
  credentials: "include",
  csrf: {
    enabled: false
  }
});

function studioApiPath(relativePath) {
  return resolveScopedApiBasePath({
    routeBase: "/",
    relativePath,
    strictParams: false
  });
}

function resolveWebSocketUrl(pathname, browserWindow = window) {
  const protocol = browserWindow.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${browserWindow.location.host}${pathname}`;
}

export {
  resolveWebSocketUrl,
  studioApiPath,
  studioHttpClient
};
