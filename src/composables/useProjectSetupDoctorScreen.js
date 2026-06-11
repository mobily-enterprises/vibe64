import { computed, onMounted, ref } from "vue";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  PROJECT_SETUP_ENDPOINT,
  PROJECT_SETUP_STREAM_ENDPOINT,
  PROJECT_SETUP_TERMINAL_ENDPOINT,
  STUDIO_SETUP_ENDPOINT
} from "@/lib/studioGateApi.js";
import {
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";

function useProjectSetupDoctorScreen() {
  const streamedProjectSetup = ref(null);
  const checking = ref(false);
  const localError = ref("");
  const forceProjectRefresh = ref(false);
  const streamEnabled = ref(false);
  const streamAutoStart = ref(true);
  const studioSetupResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Studio Setup check failed.",
    path: STUDIO_SETUP_ENDPOINT,
    queryKey: ["vibe64", "studio-setup"],
    refreshOnPull: true,
    requestRecoveryLabel: "Studio Setup"
  });
  const projectSetupResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Project Setup check failed.",
    path: PROJECT_SETUP_ENDPOINT,
    queryKey: ["vibe64", "project-setup"],
    readQuery: computed(() => forceProjectRefresh.value ? { refresh: true } : null),
    refreshOnPull: true,
    requestRecoveryLabel: "Project Setup"
  });
  const studioSetupError = computed(() => (
    vibe64ResourceResponseError(studioSetupResource.data.value, "Studio Setup check failed.") ||
    studioSetupResource.loadError.value
  ));
  const projectSetupError = computed(() => (
    vibe64ResourceResponseError(projectSetupResource.data.value, "Project Setup check failed.") ||
    projectSetupResource.loadError.value
  ));
  const projectSetup = computed(() => streamedProjectSetup.value || projectSetupResource.data.value || null);
  const loading = computed(() => Boolean(
    checking.value ||
    studioSetupResource.isFetching.value ||
    projectSetupResource.isFetching.value
  ));
  const errorMessage = computed(() => String(
    localError.value ||
    studioSetupError.value ||
    projectSetupError.value ||
    ""
  ));
  const lede = computed(() => {
    if (loading.value && !streamEnabled.value) {
      return "Checking Studio Setup before Project Setup runs.";
    }
    if (projectSetup.value?.ready) {
      return "";
    }
    return "Checking Project Setup.";
  });

  onMounted(() => {
    void loadProjectSetup();
  });

  return {
    errorMessage,
    handleProjectSetupUpdated,
    lede,
    loadProjectSetup,
    loading,
    PROJECT_SETUP_STREAM_ENDPOINT,
    PROJECT_SETUP_TERMINAL_ENDPOINT,
    projectSetup,
    streamAutoStart,
    streamEnabled
  };

  async function loadProjectSetup({
    autoStart = true,
    refresh = false
  } = {}) {
    checking.value = true;
    localError.value = "";
    streamedProjectSetup.value = null;
    streamEnabled.value = false;
    streamAutoStart.value = autoStart;

    try {
      await studioSetupResource.reload();

      if (studioSetupError.value) {
        return;
      }
      const studioSetup = studioSetupResource.data.value;
      if (studioSetup?.ready !== true) {
        localError.value = "Studio Setup is not ready. Open Management mode to complete Studio Setup.";
        return;
      }

      if (refresh && typeof EventSource !== "function") {
        forceProjectRefresh.value = true;
        try {
          await projectSetupResource.reload();
        } finally {
          forceProjectRefresh.value = false;
        }
        return;
      }

      streamEnabled.value = true;
    } catch (error) {
      localError.value = String(error?.message || error || "Project Setup check failed.");
    } finally {
      checking.value = false;
    }
  }

  function handleProjectSetupUpdated(status) {
    streamedProjectSetup.value = status;
  }
}

export {
  useProjectSetupDoctorScreen
};
