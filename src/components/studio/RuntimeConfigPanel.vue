<template>
  <section class="runtime-config-panel">
    <header class="runtime-config-panel__header">
      <h1>Runtime Config</h1>
      <div class="runtime-config-panel__actions">
        <v-btn
          :loading="runtimeConfigLoading"
          size="small"
          type="button"
          variant="tonal"
          @click="refresh"
        >
          Refresh
        </v-btn>
        <v-btn
          :loading="materializeBusy"
          color="primary"
          size="small"
          type="button"
          variant="flat"
          @click="materialize"
        >
          Regenerate
        </v-btn>
      </div>
    </header>

    <v-tabs
      v-model="scope"
      class="runtime-config-panel__tabs"
      density="comfortable"
    >
      <v-tab value="dev">Dev</v-tab>
      <v-tab value="prod">Prod</v-tab>
    </v-tabs>

    <Vibe64AsyncModuleState
      v-if="runtimeConfigLoading || runtimeConfigLoadError"
      label="Runtime Config"
      :loading="runtimeConfigLoading"
      :message="runtimeConfigLoadError || 'Loading runtime config.'"
      min-height="12rem"
      @reload="reloadPage"
      @retry="refresh"
    />

    <template v-else>
      <v-alert
        v-if="missingRecords.length"
        class="runtime-config-panel__alert"
        type="warning"
        variant="tonal"
        density="compact"
      >
        Missing {{ scope }} value(s): {{ missingRecords.map((record) => record.key).join(", ") }}
      </v-alert>

      <section class="runtime-config-panel__summary">
        <div>
          <span>Adapter</span>
          <strong>{{ runtimeConfig.adapterId || "none" }}</strong>
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

      <section class="runtime-config-panel__sync">
        <div class="runtime-config-panel__section-heading">
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
                  <div class="runtime-config-panel__root">
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
              <td colspan="4">No generated file targets for {{ scope }}.</td>
            </tr>
          </tbody>
        </v-table>
      </section>

      <section class="runtime-config-panel__add">
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
        <v-select
          v-model="newValue.requiredFor"
          chips
          density="compact"
          hide-details
          :items="phaseOptions"
          label="Required for"
          multiple
          variant="outlined"
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

      <v-table class="runtime-config-panel__table" density="compact">
        <thead>
          <tr>
            <th>Key</th>
            <th>Owner</th>
            <th>Source</th>
            <th>Value</th>
            <th>Required</th>
            <th>Status</th>
            <th>Edit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="recordKey(record)">
            <td>
              <button
                class="runtime-config-panel__key"
                type="button"
                @click="copyKey(record.key)"
              >
                {{ record.key }}
              </button>
            </td>
            <td>
              <v-chip
                class="runtime-config-panel__chip"
                :color="ownerColor(record.owner)"
                size="x-small"
                variant="tonal"
              >
                {{ record.owner }}
              </v-chip>
            </td>
            <td>{{ record.source || "runtime" }}</td>
            <td>
              <span v-if="record.secret">{{ record.valuePresent ? "********" : "" }}</span>
              <span v-else>{{ record.value }}</span>
            </td>
            <td>{{ phaseLabel(record.requiredFor) }}</td>
            <td>
              <v-chip
                class="runtime-config-panel__chip"
                :color="record.missing ? 'warning' : 'success'"
                size="x-small"
                variant="tonal"
              >
                {{ record.missing ? "missing" : "present" }}
              </v-chip>
            </td>
            <td>
              <div v-if="record.editable" class="runtime-config-panel__edit">
                <v-text-field
                  :model-value="draftValue(record)"
                  :type="record.secret ? 'password' : 'text'"
                  density="compact"
                  hide-details
                  label="New value"
                  spellcheck="false"
                  variant="outlined"
                  @update:model-value="setDraftValue(record, $event)"
                />
                <v-btn
                  :disabled="!draftTouched(record)"
                  :loading="saveBusy"
                  size="small"
                  type="button"
                  variant="tonal"
                  @click="saveRecord(record)"
                >
                  Save
                </v-btn>
                <v-btn
                  :loading="saveBusy"
                  size="small"
                  type="button"
                  variant="text"
                  @click="removeRecord(record)"
                >
                  Remove
                </v-btn>
              </div>
              <span v-else class="runtime-config-panel__readonly">Read-only</span>
            </td>
          </tr>
          <tr v-if="records.length === 0">
            <td colspan="7">No runtime config records for {{ scope }}.</td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  RUNTIME_CONFIG_ENDPOINT,
  RUNTIME_CONFIG_MATERIALIZE_ENDPOINT,
  RUNTIME_CONFIG_USER_VALUES_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_RUNTIME_CONFIG_MATERIALIZE_API_SUFFIX,
  VIBE64_RUNTIME_CONFIG_USER_VALUES_API_SUFFIX,
  runtimeConfigQueryKey
} from "@/lib/studioGateApi.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";

