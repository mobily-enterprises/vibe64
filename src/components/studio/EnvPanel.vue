<template>
  <section class="env-panel">
    <header class="env-panel__header">
      <h1>Env</h1>
      <div class="env-panel__actions">
        <template v-if="projectEnvTabActive">
          <v-btn
            :loading="envLoading"
            size="small"
            type="button"
            variant="tonal"
            @click="refresh"
          >
            Refresh
          </v-btn>
          <v-btn
            :disabled="envUnavailable"
            :loading="materializeBusy"
            color="primary"
            size="small"
            type="button"
            variant="flat"
            @click="materialize"
          >
            Regenerate
          </v-btn>
        </template>
        <slot
          name="tab-actions"
          :active-tab="activeTab"
        />
      </div>
    </header>

    <v-tabs
      v-model="activeTab"
      class="env-panel__tabs"
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
        v-if="!envUnavailable && missingRecords.length"
        class="env-panel__alert"
        type="warning"
        variant="tonal"
        density="compact"
      >
        Missing {{ environmentLabel }} value(s): {{ missingRecords.map((record) => record.key).join(", ") }}
      </v-alert>

      <section class="env-panel__summary">
        <div>
          <span>Adapter</span>
          <strong>{{ env.adapterId || "none" }}</strong>
        </div>
        <div>
          <span>Generated targets</span>
          <strong>{{ generatedTargetsLabel }}</strong>
        </div>
        <div>
          <span>Records</span>
          <strong>{{ records.length }}</strong>
        </div>
        <div>
          <span>Last generated</span>
          <strong>{{ lastGeneratedLabel }}</strong>
        </div>
        <div>
          <span>Session sources</span>
          <strong>{{ worktreeSyncLabel }}</strong>
        </div>
      </section>

      <section v-if="!envUnavailable" class="env-panel__sync">
        <div class="env-panel__section-heading">
          <h2>Generated files</h2>
          <v-chip
            :color="syncStatusColor"
            size="x-small"
            variant="tonal"
          >
            {{ syncState.synced ? "synced" : "needs sync" }}
          </v-chip>
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Root</th>
              <th>Target</th>
              <th>Status</th>
              <th>Last generated</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="root in syncRoots" :key="rootStatusKey(root)">
              <tr v-for="target in root.targets" :key="`${rootStatusKey(root)}:${target.relativePath}`">
                <td>
                  <div class="env-panel__root">
                    <strong>{{ root.label || root.rootKind }}</strong>
                    <span>{{ root.path }}</span>
                  </div>
                </td>
                <td>{{ target.relativePath }}</td>
                <td>
                  <v-chip
                    :color="targetStatusColor(target.status)"
                    size="x-small"
                    variant="tonal"
                  >
                    {{ target.status }}
                  </v-chip>
                </td>
                <td>{{ generatedAtLabel(target.generatedAt) }}</td>
              </tr>
            </template>
            <tr v-if="syncRowsEmpty">
              <td colspan="4">No generated file targets for {{ environmentLabel }}.</td>
            </tr>
          </tbody>
        </v-table>
      </section>

      <section v-if="!envUnavailable && expectedMissingRecords.length" class="env-panel__expected">
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

      <section v-if="!envUnavailable" class="env-panel__add">
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
          :disabled="newValueKeyPublic"
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
          Add
        </v-btn>
      </section>

      <RuntimeConfigRecordsView
        v-if="!envUnavailable"
        editable-empty-text="No user Env values."
        editable-title="User values"
        :environment-label="environmentLabel"
        :public-env-prefixes="publicEnvPrefixes"
        :records="records"
        :save-busy="saveBusy"
        system-title="System values"
        @remove-record="removeRecord"
        @save-record="saveRecord"
      />
    </template>
    <slot
      v-else
      name="tab-panel"
      :active-tab="activeTab"
    />
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import RuntimeConfigRecordsView from "@/components/studio/RuntimeConfigRecordsView.vue";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  ENV_ENDPOINT,
  ENV_MATERIALIZE_ENDPOINT,
  ENV_USER_VALUES_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_ENV_MATERIALIZE_API_SUFFIX,
  VIBE64_ENV_USER_VALUES_API_SUFFIX,
  envQueryKey
} from "@/lib/studioGateApi.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";

const projectSlug = useVibe64ProjectSlug();
const PROJECT_ENV_TAB = "dev";
const PROJECT_ENVIRONMENT = "dev";
const PROJECT_ENVIRONMENT_LABEL = "development";

const activeTab = ref(PROJECT_ENV_TAB);
const newValue = ref(emptyNewValue());

