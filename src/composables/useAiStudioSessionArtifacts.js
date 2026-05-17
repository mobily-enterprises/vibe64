import { computed, nextTick, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioArtifactsPath,
  aiStudioArtifactsQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function normalizeArtifacts(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function useAiStudioSessionArtifacts() {
  const paths = usePaths();
  const artifactSessionId = ref("");
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));

  const artifactsResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Draft could not be loaded.",
    path: computed(() => artifactSessionId.value
      ? aiStudioArtifactsPath(sessionsApiPath.value, artifactSessionId.value)
      : ""),
    queryKey: computed(() => aiStudioArtifactsQueryKey(
      AI_STUDIO_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      artifactSessionId.value
    ))
  });

  const saveArtifactsCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "PUT",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioArtifactsPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      artifacts: normalizeArtifacts(context.artifacts)
    }),
    fallbackRunError: "Draft could not be saved.",
    messages: {
      error: "Draft could not be saved.",
      success: "Draft saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.session-artifacts.save",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "PUT"
  });

  async function readArtifacts(sessionId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    artifactSessionId.value = normalizedSessionId;
    if (!artifactSessionId.value) {
      return {
        error: "AI Studio session id is required.",
        ok: false
      };
    }

    await nextTick();
    const result = await artifactsResource.reload();
    return result?.data || artifactsResource.data.value || {};
  }

  async function saveArtifacts(sessionId = "", artifacts = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return {
        error: "AI Studio session id is required.",
        ok: false
      };
    }

    const response = await saveArtifactsCommand.run({
      artifacts,
      sessionId: normalizedSessionId
    });
    if (artifactSessionId.value === normalizedSessionId) {
      await artifactsResource.reload().catch(() => null);
    }
    return response;
  }

  return {
    artifactsLoadError: artifactsResource.loadError,
    artifactsLoading: artifactsResource.isLoading,
    readArtifacts,
    saveArtifacts,
    saveArtifactsCommand
  };
}

export {
  useAiStudioSessionArtifacts
};
