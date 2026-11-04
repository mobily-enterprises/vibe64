import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRuntimeConfigDotenvDownload } from "@/composables/useRuntimeConfigDotenvDownload.js";
import { useRuntimeConfigSecretReveal } from "@/composables/useRuntimeConfigSecretReveal.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  ENV_DOWNLOAD_ENDPOINT,
  ENV_ENDPOINT,
  ENV_SECRET_REVEAL_ENDPOINT,
  ENV_USER_VALUES_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_ENV_DOWNLOAD_API_SUFFIX,
  VIBE64_ENV_SECRET_REVEAL_API_SUFFIX,
  VIBE64_ENV_USER_VALUES_API_SUFFIX,
  envQueryKey
} from "@/lib/studioGateApi.js";

const PROJECT_ENVIRONMENT = "dev";
const PROJECT_ENVIRONMENT_LABEL = "development";

/** @param {{ editable?: boolean }} record */
function recordEditable(record = {}) {
  return record.editable === true;
}

/** @param {{ valuePresent?: boolean, missing?: boolean, requiredFor?: unknown }} record */
function recordMissing(record = {}) {
  return record.valuePresent !== true &&
    (record.missing === true || (Array.isArray(record.requiredFor) && record.requiredFor.length > 0));
}

/**
 * A project's development Env as the Env panel shows it: its records, the writes that change them, revealed secrets
 * and the owner's .env download, for the selected session or the project's baseline.
 * @param {{
 *   projectSlug: import("vue").Ref<string>,
 *   selectedSessionId: import("vue").Ref<string>
 * }} options
 */
function useVibe64ProjectEnv({ projectSlug, selectedSessionId }) {
  const envResource = useEndpointResource({
    fallbackLoadError: "Env could not load.",
    path: ENV_ENDPOINT,
    queryKey: computed(() => [
      ...envQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value),
      PROJECT_ENVIRONMENT,
      selectedSessionId.value || "baseline"
    ]),
    readQuery: computed(() => ({
      environment: PROJECT_ENVIRONMENT,
      ...(selectedSessionId.value ? { sessionId: selectedSessionId.value } : {})
    })),
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Env"
  });

  const saveCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ENV_USER_VALUES_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "PUT",
      path: ENV_USER_VALUES_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      environment: PROJECT_ENVIRONMENT,
      ...(selectedSessionId.value ? { sessionId: selectedSessionId.value } : {}),
      values: context.values || {}
    }),
    fallbackRunError: "Env value could not be saved.",
    messages: {
      error: "Env value could not be saved.",
      success: "Env saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.env.user-values.save",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });

  const revealCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ENV_SECRET_REVEAL_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "POST",
      path: ENV_SECRET_REVEAL_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      environment: PROJECT_ENVIRONMENT,
      key: context.key,
      ...(selectedSessionId.value ? { sessionId: selectedSessionId.value } : {})
    }),
    fallbackRunError: "Env secret could not be revealed.",
    messages: {
      error: "Env secret could not be revealed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.env.secret.reveal",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const {
    clearRevealedSecrets,
    hideSecret,
    revealedSecrets,
    revealSecret,
    secretRevealBusyKey
  } = useRuntimeConfigSecretReveal({
    async revealValue(key) {
      const response = await revealCommand.run({ key });
      return response?.ok === false ? null : response?.value;
    }
  });

  // The owner's .env download carries every value, so it uses the same
  // uncached, owner-only transport as reveal and never reaches Colleague.
  const downloadCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ENV_DOWNLOAD_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "POST",
      path: ENV_DOWNLOAD_ENDPOINT
    }),
    buildRawPayload: () => ({
      environment: PROJECT_ENVIRONMENT,
      ...(selectedSessionId.value ? { sessionId: selectedSessionId.value } : {})
    }),
    fallbackRunError: "Env could not be downloaded.",
    messages: {
      error: "Env could not be downloaded."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.env.download",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const {
    downloadBusy,
    downloadDotenv,
    downloadError
  } = useRuntimeConfigDotenvDownload({
    fileName: () => `${projectSlug.value}-${PROJECT_ENVIRONMENT_LABEL}.env`,
    async readContent() {
      return (await downloadCommand.run())?.content;
    }
  });

  watch([projectSlug, selectedSessionId], () => {
    clearRevealedSecrets();
    downloadError.value = "";
  });

  const env = computed(() => envResource.data.value?.env || {});
  const envConfigSourceLabel = computed(() => String(env.value?.configSource?.label || ""));
  // Only the first load replaces the list: a refresh after a save swaps in the
  // new data quietly, keeping drafts, scroll, focus and revealed values.
  const envInitialLoading = computed(() => envResource.isInitialLoading.value === true);
  const refreshBusy = ref(false);
  const envLoadError = computed(() => String(envResource.loadError.value || ""));
  const envUnavailable = computed(() => Boolean(env.value?.unavailable));
  const envUnavailableMessage = computed(() => String(
    env.value?.unavailable?.message ||
    "Project Env is unavailable. Fix the project configuration and try again."
  ));
  const saveBusy = computed(() => saveCommand.isRunning === true);
  const records = computed(() => Array.isArray(env.value?.records) ? env.value.records : []);
  const missingRecords = computed(() => records.value.filter(recordMissing));
  const expectedMissingRecords = computed(() => missingRecords.value.filter(recordEditable));

  async function refresh() {
    refreshBusy.value = true;
    try {
      await reloadEnv();
    } finally {
      refreshBusy.value = false;
    }
  }

  async function reloadEnv() {
    clearRevealedSecrets();
    await envResource.reload();
  }

  // One write to the project's Env file. Only the changed values' revealed
  // secrets are hidden; a failure throws to the row or form that asked for it.
  // A row save returns once written and shows its value while the list refreshes
  // quietly; adding and removing wait for the refreshed list, which alone knows
  // the new row or the default a removal reveals.
  async function saveValues(values = {}, { waitForRefresh = true } = {}) {
    for (const key of Object.keys(values)) {
      hideSecret(key);
    }
    await saveCommand.run({
      values
    });
    const refreshed = envResource.reload();
    if (waitForRefresh) {
      await refreshed;
    }
  }

  return {
    downloadBusy,
    downloadDotenv,
    downloadError,
    envConfigSourceLabel,
    envInitialLoading,
    envLoadError,
    envUnavailable,
    envUnavailableMessage,
    expectedMissingRecords,
    hideSecret,
    missingRecords,
    records,
    refresh,
    refreshBusy,
    reloadEnv,
    revealedSecrets,
    revealSecret,
    saveBusy,
    saveValues,
    secretRevealBusyKey
  };
}

export {
  PROJECT_ENVIRONMENT_LABEL,
  recordEditable,
  useVibe64ProjectEnv
};
