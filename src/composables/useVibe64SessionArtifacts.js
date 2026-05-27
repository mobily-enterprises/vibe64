import { computed, nextTick, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64ArtifactPreviewPath,
  vibe64ArtifactPreviewQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function normalizePreviewId(previewId = "") {
  return String(previewId || "").trim();
}

function artifactPreviewReadPath(sessionsApiPath = "", sessionId = "", previewId = "") {
  const basePath = vibe64ArtifactPreviewPath(sessionsApiPath, sessionId);
  return previewId ? `${basePath}?previewId=${encodeURIComponent(previewId)}` : basePath;
}

function useVibe64SessionArtifacts() {
  const paths = usePaths();
  const previewId = ref("");
  const previewSessionId = ref("");
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));

  const previewResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Artifact preview could not be loaded.",
    path: computed(() => previewSessionId.value
      ? artifactPreviewReadPath(sessionsApiPath.value, previewSessionId.value, previewId.value)
      : ""),
    queryKey: computed(() => vibe64ArtifactPreviewQueryKey(
      VIBE64_SURFACE_ID,
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
        error: "Vibe64 session id and artifact preview id are required.",
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
  useVibe64SessionArtifacts
};
