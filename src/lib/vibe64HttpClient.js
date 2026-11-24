import { createHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { resolveStudioRequestUrl } from "./studioUrls.js";

/**
 * The page's one HTTP client, which src/main.js configures for every request the page makes.
 * @param {{ fetchImpl?: typeof fetch, resolveRequestUrl?: (url: string) => string }} [options]
 */
function createVibe64HttpClient({ fetchImpl, resolveRequestUrl = resolveStudioRequestUrl } = {}) {
  return createHttpWebClient({
    csrf: {
      enabled: false
    },
    ...(fetchImpl ? { fetchImpl } : {}),
    resolveRequestUrl(url) {
      return resolveRequestUrl(url);
    }
  });
}

export {
  createVibe64HttpClient
};
