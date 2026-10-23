<template>
  <v-table class="runtime-config-records-table" density="compact">
    <colgroup>
      <col class="runtime-config-records-table__key-column">
      <col class="runtime-config-records-table__value-column">
      <col
        v-if="showActions"
        class="runtime-config-records-table__actions-column"
      >
    </colgroup>
    <thead>
      <tr>
        <th>Key</th>
        <th>Value</th>
        <th v-if="showActions">Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="record in records" :key="recordKey(record)">
        <td>
          <button
            class="runtime-config-records-table__key"
            type="button"
            @click="copyKey(record.key)"
          >
            {{ record.key }}
          </button>
        </td>
        <td>
          <div
            v-if="savedRecord(record)"
            class="runtime-config-records-table__linked"
            :title="record.label"
          >
            <v-icon class="runtime-config-records-table__linked-icon" :icon="mdiLinkVariant" size="16" />
            <span class="runtime-config-records-table__linked-label">{{ record.label || "Linked" }}</span>
          </div>
          <div
            v-else-if="record.secret"
            class="runtime-config-records-table__secret-value"
          >
            <code>{{ recordValueLabel(record) }}</code>
            <v-btn
              v-if="secretRevealEnabled && record.valuePresent"
              :aria-label="secretVisibilityLabel(record)"
              :disabled="Boolean(secretRevealBusyKey) && secretRevealBusyKey !== record.key"
              :loading="secretRevealBusyKey === record.key"
              size="x-small"
              type="button"
              variant="text"
              @click="toggleSecretVisibility(record)"
            >
              {{ secretVisibilityAction(record) }}
            </v-btn>
          </div>
          <template v-else>
            {{ recordValueLabel(record) }}
          </template>
        </td>
        <td v-if="showActions">
          <div v-if="savedRecord(record)" class="runtime-config-records-table__saved-actions">
            <component
              :is="savedValues.component"
              v-if="savedValues"
              :environment="savedValueEnvironment(environmentLabel)"
              placement="env-row"
              :project-slug="projectSlug"
              :secret="record.secret === true"
              :variable="record.key"
              @changed="$emit('saved-value-changed')"
            />
          </div>
          <div
            v-else
            class="runtime-config-records-table__edit"
          >
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
            <span class="runtime-config-records-table__edit-actions">
              <component
                :is="savedValues.component"
                v-if="savedValues"
                :environment="savedValueEnvironment(environmentLabel)"
                :has-value="record.valuePresent === true"
                placement="env-row"
                :project-slug="projectSlug"
                :secret="record.secret === true"
                :variable="record.key"
                @changed="$emit('saved-value-changed')"
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
            </span>
          </div>
        </td>
      </tr>
    </tbody>
  </v-table>
</template>

<script setup>
import { ref } from "vue";
import { mdiLinkVariant } from "@mdi/js";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import {
  recordIsSavedEnvValue,
  savedEnvValueEnvironment as savedValueEnvironment,
  useVibe64SavedEnvValues
} from "@/lib/vibe64SavedEnvValues.js";

const emit = defineEmits([
  "hide-secret",
  "remove-record",
  "reveal-secret",
  "save-record",
  "saved-value-changed"
]);

const props = defineProps({
  environmentLabel: {
    default: "environment",
    type: String
  },
  records: {
    default: () => [],
    type: Array
  },
  revealedSecrets: {
    default: () => ({}),
    type: Object
  },
  saveBusy: {
    default: false,
    type: Boolean
  },
  secretRevealBusyKey: {
    default: "",
    type: String
  },
  secretRevealEnabled: {
    default: false,
    type: Boolean
  },
  showActions: {
    default: false,
    type: Boolean
  }
});

const draftValues = ref({});
const projectSlug = useVibe64ProjectSlug();
const savedValues = useVibe64SavedEnvValues();

function savedRecord(record = {}) {
  return recordIsSavedEnvValue(record);
}

