// Reads for a session's repository views: current changes, saved history and update checks.
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";

function repositoryErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : String(error || fallback);
}

/** Reads one repository endpoint; a refused answer becomes an error carrying the server's code. */
async function requestRepositoryJson(path, options = {}) {
  if (!path) {
    throw new Error("Repository information is not available yet.");
  }
  const result = await getHttpWebClient().request(path, {
    method: "GET",
    ...options
  });
  if (result?.ok === false) {
    throw vibe64ApiError(result, "Repository information could not be loaded.");
  }
  return result;
}

export {
  repositoryErrorMessage,
  requestRepositoryJson
};
