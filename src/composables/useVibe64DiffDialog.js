import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  resolveResponseErrorMessage
} from "@/lib/vibe64ResponseErrors.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";

function useVibe64DiffDialog({
  canOpen,
  selectedSessionId
} = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const diffDialogOpen = ref(false);
  const localDiffError = ref("");
  const diffPayload = ref(null);
  const sessionId = computed(() => String(unref(selectedSessionId) || "").trim());
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const diffResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Diff inspection failed.",
    path: computed(() => sessionId.value
      ? vibe64SessionPath(sessionsApiPath.value, sessionId.value, "/diff")
      : ""),
    queryKey: computed(() => [
      "vibe64",
      "project",
      projectSlug.value || "unscoped",
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      "diff",
      sessionId.value
    ]),
    requestRecoveryLabel: "Diff"
  });
  const diffError = computed(() => String(
    localDiffError.value ||
    (diffPayload.value?.ok === false ? resolveResponseErrorMessage(diffPayload.value, "Diff inspection failed.") : "") ||
    diffResource.loadError.value ||
    ""
  ));
  const diffLoading = diffResource.isFetching;

  async function loadDiff() {
    if (!sessionId.value || !readRefOrGetterBoolean(canOpen)) {
      return false;
    }
    localDiffError.value = "";
    diffPayload.value = null;
    try {
      const result = await diffResource.reload();
      const response = result?.data || diffResource.data.value || null;
      diffPayload.value = response;
      if (response?.ok === false) {
        return false;
      }
      if (diffResource.loadError.value) {
        return false;
      }
      return true;
    } catch (error) {
      localDiffError.value = String(error?.message || error || "Diff inspection failed.");
      return false;
    }
  }

  async function openDiffDialog() {
    if (!sessionId.value || !readRefOrGetterBoolean(canOpen)) {
      return false;
    }
    diffDialogOpen.value = true;
    return loadDiff();
  }

  function closeDiffDialog() {
    diffDialogOpen.value = false;
  }

  function clearDiffDialog() {
    diffDialogOpen.value = false;
    localDiffError.value = "";
    diffPayload.value = null;
  }

  return {
    clearDiffDialog,
    closeDiffDialog,
    diffDialogOpen,
    diffError,
    diffLoading,
    diffPayload,
    loadDiff,
    openDiffDialog
  };
}

export {
  useVibe64DiffDialog
};
