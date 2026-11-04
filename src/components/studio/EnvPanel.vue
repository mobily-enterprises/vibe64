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
            :disabled="envInitialLoading"
            :loading="downloadBusy"
            :prepend-icon="mdiDownload"
            rounded="pill"
            type="button"
            variant="tonal"
            @click="downloadDotenv"
          >
            Download .env
          </v-btn>
          <v-btn
            :loading="refreshBusy"
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
      v-if="projectEnvTabActive && (envInitialLoading || envLoadError)"
      label="Env"
      :loading="envInitialLoading"
      :message="envLoadError || 'Loading Env.'"
      min-height="12rem"
      @reload="reloadPage"
      @retry="refresh"
    />

    <template v-else-if="projectEnvTabActive">
      <v-alert
        v-if="downloadError"
        class="env-panel__alert"
        closable
        density="compact"
        type="error"
        variant="tonal"
        @click:close="downloadError = ''"
      >
        {{ downloadError }}
      </v-alert>

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
          :disabled="!newValue.key || (saveBusy && !addBusy)"
          :loading="addBusy"
          color="primary"
          type="button"
          variant="flat"
          @click="saveNewValue"
        >
          {{ existingNewValue ? 'Replace value' : 'Add' }}
        </v-btn>
        <component
          :is="savedValues.component"
          v-if="savedValues"
          :environment="savedValueEnvironment(environmentLabel)"
          :has-value="existingNewValue"
          placement="env-add"
          :project-slug="projectSlug"
          :secret="newValue.secret === true"
          :variable="String(newValue.key || '').trim()"
          @changed="savedValueChanged"
        />
        <p v-if="addError" class="env-panel__add-error" role="alert">
          {{ addError }}
        </p>
      </section>

      <RuntimeConfigRecordsView
        editable-empty-text="No user Env values."
        editable-title="User values"
        :environment-label="environmentLabel"
        :records="records"
        :revealed-secrets="revealedSecrets"
        :save-busy="saveBusy"
        :secret-reveal-busy-key="secretRevealBusyKey"
        secret-reveal-enabled
        system-title="System values"
        @hide-secret="hideSecret"
        @remove-record="requestRemoveRecord"
        @reveal-secret="revealSecret"
        @save-record="saveRecord"
        @saved-value-changed="reloadEnv"
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
          <v-alert
            v-if="removeError"
            class="mt-3"
            density="compact"
            type="error"
            variant="tonal"
          >
            {{ removeError }}
          </v-alert>
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
import { mdiDownload, mdiFileCogOutline, mdiRefresh } from "@mdi/js";
import { useRoute } from "vue-router";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
import RuntimeConfigRecordsView from "@/components/studio/RuntimeConfigRecordsView.vue";
import {
  PROJECT_ENVIRONMENT_LABEL,
  recordEditable,
  useVibe64ProjectEnv
} from "@/composables/useVibe64ProjectEnv.js";
import {
  savedEnvValueEnvironment as savedValueEnvironment,
  useVibe64SavedEnvValues
} from "@/lib/vibe64SavedEnvValues.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64SessionSelection
} from "@/composables/useVibe64SessionSelection.js";
import { reloadPage } from "@/lib/browser.js";

const projectSlug = useVibe64ProjectSlug();
const sessionSelection = useVibe64SessionSelection({
  projectSlug
});
const selectedSessionId = sessionSelection.selectedId;
const PROJECT_ENV_TAB = "dev";

const activeTab = ref(PROJECT_ENV_TAB);
const savedValues = useVibe64SavedEnvValues();
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

const {
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
} = useVibe64ProjectEnv({ projectSlug, selectedSessionId });

const addBusy = ref(false);
const addError = ref("");
const removeError = ref("");
watch([projectSlug, selectedSessionId], () => {
  addError.value = "";
});
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
const existingNewValue = computed(() => records.value.some((record) =>
  record.key === String(newValue.value.key || "").trim() && record.valuePresent === true));
const environmentLabel = PROJECT_ENVIRONMENT_LABEL;

function emptyNewValue() {
  return {
    key: "",
    secret: true,
    value: ""
  };
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
  }, { waitForRefresh: false });
}

function requestRemoveRecord(record = {}) {
  if (!recordEditable(record)) {
    return;
  }
  removeError.value = "";
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
  removeError.value = "";
  try {
    await saveValues({
      [record.key]: {
        remove: true
      }
    });
    pendingRemoval.value = null;
  } catch (error) {
    removeError.value = String(error?.message || `${record.key} could not be removed.`);
  }
}

async function saveNewValue() {
  const key = String(newValue.value.key || "").trim();
  if (!key) {
    return;
  }
  addBusy.value = true;
  addError.value = "";
  try {
    await saveValues({
      [key]: {
        secret: newValue.value.secret === true,
        value: newValue.value.value
      }
    });
    newValue.value = emptyNewValue();
  } catch (error) {
    addError.value = String(error?.message || `${key} could not be saved.`);
  } finally {
    addBusy.value = false;
  }
}

async function savedValueChanged() {
  newValue.value = emptyNewValue();
  await reloadEnv();
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

/* Wraps by the pane's width, not the window's: the Dashboard pane is narrow beside the chat. */
.env-panel__add {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-4, 16px);
}

.env-panel__add > .v-text-field:nth-child(1) {
  flex: 1.1 1 10rem;
}

.env-panel__add > .v-text-field:nth-child(2) {
  flex: 1.4 1 12rem;
}

.env-panel__add > .v-checkbox {
  flex: 0 0 auto;
}

.env-panel__add :deep(.v-field) {
  background: var(--v64-surface);
  border-radius: var(--v64-shape-sm, 8px);
}

.env-panel__add-error {
  color: rgb(var(--v-theme-error));
  flex: 1 1 100%;
  font: var(--v64-type-body-sm, 400 0.75rem/1rem system-ui, sans-serif);
  margin: 0;
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
    align-items: stretch;
    flex-direction: column;
  }

  .env-panel__add > .v-text-field:nth-child(n) {
    flex: 0 0 auto;
  }
}
</style>