const phaseOptions = Object.freeze([
  "install",
  "generate",
  "migrate",
  "seed",
  "server",
  "client-build",
  "preview",
  "deploy"
]);

const projectSlug = useVibe64ProjectSlug();
const scope = ref("dev");
const draftValues = ref({});
const newValue = ref(emptyNewValue());

const runtimeConfigResource = useEndpointResource({
  fallbackLoadError: "Runtime config could not load.",
  path: RUNTIME_CONFIG_ENDPOINT,
  queryKey: computed(() => [
    ...runtimeConfigQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value),
    scope.value
  ]),
  readQuery: computed(() => ({
    scope: scope.value
  })),
  realtime: {
    event: VIBE64_PROJECT_CHANGED_EVENT
  },
  refreshOnPull: true,
  requestRecoveryLabel: "Runtime config"
});

const saveCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_RUNTIME_CONFIG_USER_VALUES_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    path: RUNTIME_CONFIG_USER_VALUES_ENDPOINT
  }),
  buildRawPayload: (_model, { context }) => ({
    scope: scope.value,
    values: context.values || {}
  }),
  fallbackRunError: "Runtime config value could not be saved.",
  messages: {
    error: "Runtime config value could not be saved.",
    success: "Runtime config saved."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.runtime-config.user-values.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const materializeCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_RUNTIME_CONFIG_MATERIALIZE_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "POST",
    path: RUNTIME_CONFIG_MATERIALIZE_ENDPOINT
  }),
  buildRawPayload: () => ({
    scope: scope.value,
    syncActiveSessionSources: true
  }),
  fallbackRunError: "Runtime config files could not be regenerated.",
  messages: {
    error: "Runtime config files could not be regenerated.",
    success: "Runtime config files regenerated."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.runtime-config.materialize",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "POST"
});

const runtimeConfig = computed(() => runtimeConfigResource.data.value?.runtimeConfig || {});
const runtimeConfigLoading = computed(() => runtimeConfigResource.isLoading.value === true);
const runtimeConfigLoadError = computed(() => String(runtimeConfigResource.loadError.value || ""));
const materializeBusy = computed(() => materializeCommand.isRunning === true);
const saveBusy = computed(() => saveCommand.isRunning === true);
const records = computed(() => runtimeConfig.value?.view?.records || []);
const missingRecords = computed(() => records.value.filter((record) => record.missing));
const syncState = computed(() => runtimeConfig.value?.sync || {
  activeSessionSources: [],
  lastGeneratedAt: "",
  roots: [],
  synced: false
});
const syncRoots = computed(() => syncState.value.roots || []);
const syncRowsEmpty = computed(() => syncRoots.value.every((root) => !Array.isArray(root.targets) || root.targets.length === 0));
const lastGeneratedLabel = computed(() => generatedAtLabel(runtimeConfig.value?.lastGeneratedAt || syncState.value.lastGeneratedAt));
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
  const targets = runtimeConfig.value?.generatedTargets || runtimeConfig.value?.view?.generatedTargets || [];
  return targets.length ? targets.join(", ") : "none";
});

watch(scope, () => {
  draftValues.value = {};
  newValue.value = emptyNewValue();
});

function emptyNewValue() {
  return {
    key: "",
    materialize: true,
    requiredFor: [],
    secret: true,
    value: ""
  };
}

