import { computed, nextTick, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  aiStudioArtifactPreviewPath,
  aiStudioArtifactPreviewQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function normalizePreviewId(previewId = "") {
  return String(previewId || "").trim();
}

function artifactPreviewReadPath(sessionsApiPath = "", sessionId = "", previewId = "") {
  const basePath = aiStudioArtifactPreviewPath(sessionsApiPath, sessionId);
  return previewId ? `${basePath}?previewId=${encodeURIComponent(previewId)}` : basePath;
}

function useAiStudioSessionArtifacts() {
  const paths = usePaths();
  const previewId = ref("");
  const previewSessionId = ref("");
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));

  const previewResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Artifact preview could not be loaded.",
    path: computed(() => previewSessionId.value
      ? artifactPreviewReadPath(sessionsApiPath.value, previewSessionId.value, previewId.value)
      : ""),
    queryKey: computed(() => aiStudioArtifactPreviewQueryKey(
      AI_STUDIO_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      previewSessionId.value,
      previewId.value
    ))
  });

  async function readArtifactPreview(sessionId = "", nextPreviewId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedPreviewId = normalizePreviewId(nextPreviewId);
    previewSessionId.value = normalizedSessionId;
    previewId.value = normalizedPreviewId;
    if (!previewSessionId.value || !previewId.value) {
      return {
        error: "AI Studio session id and artifact preview id are required.",
        ok: false
      };
    }

    await nextTick();
    const result = await previewResource.reload();
    return result?.data || previewResource.data.value || {};
  }

  return {
    artifactsLoadError: previewResource.loadError,
    artifactsLoading: previewResource.isLoading,
    readArtifactPreview
  };
}

export {
  useAiStudioSessionArtifacts
};
