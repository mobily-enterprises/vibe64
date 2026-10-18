<template>
  <section class="env-panel">
    <Vibe64DashboardPageHeader
      description="Values supplied to this project's development processes."
      :icon="mdiFileCogOutline"
      title="Env"
    >
      <template #meta>
        <v-chip
          v-if="envConfigSourceLabel"
          class="env-panel__source"
          label
          size="small"
          variant="tonal"
        >
          {{ envConfigSourceLabel }}
        </v-chip>
      </template>
      <template #actions>
        <template v-if="projectEnvTabActive">
          <v-btn
            :loading="envLoading"
            :prepend-icon="mdiRefresh"
            rounded="pill"
            type="button"
            variant="tonal"
            @click="refresh"
          >
            Refresh
          </v-btn>
        </template>
        <slot
          name="tab-actions"
          :active-tab="activeTab"
        />
      </template>
    </Vibe64DashboardPageHeader>

    <v-tabs
      v-model="activeTab"
      class="env-panel__tabs"
      color="primary"
      density="comfortable"
    >
      <v-tab :value="PROJECT_ENV_TAB">Development</v-tab>
      <slot name="tabs" />
    </v-tabs>

    <Vibe64AsyncModuleState
      v-if="projectEnvTabActive && (envLoading || envLoadError)"
      label="Env"
      :loading="envLoading"
      :message="envLoadError || 'Loading Env.'"
      min-height="12rem"
      @reload="reloadPage"
      @retry="refresh"
    />

    <template v-else-if="projectEnvTabActive">
      <v-alert
        v-if="envUnavailable"
        class="env-panel__alert"
        type="info"
        variant="tonal"
        density="compact"
      >
        {{ envUnavailableMessage }}
      </v-alert>

      <v-alert
        v-if="missingRecords.length"
        class="env-panel__alert"
        type="warning"
        variant="tonal"
        density="compact"
      >
        Missing {{ environmentLabel }} value(s): {{ missingRecords.map((record) => record.key).join(", ") }}
      </v-alert>

      <section v-if="expectedMissingRecords.length" class="env-panel__expected">
        <div class="env-panel__section-heading env-panel__section-heading--inline">
          <h2>Expected user values</h2>
          <v-chip size="x-small" variant="tonal">
            {{ expectedMissingRecords.length }}
          </v-chip>
        </div>
        <div class="env-panel__expected-keys">
          <v-btn
            v-for="record in expectedMissingRecords"
            :key="`expected:${record.key}`"
            size="small"
            type="button"
            variant="tonal"
            @click="selectExpectedRecord(record)"
          >
            {{ record.key }}
          </v-btn>
        </div>
      </section>

      <v-alert v-if="existingNewValue" type="info" variant="tonal">
        {{ newValue.key }} already has a value. Saving replaces this value in development; other Env values stay unchanged.
      </v-alert>
      <section class="env-panel__add">
        <v-text-field
          v-model="newValue.key"
          density="compact"
          hide-details
          label="Key"
          spellcheck="false"
          variant="outlined"
        />
        <v-text-field
          v-model="newValue.value"
          :type="newValue.secret ? 'password' : 'text'"
          density="compact"
          hide-details
          label="Value"
          spellcheck="false"
          variant="outlined"
        />
        <v-checkbox
          v-model="newValue.secret"
          density="compact"
          hide-details
          label="Secret"
        />
        <v-btn
          :disabled="!newValue.key"
          :loading="saveBusy"
          color="primary"
          type="button"
          variant="flat"
          @click="saveNewValue"
        >
          {{ existingNewValue ? 'Replace value' : 'Add' }}
        </v-btn>
      </section>

      <RuntimeConfigRecordsView
        editable-empty-text="No user Env values."
        editable-title="User values"
        :environment-label="environmentLabel"
        :records="records"
        :revealed-secrets="revealedSecrets"
        :save-busy="saveBusy"
        :secret-reveal-busy-key="secretRevealBusyKey"
        :secret-reveal-enabled="!lessonDashboard"
        system-title="System values"
        @hide-secret="hideSecret"
        @remove-record="requestRemoveRecord"
        @reveal-secret="revealSecret"
        @save-record="saveRecord"
      />
    </template>
    <slot
      v-else
      name="tab-panel"
      :active-tab="activeTab"
    />

    <v-dialog
      v-model="removeConfirmOpen"
      max-width="30rem"
    >
      <v-card>
        <v-card-title>Remove Env value?</v-card-title>
        <v-card-text>
          <code>{{ pendingRemovalKey }}</code> will no longer be supplied to this
          project's development processes.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            :disabled="saveBusy"
            type="button"
            variant="text"
            @click="cancelRemoveRecord"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            :loading="saveBusy"
            type="button"
            variant="flat"
            @click="confirmRemoveRecord"
          >
            Remove
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiFileCogOutline, mdiRefresh } from "@mdi/js";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
import RuntimeConfigRecordsView from "@/components/studio/RuntimeConfigRecordsView.vue";
import { useRuntimeConfigSecretReveal } from "@/composables/useRuntimeConfigSecretReveal.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  ENV_ENDPOINT,
  ENV_SECRET_REVEAL_ENDPOINT,
  ENV_USER_VALUES_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_ENV_SECRET_REVEAL_API_SUFFIX,
  VIBE64_ENV_USER_VALUES_API_SUFFIX,
  envQueryKey
} from "@/lib/studioGateApi.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64SessionSelection
} from "@/composables/useVibe64SessionSelection.js";
import { lessonDashboardApiPath, useVibe64LessonDashboard } from "@/lib/vibe64LessonDashboard.js";

