import { createAssistantApi } from "@jskit-ai/assistant-core/client";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";

const VIBE64_ASSISTANT_ENDPOINT = "/api/assistant/app";

// Main chat and Temporary AI reach the app assistant surface through the
// editor's HTTP client; JSKIT's default assistant client needs a CSRF session
// route that a local editor lacks.
function vibe64AssistantConversationOptions() {
  return {
    api: createAssistantApi({ request: (url, options) => getHttpWebClient().request(url, options),
      resolveBasePath: () => VIBE64_ASSISTANT_ENDPOINT, resolveSurfaceId: () => "app" }),
    endpoint: VIBE64_ASSISTANT_ENDPOINT,
    surfaceId: "app",
    hostSurfaceId: "app",
    workspaceSlug: ""
  };
}

export { VIBE64_ASSISTANT_ENDPOINT, vibe64AssistantConversationOptions };