function recordKey(record = {}) {
  return `${record.scope || scope.value}:${record.key || ""}`;
}

function draftTouched(record = {}) {
  return Object.hasOwn(draftValues.value, recordKey(record));
}

function draftValue(record = {}) {
  return draftTouched(record)
    ? draftValues.value[recordKey(record)]
    : "";
}

function setDraftValue(record = {}, value = "") {
  draftValues.value = {
    ...draftValues.value,
    [recordKey(record)]: String(value ?? "")
  };
}

function phaseLabel(phases = []) {
  return Array.isArray(phases) && phases.length ? phases.join(", ") : "-";
}

function ownerColor(owner = "") {
  if (owner === "user") {
    return "primary";
  }
  if (owner === "adapter") {
    return "secondary";
  }
  return "info";
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

async function refresh() {
  await runtimeConfigResource.reload();
}

async function saveRecord(record = {}) {
  if (!record.editable || !draftTouched(record)) {
    return;
  }
  await saveValues({
    [record.key]: {
      materialize: record.materialize !== false,
      requiredFor: record.requiredFor || [],
      secret: record.secret === true,
      value: draftValue(record)
    }
  });
  const key = recordKey(record);
  const nextDraftValues = {
    ...draftValues.value
  };
  delete nextDraftValues[key];
  draftValues.value = nextDraftValues;
}

async function removeRecord(record = {}) {
  if (!record.editable) {
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
      materialize: newValue.value.materialize !== false,
      requiredFor: newValue.value.requiredFor || [],
      secret: newValue.value.secret === true,
      value: newValue.value.value
    }
  });
  newValue.value = emptyNewValue();
}

async function saveValues(values = {}) {
  await saveCommand.run({
    values
  });
  await runtimeConfigResource.reload();
}

async function materialize() {
  await materializeCommand.run({});
  await runtimeConfigResource.reload();
}

async function copyKey(key = "") {
  const text = String(key || "");
  if (typeof navigator !== "undefined" && navigator.clipboard && text) {
    await navigator.clipboard.writeText(text);
  }
}

function reloadPage() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
</script>

<style scoped>
.runtime-config-panel {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.runtime-config-panel__header {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.runtime-config-panel__header h1 {
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--generated-ui-screen-title-size, 1.35rem);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0;
}

.runtime-config-panel__actions,
.runtime-config-panel__edit {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.runtime-config-panel__tabs {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}

.runtime-config-panel__alert {
  border-radius: 8px;
}

.runtime-config-panel__summary {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.runtime-config-panel__summary div,
.runtime-config-panel__sync {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
}

.runtime-config-panel__summary div {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
  padding: 0.75rem;
}

.runtime-config-panel__summary span,
.runtime-config-panel__readonly {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
}

.runtime-config-panel__summary strong {
  font-size: 0.94rem;
  font-weight: 650;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-config-panel__add {
  align-items: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(10rem, 1.1fr) minmax(12rem, 1.4fr) auto minmax(12rem, 1fr) auto;
  padding: 0.75rem;
}

.runtime-config-panel__sync {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
  overflow: hidden;
}

.runtime-config-panel__section-heading {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  padding: 0.75rem 0.75rem 0;
}

.runtime-config-panel__section-heading h2 {
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
}

.runtime-config-panel__root {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.runtime-config-panel__root strong {
  font-size: 0.86rem;
}

.runtime-config-panel__root span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-config-panel__table {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  overflow: hidden;
}

.runtime-config-panel__table th,
.runtime-config-panel__table td {
  vertical-align: middle;
}

.runtime-config-panel__key {
  color: rgb(var(--v-theme-primary));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.86rem;
  font-weight: 650;
}

.runtime-config-panel__chip {
  text-transform: none;
}

.runtime-config-panel__edit {
  min-width: 20rem;
}

.runtime-config-panel__edit :deep(.v-field) {
  min-width: 12rem;
}

@media (max-width: 900px) {
  .runtime-config-panel__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .runtime-config-panel__summary,
  .runtime-config-panel__add {
    grid-template-columns: 1fr;
  }
}
</style>