const projectSlug = useVibe64ProjectSlug();
const sessionSelection = useVibe64SessionSelection({
  projectSlug
});
// A practice lesson reads and saves its own lesson session's Env through the
// saved attempt; secret reveal stays owner-only Working access.
const lessonDashboard = useVibe64LessonDashboard();
const selectedSessionId = computed(() => lessonDashboard.value
  ? lessonDashboard.value.sessionId : sessionSelection.selectedId.value);
const envQueryProject = computed(() => lessonDashboard.value ? `lesson:${lessonDashboard.value.attemptId}` : projectSlug.value);
const PROJECT_ENV_TAB = "dev";
const PROJECT_ENVIRONMENT = "dev";
const PROJECT_ENVIRONMENT_LABEL = "development";

const activeTab = ref(PROJECT_ENV_TAB);
const newValue = ref(emptyNewValue());
const route = useRoute();
watch(() => [route.query.prefillKey, route.query.prefillValue, route.query.prefillSecret], ([key, value, secret]) => {
  if (typeof key !== "string" || !/^[A-Z_][A-Z0-9_]*$/u.test(key) || key.length > 200) return;
  if (secret === "true") {
    // A secret is entered here, never supplied in a navigation URL.
    newValue.value = { key, value: "", secret: true };
  } else if (value === undefined || (typeof value === "string" && value.length <= 4096)) {
    newValue.value = { key, value: value ?? "", secret: false };
  }
}, { immediate: true });
const pendingRemoval = ref(null);

