import { computed, ref } from "vue";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  STUDIO_SETUP_ENDPOINT,
  STUDIO_SETUP_STREAM_ENDPOINT,
  STUDIO_SETUP_TERMINAL_ENDPOINT
} from "@/lib/studioGateApi.js";
import {
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";

const studioSetupDoctorScreenEmits = ["select-tab"];
const studioSetupDoctorScreenProps = {
  actionsDisabledMessage: {
    default: "",
    type: String
  },
  actionsEnabled: {
    default: true,
    type: Boolean
  },
  continueEnabled: {
    default: true,
    type: Boolean
  },
  continueLabel: {
    default: "Continue to Project Setup",
    type: String
  }
};

function useStudioSetupDoctorScreen(props) {
  const streamedStudioSetup = ref(null);
  const forceRefresh = ref(false);
  const streamAutoStart = ref(false);
  const studioSetupResource = useEndpointResource({
    enabled: computed(() => !props.actionsEnabled),
    fallbackLoadError: "Studio Setup check failed.",
    path: STUDIO_SETUP_ENDPOINT,
    queryKey: ["vibe64", "studio-setup"],
    readQuery: computed(() => forceRefresh.value ? { refresh: true } : null),
    refreshOnPull: true,
    requestRecoveryLabel: "Studio Setup"
  });
  const studioSetup = computed(() => streamedStudioSetup.value || studioSetupResource.data.value || null);
  const loading = computed(() => studioSetupResource.isFetching.value);
  const errorMessage = computed(() => (
    vibe64ResourceResponseError(studioSetupResource.data.value, "Studio Setup check failed.") ||
    studioSetupResource.loadError.value
  ));
  const lede = computed(() => {
    if (studioSetup.value?.ready) {
      return "Environment runtime is ready.";
    }
    return "Environment runtime must be ready before Vibe64 can operate on projects.";
  });

  if (props.actionsEnabled) {
    streamAutoStart.value = true;
  }

  return {
    errorMessage,
    handleStudioSetupUpdated,
    lede,
    loadStudioSetup,
    loading,
    STUDIO_SETUP_STREAM_ENDPOINT,
    STUDIO_SETUP_TERMINAL_ENDPOINT,
    streamAutoStart,
    studioSetup
  };

  async function loadStudioSetup({
    refresh = false
  } = {}) {
    forceRefresh.value = Boolean(refresh);
    streamedStudioSetup.value = null;
    try {
      await studioSetupResource.reload();
    } finally {
      forceRefresh.value = false;
    }
  }

  function handleStudioSetupUpdated(status) {
    streamedStudioSetup.value = status;
  }
}

export {
  studioSetupDoctorScreenEmits,
  studioSetupDoctorScreenProps,
  useStudioSetupDoctorScreen
};
