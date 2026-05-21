import { computed, ref, watch } from "vue";
import {
  useAiStudioSessionArtifacts
} from "@/composables/useAiStudioSessionArtifacts.js";
import {
  resolveResponseErrorMessage
} from "@/lib/aiStudioResponseErrors.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function artifactIsReady(session = {}, artifactName = "") {
  return session?.artifactReadiness?.[artifactName]?.nonEmpty === true;
}

function actionById(actions = [], actionId = "") {
  return (Array.isArray(actions) ? actions : [])
    .find((action) => action.id === actionId) || null;
}

function useAiStudioArtifactPreview({
  actionId = "",
  active = true,
  artifactName = "",
  currentActions,
  loadErrorMessage = "Artifact could not be loaded.",
  session
} = {}) {
  const artifacts = useAiStudioSessionArtifacts();
  const error = ref("");
  const text = ref("");
  let requestId = 0;

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const editorAction = computed(() => actionById(readRefOrGetterValue(currentActions), actionId));
  const loading = computed(() => artifacts.artifactsLoading.value);
  const ready = computed(() => artifactIsReady(currentSession.value, artifactName));
  const canLoad = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    currentSession.value?.sessionId &&
    editorAction.value?.enabled === true
  ));
  const visible = computed(() => Boolean(
    loading.value ||
    error.value ||
    text.value ||
    editorAction.value?.enabled === true
  ));
  const loadKey = computed(() => [
    readRefOrGetterValue(active) === false ? "inactive" : "active",
    currentSession.value?.sessionId || "",
    currentSession.value?.currentStep || "",
    ready.value ? "ready" : "missing",
    editorAction.value?.enabled === true ? "enabled" : "disabled"
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
      const response = await artifacts.readArtifacts(currentSession.value.sessionId, actionId);
      if (nextRequestId !== requestId) {
        return;
      }
      if (response?.ok === false) {
        error.value = resolveResponseErrorMessage(response, loadErrorMessage);
        return;
      }
      text.value = String(response?.artifacts?.[artifactName] || "").trim();
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
  useAiStudioArtifactPreview
};