const envResource = useEndpointResource({
  fallbackLoadError: "Env could not load.",
  path: computed(() => lessonDashboardApiPath(lessonDashboard.value, ENV_ENDPOINT)),
  queryKey: computed(() => [
    ...envQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, envQueryProject.value),
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
    path: lessonDashboardApiPath(lessonDashboard.value, ENV_USER_VALUES_ENDPOINT)
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

watch([projectSlug, selectedSessionId], clearRevealedSecrets);

const env = computed(() => envResource.data.value?.env || {});
const envConfigSourceLabel = computed(() => String(env.value?.configSource?.label || ""));
const envLoading = computed(() => envResource.isLoading.value === true);
const envLoadError = computed(() => String(envResource.loadError.value || ""));
const envUnavailable = computed(() => Boolean(env.value?.unavailable));
const envUnavailableMessage = computed(() => String(
  env.value?.unavailable?.message ||
  "Project Env is unavailable. Fix the project configuration and try again."
));
const saveBusy = computed(() => saveCommand.isRunning === true);
const removeConfirmOpen = computed({
  get: () => Boolean(pendingRemoval.value),
  set: (open) => {
    if (!open && !saveBusy.value) {
      pendingRemoval.value = null;
    }
  }
});
const pendingRemovalKey = computed(() => String(pendingRemoval.value?.key || ""));
const projectEnvTabActive = computed(() => activeTab.value === PROJECT_ENV_TAB);
const records = computed(() => Array.isArray(env.value?.records) ? env.value.records : []);
const existingNewValue = computed(() => records.value.some((record) =>
  record.key === String(newValue.value.key || "").trim() && record.valuePresent === true));
const missingRecords = computed(() => records.value.filter(recordMissing));
const expectedMissingRecords = computed(() => missingRecords.value.filter(recordEditable));
const environmentLabel = PROJECT_ENVIRONMENT_LABEL;

function emptyNewValue() {
  return {
    key: "",
    secret: true,
    value: ""
  };
}

function recordEditable(record = {}) {
  return record.editable === true;
}

function recordMissing(record = {}) {
  return record.valuePresent !== true &&
    (record.missing === true || (Array.isArray(record.requiredFor) && record.requiredFor.length > 0));
}

function selectExpectedRecord(record = {}) {
  const key = String(record.key || "").trim();
  if (!key) {
    return;
  }
  newValue.value = {
    key,
    secret: record.secret === true,
    value: ""
  };
}

async function refresh() {
  clearRevealedSecrets();
  await envResource.reload();
}

async function saveRecord({
  record = {},
  value = ""
} = {}) {
  if (!recordEditable(record)) {
    return;
  }
  await saveValues({
    [record.key]: {
      secret: record.secret === true,
      value
    }
  });
}

function requestRemoveRecord(record = {}) {
  if (!recordEditable(record)) {
    return;
  }
  pendingRemoval.value = record;
}

function cancelRemoveRecord() {
  if (!saveBusy.value) {
    pendingRemoval.value = null;
  }
}

async function confirmRemoveRecord() {
  const record = pendingRemoval.value;
  if (!recordEditable(record)) {
    pendingRemoval.value = null;
    return;
  }
  await saveValues({
    [record.key]: {
      remove: true
    }
  });
  pendingRemoval.value = null;
}

async function saveNewValue() {
  const key = String(newValue.value.key || "").trim();
  if (!key) {
    return;
  }
  await saveValues({
    [key]: {
      secret: newValue.value.secret === true,
      value: newValue.value.value
    }
  });
  newValue.value = emptyNewValue();
}

async function saveValues(values = {}) {
  clearRevealedSecrets();
  await saveCommand.run({
    values
  });
  await envResource.reload();
}

function reloadPage() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
</script>

<style scoped>
.env-panel {
  display: grid;
  gap: var(--v64-space-4, 16px);
  min-width: 0;
}

.env-panel__source {
  font-weight: 600;
}

.env-panel__tabs {
  border-bottom: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12));
}

.env-panel__tabs :deep(.v-tab) {
  letter-spacing: 0;
  text-transform: none;
}

.env-panel__alert {
  border-radius: var(--v64-shape-md, 12px);
}

/* M3 filled cards: tonal surfaces instead of hairline boxes. */
.env-panel__expected,
.env-panel__add {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12));
  border-radius: var(--v64-shape-lg, 16px);
}

.env-panel__add {
  align-items: center;
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: minmax(10rem, 1.1fr) minmax(12rem, 1.4fr) auto auto;
  padding: var(--v64-space-4, 16px);
}

.env-panel__add :deep(.v-field) {
  background: var(--v64-surface);
  border-radius: var(--v64-shape-sm, 8px);
}

.env-panel__add > .v-btn {
  border-radius: var(--v64-shape-full, 999px);
  min-height: 40px;
  padding-inline: var(--v64-space-5, 24px);
}

.env-panel__expected {
  display: grid;
  gap: var(--v64-space-2, 8px);
  min-width: 0;
  overflow: hidden;
}

.env-panel__section-heading {
  align-items: center;
  display: flex;
  gap: var(--v64-space-2, 8px);
  justify-content: space-between;
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px) 0;
}

.env-panel__section-heading--inline {
  justify-content: flex-start;
}

.env-panel__section-heading h2 {
  font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif);
  letter-spacing: 0;
  margin: 0;
}

.env-panel__expected-keys {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px);
  padding: 0 var(--v64-space-4, 16px) var(--v64-space-4, 16px);
}

@media (max-width: 900px) {
  .env-panel__add {
    grid-template-columns: 1fr;
  }
}
</style>
