<template>
  <div class="doctor-status__checks">
    <v-sheet
      v-for="check in checks"
      :key="check.id"
      rounded="lg"
      border
      :class="[
        'doctor-status__check',
        `doctor-status__check--${check.status}`
      ]"
    >
      <div :class="['doctor-status__status-badge', doctorStatusToneClass(check.status)]">
        <v-icon
          class="doctor-status__status-icon"
          :icon="doctorStatusIcon(check.status)"
          :color="doctorStatusColor(check.status)"
          :aria-label="doctorStatusLabel(check.status)"
          size="30"
        />
      </div>

      <div class="doctor-status__check-body">
        <div class="doctor-status__check-header">
          <div>
            <h3 class="text-subtitle-2 mb-1">{{ check.label }}</h3>
            <p class="text-body-2 text-medium-emphasis mb-0">{{ check.explanation }}</p>
          </div>
        </div>

        <div class="doctor-status__facts">
          <p class="text-caption text-medium-emphasis mb-0 doctor-status__fact-line">
            <span class="doctor-status__fact">
              <strong class="text-high-emphasis">Expected:</strong>
              {{ check.expected }}
            </span>
            <span class="doctor-status__fact doctor-status__observed">
              <strong class="text-high-emphasis">Observed:</strong>
              {{ check.observed }}
            </span>
          </p>
        </div>

        <pre v-if="repairsFor(check).length" class="doctor-status__command">{{ repairCommandPreview(check) }}</pre>
      </div>

      <div v-if="repairsFor(check).length" class="doctor-status__actions">
        <template v-for="repair in repairsFor(check)" :key="repair.actionId">
          <v-btn
            v-if="repair.kind === 'terminal'"
            color="primary"
            class="doctor-status__repair-button"
            variant="flat"
            :prepend-icon="mdiConsoleLine"
            :disabled="Boolean(actionInFlight)"
            @click="repairRequiresInput(repair) ? emit('confirm-repair', { check, repair }) : emit('run-repair', repair)"
          >
            {{ repair.label || "Open terminal" }}
          </v-btn>
          <v-btn
            v-else
            class="doctor-status__repair-button"
            variant="tonal"
            color="warning"
            disabled
          >
            {{ repair.label || "Manual repair required" }}
          </v-btn>
        </template>
      </div>
    </v-sheet>
  </div>
</template>

<script setup>
import { mdiConsoleLine } from "@mdi/js";
import {
  doctorStatusColor,
  doctorStatusIcon,
  doctorStatusLabel,
  doctorStatusToneClass
} from "@/lib/doctorStatusDisplay.js";

const props = defineProps({
  actionInFlight: {
    type: String,
    default: ""
  },
  checks: {
    type: Array,
    default: () => []
  },
  repairCommandPreview: {
    type: Function,
    required: true
  },
  repairRequiresInput: {
    type: Function,
    required: true
  },
  visibleCheckRepairs: {
    type: Function,
    required: true
  }
});

const emit = defineEmits(["confirm-repair", "run-repair"]);

function repairsFor(check) {
  return props.visibleCheckRepairs(check);
}
</script>

<style scoped>
.doctor-status__checks {
  display: grid;
  gap: 0.625rem;
}

.doctor-status__check {
  align-items: start;
  border-left: 4px solid transparent;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  padding: 0.7rem 0.625rem;
}

.doctor-status__check--pass {
  background: rgba(var(--v-theme-success), 0.04);
  border-left-color: rgb(var(--v-theme-success));
}

.doctor-status__check--fail,
.doctor-status__check--blocked,
.doctor-status__check--hard-stop {
  background: rgba(var(--v-theme-error), 0.04);
  border-left-color: rgb(var(--v-theme-error));
}

.doctor-status__check--running {
  background: rgba(var(--v-theme-primary), 0.045);
  border-left-color: rgb(var(--v-theme-primary));
}

.doctor-status__check--pending {
  background: rgba(var(--v-theme-warning), 0.045);
  border-left-color: rgb(var(--v-theme-warning));
}

.doctor-status__status-badge {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  height: 2.5rem;
  justify-content: center;
  width: 2.5rem;
}

.doctor-status__status-badge--pass {
  background: rgba(var(--v-theme-success), 0.13);
}

.doctor-status__status-badge--fail {
  background: rgba(var(--v-theme-error), 0.13);
}

.doctor-status__status-badge--running {
  background: rgba(var(--v-theme-primary), 0.13);
}

.doctor-status__status-badge--unknown {
  background: rgba(var(--v-theme-warning), 0.14);
}

.doctor-status__check-body {
  min-width: 0;
}

.doctor-status__check-header {
  align-items: start;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.doctor-status__check-header h3 {
  line-height: 1.15;
}

.doctor-status__check-header p {
  font-size: 0.8125rem;
  line-height: 1.25;
}

.doctor-status__facts {
  margin-top: 0.25rem;
}

.doctor-status__fact-line {
  line-height: 1.25;
}

.doctor-status__fact,
.doctor-status__observed {
  overflow-wrap: anywhere;
}

.doctor-status__fact {
  margin-inline-end: 0.75rem;
}

.doctor-status__command {
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8125rem;
  line-height: 1.25;
  margin: 0;
  margin-top: 0.45rem;
  max-height: 3.75rem;
  max-width: 100%;
  overflow: auto;
  padding: 0.35rem 0.45rem;
  white-space: pre-wrap;
  width: 100%;
}

.doctor-status__actions {
  align-items: center;
  align-self: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  min-width: min(16rem, 100%);
}

.doctor-status__repair-button {
  min-height: 48px;
}

@media (max-width: 720px) {
  .doctor-status__check {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .doctor-status__actions {
    grid-column: 2;
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  .doctor-status__check {
    gap: 0.6rem;
    padding: 0.65rem;
  }

  .doctor-status__actions {
    grid-column: 1 / -1;
  }

  .doctor-status__actions .v-btn {
    flex: 1 1 100%;
  }
}
</style>
