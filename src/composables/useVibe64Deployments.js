import { computed, proxyRefs, ref } from "vue";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";

import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";
import {
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

const DEPLOYMENTS_API_PREFIX = "/vibe64/deployments";
const DEPLOYMENT_STATE_ENDPOINT = studioApiPath("vibe64/deployments/state");

function useVibe64Deployments({
  projectSlug = ""
} = {}) {
  const route = useRoute();
  const slug = computed(() => normalizeText(projectSlug) || firstRouteParam(route.params.slug));
  const publicNameInput = ref("");
  const publicNameError = ref("");
  const publicNameChangeInput = ref("");
  const publicNameChangeError = ref("");
  const publicNameChangeOpen = ref(false);
  const customDomainInput = ref("");

  const stateResource = useEndpointResource({
    enabled: computed(() => Boolean(slug.value)),
    fallbackLoadError: "Deployment state could not load.",
    path: DEPLOYMENT_STATE_ENDPOINT,
    queryKey: computed(() => [
      "vibe64",
      ...vibe64ProjectQueryScope(slug.value),
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      "deployments",
      "state"
    ]),
    refreshOnPull: true,
    requestRecoveryLabel: "Deployments"
  });

  const reservePublicNameCommand = deploymentCommand({
    apiSuffix: `${DEPLOYMENTS_API_PREFIX}/public-name/reserve`,
    fallbackRunError: "Public URL could not be reserved.",
    messages: {
      error: "Public URL could not be reserved.",
      success: "Public URL reserved."
    },
    payload: (context) => ({
      publicName: context.publicName
    })
  });

  const changePublicNameCommand = deploymentCommand({
    apiSuffix: `${DEPLOYMENTS_API_PREFIX}/public-name/change`,
    fallbackRunError: "Public URL could not be changed.",
    messages: {
      error: "Public URL could not be changed.",
      success: "Public URL changed."
    },
    payload: (context) => ({
      publicName: context.publicName
    })
  });

  const publishCommand = deploymentCommand({
    apiSuffix: `${DEPLOYMENTS_API_PREFIX}/publish`,
    fallbackRunError: "Project could not be published.",
    messages: {
      error: "Project could not be published.",
      success: "Project published."
    },
    payload: (context) => ({
      publicName: context.publicName
    })
  });

  const addCustomDomainCommand = deploymentCommand({
    apiSuffix: `${DEPLOYMENTS_API_PREFIX}/domains`,
    fallbackRunError: "Custom domain could not be added.",
    messages: {
      error: "Custom domain could not be added.",
      success: "Custom domain added."
    },
    payload: (context) => ({
      hostname: context.hostname
    })
  });

  const verifyCustomDomainCommand = deploymentCommand({
    apiSuffix: `${DEPLOYMENTS_API_PREFIX}/domains/verify`,
    fallbackRunError: "Custom domain could not be verified.",
    messages: {
      error: "Custom domain could not be verified.",
      success: "Custom domain verified."
    },
    payload: (context) => ({
      hostname: context.hostname
    })
  });

  const rollbackReleaseCommand = deploymentCommand({
    apiSuffix: `${DEPLOYMENTS_API_PREFIX}/releases/rollback`,
    fallbackRunError: "Release could not be restored.",
    messages: {
      error: "Release could not be restored.",
      success: "Release restored."
    },
    payload: (context) => ({
      releaseId: context.releaseId
    })
  });

  const state = computed(() => stateResource.data.value || {});
  const loadError = computed(() => vibe64ResourceResponseError(state.value, "Deployment state could not load.") || stateResource.loadError.value);
  const publicName = computed(() => state.value?.publicName || null);
  const publicUrl = computed(() => normalizeText(state.value?.publicUrl));
  const currentRelease = computed(() => state.value?.currentRelease || null);
  const releases = computed(() => Array.isArray(state.value?.releases) ? state.value.releases : []);
  const domains = computed(() => Array.isArray(state.value?.domains) ? state.value.domains : []);
  const publicNameConfigured = computed(() => Boolean(publicName.value?.publicName));
  const commandBusy = computed(() => reservePublicNameCommand.isRunning.value ||
    changePublicNameCommand.isRunning.value ||
    publishCommand.isRunning.value ||
    addCustomDomainCommand.isRunning.value ||
    verifyCustomDomainCommand.isRunning.value ||
    rollbackReleaseCommand.isRunning.value);

  return proxyRefs({
    addCustomDomain,
    addCustomDomainCommand,
    beginPublicNameChange,
    cancelPublicNameChange,
    changePublicName,
    changePublicNameCommand,
    commandBusy,
    currentRelease,
    customDomainInput,
    domains,
    isInitialLoading: stateResource.isInitialLoading,
    isLoading: stateResource.isLoading,
    loadError,
    publicName,
    publicNameChangeInput,
    publicNameChangeError,
    publicNameChangeOpen,
    publicNameError,
    publicNameConfigured,
    publicNameInput,
    publicUrl,
    publish,
    publishCommand,
    releases,
    reservePublicName,
    reservePublicNameCommand,
    rollbackRelease,
    rollbackReleaseCommand,
    state,
    stateResource,
    verifyCustomDomain,
    verifyCustomDomainCommand
  });

  async function reservePublicName() {
    const publicNameValue = normalizeText(publicNameInput.value);
    publicNameError.value = "";
    const result = await reservePublicNameCommand.run({
      publicName: publicNameValue
    });
    if (deploymentSucceeded(result)) {
      publicNameInput.value = "";
      await stateResource.reload();
    } else {
      publicNameError.value = deploymentResponseMessage(result, "That public name is not available.");
    }
    return result;
  }

  function beginPublicNameChange() {
    publicNameChangeInput.value = normalizeText(publicName.value?.publicName);
    publicNameChangeOpen.value = true;
  }

  function cancelPublicNameChange() {
    publicNameChangeInput.value = "";
    publicNameChangeError.value = "";
    publicNameChangeOpen.value = false;
  }

  async function changePublicName() {
    const publicNameValue = normalizeText(publicNameChangeInput.value);
    publicNameChangeError.value = "";
    const result = await changePublicNameCommand.run({
      publicName: publicNameValue
    });
    if (deploymentSucceeded(result)) {
      cancelPublicNameChange();
      await stateResource.reload();
    } else {
      publicNameChangeError.value = deploymentResponseMessage(result, "That public name is not available.");
    }
    return result;
  }

  async function publish() {
    const result = await publishCommand.run({
      publicName: publicNameInput.value
    });
    if (deploymentSucceeded(result)) {
      publicNameInput.value = "";
      await stateResource.reload();
    }
    return result;
  }

  async function addCustomDomain() {
    const hostname = normalizeText(customDomainInput.value);
    const result = await addCustomDomainCommand.run({
      hostname
    });
    if (deploymentSucceeded(result)) {
      customDomainInput.value = "";
      await stateResource.reload();
    }
    return result;
  }

  async function rollbackRelease(releaseId = "") {
    const result = await rollbackReleaseCommand.run({
      releaseId
    });
    if (deploymentSucceeded(result)) {
      await stateResource.reload();
    }
    return result;
  }

  async function verifyCustomDomain(hostname = "") {
    const result = await verifyCustomDomainCommand.run({
      hostname: normalizeText(hostname)
    });
    if (deploymentSucceeded(result)) {
      await stateResource.reload();
    }
    return result;
  }
}

function deploymentSucceeded(response = null) {
  return response && typeof response === "object" && response.ok !== false;
}

function deploymentResponseMessage(response = null, fallback = "") {
  if (response && typeof response === "object") {
    return normalizeText(response.message) ||
      normalizeText(response.errors?.[0]?.message) ||
      normalizeText(response.error?.message) ||
      fallback;
  }
  return fallback;
}

function deploymentCommand({
  apiSuffix = "",
  fallbackRunError = "",
  messages = {},
  payload = () => ({})
} = {}) {
  return useCommand({
    access: "never",
    apiSuffix,
    buildRawPayload: (_model, { context }) => payload(context || {}),
    fallbackRunError,
    messages,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.deployments",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
}

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return normalizeText(rawValue);
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

export {
  useVibe64Deployments
};