const envResource = useEndpointResource({
  fallbackLoadError: "Env could not load.",
  path: ENV_ENDPOINT,
  queryKey: computed(() => [
    ...envQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value),
    PROJECT_ENVIRONMENT
  ]),
  readQuery: computed(() => ({
    environment: PROJECT_ENVIRONMENT
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

const materializeCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_ENV_MATERIALIZE_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "POST",
    path: ENV_MATERIALIZE_ENDPOINT
  }),
  buildRawPayload: () => ({
    environment: PROJECT_ENVIRONMENT,
    syncActiveSessionSources: true
  }),
  fallbackRunError: "Env files could not be regenerated.",
  messages: {
    error: "Env files could not be regenerated.",
    success: "Env files regenerated."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.env.materialize",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "POST"
});

const env = computed(() => envResource.data.value?.env || {});
const envLoading = computed(() => envResource.isLoading.value === true);
const envLoadError = computed(() => String(envResource.loadError.value || ""));
const envUnavailable = computed(() => Boolean(env.value?.unavailable));
const envUnavailableMessage = computed(() => String(
  env.value?.unavailable?.message ||
  "Committed Vibe64 project config is unavailable. Finish setup in a source session and commit the .vibe64 config."
));
const materializeBusy = computed(() => materializeCommand.isRunning === true);
const saveBusy = computed(() => saveCommand.isRunning === true);
const projectEnvTabActive = computed(() => activeTab.value === PROJECT_ENV_TAB);
const records = computed(() => Array.isArray(env.value?.records) ? env.value.records : []);
const missingRecords = computed(() => records.value.filter(recordMissing));
const expectedMissingRecords = computed(() => missingRecords.value.filter(recordEditable));
const publicEnvPrefixes = computed(() => Array.isArray(env.value?.publicEnvPrefixes) ? env.value.publicEnvPrefixes : []);
const syncState = computed(() => env.value?.generatedFiles || {
  activeSessionSources: [],
  lastGeneratedAt: "",
  roots: [],
  synced: false
});
const syncRoots = computed(() => syncState.value.roots || []);
const syncRowsEmpty = computed(() => syncRoots.value.every((root) => !Array.isArray(root.targets) || root.targets.length === 0));
const lastGeneratedLabel = computed(() => generatedAtLabel(syncState.value.lastGeneratedAt));
const worktreeSyncLabel = computed(() => {
  const sources = syncState.value.activeSessionSources || [];
  if (!sources.length) {
    return "none";
  }
  const synced = sources.filter((source) => source.synced).length;
  return `${synced}/${sources.length} synced`;
});
const syncStatusColor = computed(() => syncState.value.synced ? "success" : "warning");
const generatedTargetsLabel = computed(() => {
  const targets = syncState.value.targets || env.value?.generatedTargets || [];
  return targets.length ? targets.join(", ") : "none";
});
const environmentLabel = PROJECT_ENVIRONMENT_LABEL;
const newValueKeyPublic = computed(() => keyIsPublic(newValue.value.key));

watch(newValueKeyPublic, (isPublic) => {
  if (isPublic && newValue.value.secret) {
    newValue.value = {
      ...newValue.value,
      secret: false
    };
  }
});

function emptyNewValue() {
  return {
    key: "",
    secret: true,
    value: ""
  };
}

function targetStatusColor(status = "") {
  if (status === "synced") {
    return "success";
  }
  if (status === "missing" || status === "stale") {
    return "warning";
  }
  return "error";
}

function generatedAtLabel(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "never";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return date.toLocaleString();
}

function rootStatusKey(root = {}) {
  return `${root.rootKind || "root"}:${root.sessionId || ""}:${root.path || ""}`;
}

function keyIsPublic(key = "") {
  const text = String(key || "").trim();
  return Boolean(text) && publicEnvPrefixes.value.some((prefix) => text.startsWith(prefix));
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
    secret: record.secret === true && !keyIsPublic(key),
    value: ""
  };
}

async function refresh() {
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

async function removeRecord(record = {}) {
  if (!recordEditable(record)) {
    return;
  }
  await saveValues({
    [record.key]: {
      remove: true
    }
  });
}

async function saveNewValue() {
  const key = String(newValue.value.key || "").trim();
  if (!key) {
    return;
  }
  await saveValues({
    [key]: {
      secret: newValue.value.secret === true && !keyIsPublic(key),
      value: newValue.value.value
    }
  });
  newValue.value = emptyNewValue();
}

async function saveValues(values = {}) {
  await saveCommand.run({
    values
  });
  await envResource.reload();
}

async function materialize() {
  await materializeCommand.run({});
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
  gap: 0.85rem;
  min-width: 0;
}

.env-panel__header {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.env-panel__header h1 {
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--generated-ui-screen-title-size, 1.35rem);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0;
}

.env-panel__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.env-panel__tabs {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}

.env-panel__alert {
  border-radius: 8px;
}

.env-panel__summary {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.env-panel__summary div,
.env-panel__expected,
.env-panel__sync {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
}

.env-panel__summary div {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
  padding: 0.75rem;
}

.env-panel__summary span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
}

.env-panel__summary strong {
  font-size: 0.94rem;
  font-weight: 650;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-panel__add {
  align-items: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(10rem, 1.1fr) minmax(12rem, 1.4fr) auto auto;
  padding: 0.75rem;
}

.env-panel__expected,
.env-panel__sync {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
  overflow: hidden;
}

.env-panel__section-heading {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  padding: 0.75rem 0.75rem 0;
}

.env-panel__section-heading--inline {
  justify-content: flex-start;
}

.env-panel__section-heading h2 {
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
}

.env-panel__root {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.env-panel__root strong {
  font-size: 0.86rem;
}

.env-panel__root span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-panel__expected-keys {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0 0.75rem 0.75rem;
}

@media (max-width: 900px) {
  .env-panel__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .env-panel__summary,
  .env-panel__add {
    grid-template-columns: 1fr;
  }
}
</style>
