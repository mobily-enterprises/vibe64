// Requests to one Files area's API, such as `<sessions>/<id>/files/drop-zone`.
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";

/**
 * The address of one operation on a path in the area.
 * @param {string} base The area's API address.
 * @param {string} operation Such as `tree`, `file` or `download`.
 * @param {string} filePath
 * @param {Record<string, string | number>} [query]
 */
function fileAreaUrl(base, operation, filePath, query = {}) {
  return `${base}/${operation}?${new URLSearchParams({ path: filePath, ...query })}`;
}

/**
 * Sends one request, and throws the refusal when the server answers `ok: false`.
 * @param {string} endpoint
 * @param {object} [options] The HTTP client's request options.
 */
async function fileAreaRequest(endpoint, options) {
  const result = await getHttpWebClient().request(endpoint, options);
  if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "File operation failed."));
  return result;
}

export { fileAreaRequest, fileAreaUrl };