function recordKey(record = {}) {
  return `${record.scope || props.environmentLabel}:${record.key || ""}`;
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

function recordValueLabel(record = {}) {
  if (record.secret) {
    return secretIsRevealed(record)
      ? String(props.revealedSecrets[record.key] ?? "")
      : (record.valuePresent ? "********" : "");
  }
  return String(record.value ?? "");
}

function secretIsRevealed(record = {}) {
  return Boolean(record.key) && Object.hasOwn(props.revealedSecrets, record.key);
}

function secretVisibilityAction(record = {}) {
  return secretIsRevealed(record) ? "Hide" : "Reveal";
}

function secretVisibilityLabel(record = {}) {
  return `${secretVisibilityAction(record)} ${record.key || "secret"}`;
}

function toggleSecretVisibility(record = {}) {
  emit(secretIsRevealed(record) ? "hide-secret" : "reveal-secret", record);
}

function saveRecord(record = {}) {
  if (!props.showActions || !draftTouched(record)) {
    return;
  }
  const key = recordKey(record);
  const value = draftValue(record);
  const nextDraftValues = {
    ...draftValues.value
  };
  delete nextDraftValues[key];
  draftValues.value = nextDraftValues;
  emit("save-record", {
    record,
    value
  });
}

function removeRecord(record = {}) {
  if (props.showActions) {
    emit("remove-record", record);
  }
}

async function copyKey(key = "") {
  const text = String(key || "");
  if (typeof navigator !== "undefined" && navigator.clipboard && text) {
    await navigator.clipboard.writeText(text);
  }
}
</script>

<style scoped>
.runtime-config-records-table {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}

.runtime-config-records-table :deep(table) {
  min-width: 40rem;
  table-layout: fixed;
  width: 100%;
}

.runtime-config-records-table__key-column {
  width: 30%;
}

.runtime-config-records-table__value-column {
  width: 25%;
}

.runtime-config-records-table__actions-column {
  width: 45%;
}

.runtime-config-records-table th,
.runtime-config-records-table td {
  min-width: 0;
  vertical-align: middle;
}

.runtime-config-records-table__key {
  /* A tonal copy chip; without this reset the browser draws its default button. */
  appearance: none;
  background: var(--v64-primary-container, rgba(var(--v-theme-primary), 0.12));
  border: 0;
  border-radius: var(--v64-shape-sm, 8px);
  color: var(--v64-on-primary-container, rgb(var(--v-theme-primary)));
  cursor: pointer;
  padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.86rem;
  font-weight: 650;
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: left;
}

.runtime-config-records-table__key:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 22%, rgb(var(--v-theme-surface)));
}

.runtime-config-records-table__key:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.runtime-config-records-table__secret-value {
  align-items: center;
  display: grid;
  gap: 0.25rem;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
}

.runtime-config-records-table__secret-value code {
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
}

/* Wraps within its cell, so the actions never spill past a narrow pane. */
.runtime-config-records-table__edit {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
  padding-block: 4px;
}

.runtime-config-records-table__edit > .v-input {
  flex: 1 1 7rem;
}

/* A linked value reads as one quiet line: where the value comes from. */
.runtime-config-records-table__linked {
  align-items: center;
  background: var(--v64-surface-container, rgba(var(--v-theme-on-surface), 0.05));
  border-radius: var(--v64-shape-sm, 8px);
  color: var(--v64-on-surface-variant, rgba(0, 0, 0, 0.62));
  display: inline-flex;
  gap: 6px;
  margin-block: 6px;
  max-width: 100%;
  min-width: 0;
  padding: 4px 10px 4px 8px;
}

.runtime-config-records-table__linked-icon {
  color: var(--v64-primary, rgb(var(--v-theme-primary)));
  flex: 0 0 auto;
}

.runtime-config-records-table__linked-label {
  -webkit-box-orient: vertical;
  display: -webkit-box;
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  -webkit-line-clamp: 2;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.runtime-config-records-table__edit-actions {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.25rem;
  margin-inline-start: auto;
}

.runtime-config-records-table__saved-actions {
  align-items: center;
  display: flex;
  justify-content: flex-end;
  min-height: 40px;
  min-width: 0;
}

.runtime-config-records-table__edit :deep(.v-field) {
  min-width: 0;
}

@media (max-width: 900px) {
  .runtime-config-records-table__edit > .v-input {
    flex-basis: 100%;
  }
}

/* On a phone each variable becomes a small card: key, value, then actions. */
@media (max-width: 600px) {
  .runtime-config-records-table :deep(table),
  .runtime-config-records-table :deep(tbody) {
    display: block;
  }

  .runtime-config-records-table :deep(colgroup),
  .runtime-config-records-table :deep(thead) {
    display: none;
  }

  .runtime-config-records-table :deep(tbody > tr) {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
  }

  .runtime-config-records-table :deep(tbody > tr + tr) {
    border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  }

  .runtime-config-records-table :deep(tbody > tr > td) {
    border: 0 !important;
    height: auto !important;
    padding: 0 !important;
  }
}
</style>
