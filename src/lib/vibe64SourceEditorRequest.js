import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";

/**
 * Sends one source editor request, and throws the refusal when the server
 * answers `ok: false`.
 * @param {string} url
 * @param {object} [options] The HTTP client's request options.
 */
async function sourceEditorRequest(url = "", options = {}) {
  const payload = await getHttpWebClient().request(url, options);
  if (payload?.ok === false) {
    throw vibe64ApiError(payload, "Source editor request failed.");
  }
  return payload;
}

export { sourceEditorRequest };
