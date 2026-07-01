<template>
  <v-table class="runtime-config-records-table" density="compact">
    <thead>
      <tr>
        <th>Key</th>
        <th>Value</th>
        <th>Visibility</th>
        <th>Source</th>
        <th>Status</th>
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
          {{ recordValueLabel(record) }}
        </td>
        <td>
          <v-chip
            class="runtime-config-records-table__chip"
            :color="recordVisibility(record) === 'Public' ? 'primary' : 'secondary'"
            size="x-small"
            variant="tonal"
          >
            {{ recordVisibility(record) }}
          </v-chip>
        </td>
        <td>{{ sourceLabel(record.source) }}</td>
        <td>
          <v-chip
            class="runtime-config-records-table__chip"
            :color="recordStatusColor(record)"
            size="x-small"
            variant="tonal"
          >
            {{ recordStatus(record) }}
          </v-chip>
        </td>
        <td v-if="showActions">
          <div class="runtime-config-records-table__edit">
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
        </td>
      </tr>
    </tbody>
  </v-table>
</template>

<script setup>
import { computed, ref } from "vue";

const emit = defineEmits([
  "remove-record",
  "save-record"
]);

const props = defineProps({
  environmentLabel: {
    default: "environment",
    type: String
  },
  publicEnvPrefixes: {
    default: () => [],
    type: Array
  },
  records: {
    default: () => [],
    type: Array
  },
  saveBusy: {
    default: false,
    type: Boolean
  },
  showActions: {
    default: false,
    type: Boolean
  }
});

const draftValues = ref({});
const publicEnvPrefixes = computed(() => Array.isArray(props.publicEnvPrefixes) ? props.publicEnvPrefixes : []);

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

function keyIsPublic(key = "") {
  const text = String(key || "").trim();
  return Boolean(text) && publicEnvPrefixes.value.some((prefix) => text.startsWith(prefix));
}

function recordVisibility(record = {}) {
  return keyIsPublic(record.key) ? "Public" : "Server";
}

function sourceLabel(source = "") {
  return {
    adapter: "Adapter",
    "app-auth": "App Auth",
    "assistant_contract": "Assistant",
    "jskit-local-default": "Adapter Default",
    "jskit-managed-mariadb": "Managed Database",
    managed_app_auth: "Managed Auth",
    managed_database: "Managed Database",
    "managed-app-auth": "Managed Auth",
    manual_app_auth: "Manual Auth",
    "project-config": "Project Config",
    system: "System",
    user: "User",
    user_override: "User",
    vibe64_deployment: "Vibe64",
    vibe64: "Vibe64"
  }[source] || source || "Generated";
}

function recordValueLabel(record = {}) {
  if (record.secret) {
    return record.valuePresent ? "********" : "";
  }
  return String(record.value ?? "");
}

function recordStatus(record = {}) {
  if (record.valuePresent === true) {
    return "Present";
  }
  return recordMissing(record) ? "Missing" : "Empty";
}

function recordStatusColor(record = {}) {
  const status = recordStatus(record);
  if (status === "Present") {
    return "success";
  }
  if (status === "Missing") {
    return "warning";
  }
  return "default";
}

function recordMissing(record = {}) {
  return record.missing === true || (Array.isArray(record.requiredFor) && record.requiredFor.length > 0);
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
}

.runtime-config-records-table th,
.runtime-config-records-table td {
  vertical-align: middle;
}

.runtime-config-records-table__key {
  color: rgb(var(--v-theme-primary));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.86rem;
  font-weight: 650;
}

.runtime-config-records-table__chip {
  text-transform: none;
}

.runtime-config-records-table__edit {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 20rem;
}

.runtime-config-records-table__edit :deep(.v-field) {
  min-width: 12rem;
}

@media (max-width: 900px) {
  .runtime-config-records-table__edit {
    min-width: 0;
  }
}
</style>
