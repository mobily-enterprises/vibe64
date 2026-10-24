<template>
  <section class="runtime-config-records">
    <section class="runtime-config-records__section">
      <div class="runtime-config-records__heading">
        <h2>{{ editableTitle }}</h2>
        <v-chip size="x-small" variant="tonal">
          {{ editableRecords.length }}
        </v-chip>
      </div>

      <RuntimeConfigRecordsTable
        v-if="editableRecords.length"
        :environment-label="environmentLabel"
        :records="editableRecords"
        :revealed-secrets="revealedSecrets"
        :save-busy="saveBusy"
        :secret-reveal-busy-key="secretRevealBusyKey"
        :secret-reveal-enabled="secretRevealEnabled"
        :show-actions="!readonly"
        @hide-secret="$emit('hide-secret', $event)"
        @remove-record="$emit('remove-record', $event)"
        @reveal-secret="$emit('reveal-secret', $event)"
        @save-record="$emit('save-record', $event)"
        @saved-value-changed="$emit('saved-value-changed')"
      />
      <p v-else class="runtime-config-records__empty">
        {{ editableEmptyText }}
      </p>
    </section>

    <v-expansion-panels
      v-if="systemRecords.length"
      class="runtime-config-records__system"
      variant="accordion"
    >
      <v-expansion-panel>
        <v-expansion-panel-title>
          <span class="runtime-config-records__system-title">
            {{ systemTitle }}
            <v-chip size="x-small" variant="tonal">
              {{ systemRecords.length }}
            </v-chip>
          </span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <RuntimeConfigRecordsTable
            :environment-label="environmentLabel"
            :records="systemRecords"
            :revealed-secrets="revealedSecrets"
            :secret-reveal-busy-key="secretRevealBusyKey"
            :secret-reveal-enabled="secretRevealEnabled"
            @hide-secret="$emit('hide-secret', $event)"
            @reveal-secret="$emit('reveal-secret', $event)"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </section>
</template>

<script setup>
import { computed } from "vue";
import RuntimeConfigRecordsTable from "@/components/studio/RuntimeConfigRecordsTable.vue";
import { recordIsSavedEnvValue } from "@/lib/vibe64SavedEnvValues.js";

defineEmits([
  "hide-secret",
  "remove-record",
  "reveal-secret",
  "save-record",
  "saved-value-changed"
]);

const props = defineProps({
  editableEmptyText: {
    default: "No user Env values.",
    type: String
  },
  editableTitle: {
    default: "User values",
    type: String
  },
  environmentLabel: {
    default: "environment",
    type: String
  },
  // Shows the person's rows without their edit and remove actions.
  readonly: {
    default: false,
    type: Boolean
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
  systemTitle: {
    default: "System values",
    type: String
  }
});

const records = computed(() => Array.isArray(props.records) ? props.records : []);
const editableRecords = computed(() => records.value.filter(recordEditable));
const systemRecords = computed(() => records.value.filter((record) => !recordEditable(record)));

// Rows the person filled, typed here or linked to a saved value, form the main list.
function recordEditable(record = {}) {
  return record.editable === true || recordIsSavedEnvValue(record);
}
</script>

<style scoped>
.runtime-config-records {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.runtime-config-records__section {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

.runtime-config-records__heading {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-start;
}

.runtime-config-records__heading h2 {
  font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif);
  letter-spacing: 0;
  margin: 0;
}

/* An M3-style empty state: a quiet dashed slot where values will appear. */
.runtime-config-records__empty {
  border: 1px dashed var(--v64-outline, rgba(0, 0, 0, 0.24));
  border-radius: var(--v64-shape-lg, 16px);
  color: var(--v64-on-surface-variant, rgba(0, 0, 0, 0.62));
  font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif);
  margin: 0;
  padding: var(--v64-space-5, 24px) var(--v64-space-4, 16px);
  text-align: center;
}

.runtime-config-records__system-title {
  align-items: center;
  display: inline-flex;
  gap: 0.5rem;
  min-width: 0;
}
</style>
