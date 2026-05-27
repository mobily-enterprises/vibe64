import { computed, ref, watch } from "vue";
import {
  useVibe64SessionArtifacts
} from "@/composables/useVibe64SessionArtifacts.js";
import {
  resolveResponseErrorMessage
} from "@/lib/vibe64ResponseErrors.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function artifactReadinessVersion(readiness = {}) {
  return Object.entries(readiness || {})
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, state]) => [
      name,
      state?.nonEmpty === true ? "ready" : "missing",
      String(state?.fingerprint || "")
    ].join(":"))
    .join("|");
}

function useVibe64ArtifactPreview({
  active = true,
  artifactReadiness = null,
  loadErrorMessage = "Artifact could not be loaded.",
  previewId = "",
  session
} = {}) {
  const artifactPreview = useVibe64SessionArtifacts();
  const error = ref("");
  const text = ref("");
  let requestId = 0;

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const currentLiveReadiness = computed(() => readRefOrGetterValue(artifactReadiness) || {});
  const currentReadinessVersion = computed(() => artifactReadinessVersion({
    ...currentSession.value?.artifactReadiness,
    ...currentLiveReadiness.value
  }));
  const loading = computed(() => artifactPreview.artifactsLoading.value);
  const canLoad = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    currentSession.value?.sessionId &&
    previewId
  ));
  const visible = computed(() => Boolean(
    loading.value ||
    error.value ||
    text.value
  ));
  const loadKey = computed(() => [
    readRefOrGetterValue(active) === false ? "inactive" : "active",
    currentSession.value?.sessionId || "",
    currentSession.value?.currentStep || "",
    previewId,
    currentReadinessVersion.value
  ].join(":"));

  async function load() {
    const nextRequestId = requestId + 1;
    requestId = nextRequestId;
    error.value = "";
    text.value = "";

    if (!canLoad.value) {
      return;
    }

    try {
      const response = await artifactPreview.readArtifactPreview(currentSession.value.sessionId, previewId);
      if (nextRequestId !== requestId) {
        return;
      }
      if (response?.ok === false) {
        error.value = resolveResponseErrorMessage(response, loadErrorMessage);
        return;
      }
      text.value = String(response?.text || "").trim();
    } catch (loadError) {
      if (nextRequestId === requestId) {
        error.value = String(loadError?.message || loadError || loadErrorMessage);
      }
    }
  }

  watch(loadKey, () => {
    void load();
  }, {
    flush: "post",
    immediate: true
  });

  return {
    error,
    loading,
    text,
    visible
  };
}

export {
  useVibe64ArtifactPreview
};
