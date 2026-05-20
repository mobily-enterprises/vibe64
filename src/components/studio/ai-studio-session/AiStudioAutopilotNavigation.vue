<template>
  <section
    v-if="steps.length"
    class="studio-autopilot-nav"
    aria-label="Autopilot progress"
  >
    <ol class="studio-autopilot-nav__steps">
      <li
        v-for="step in steps"
        :key="step.id"
        class="studio-autopilot-nav__step"
        :class="`studio-autopilot-nav__step--${step.state}`"
        :aria-current="step.current ? 'step' : undefined"
      >
        <span class="studio-autopilot-nav__step-icon">
          <v-icon :icon="stepIcon(step)" size="16" />
        </span>
        <span class="studio-autopilot-nav__step-label">
          {{ step.label }}
        </span>
      </li>
    </ol>

    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          :disabled="busy || !hasJumpableSteps"
          :prepend-icon="mdiUndoVariant"
          size="small"
          type="button"
          variant="tonal"
        >
          Jump back
        </v-btn>
      </template>

      <v-list density="compact" class="studio-autopilot-nav__jump-list">
        <v-list-item
          v-for="step in jumpableSteps"
          :key="step.id"
          :disabled="busy"
          :prepend-icon="mdiUndoVariant"
          :title="step.rewindLabel || step.label"
          @click="requestRewind(step)"
        />
      </v-list>
    </v-menu>

    <v-dialog
      v-model="confirmationOpen"
      max-width="28rem"
    >
      <v-card>
        <v-card-title>Jump back?</v-card-title>
        <v-card-text>
          Rewind this session to {{ pendingStepLabel }}. Later Autopilot progress will be discarded.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            :disabled="busy"
            type="button"
            variant="text"
            @click="cancelRewind"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            :disabled="busy"
            :loading="busy"
            :prepend-icon="mdiUndoVariant"
            type="button"
            variant="tonal"
            @click="confirmRewind"
          >
            Rewind
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import {
  mdiCheckCircle,
  mdiCircleOutline,
  mdiCircleSlice8,
  mdiUndoVariant
} from "@mdi/js";

const props = defineProps({
  busy: {
    default: false,
    type: Boolean
  },
  steps: {
    default: () => [],
    type: Array
  }
});
const emit = defineEmits(["rewind"]);

const pendingStep = ref(null);
const confirmationOpen = ref(false);
const jumpableSteps = computed(() => props.steps.filter((step) => step.canRewind && !step.current));
const hasJumpableSteps = computed(() => jumpableSteps.value.length > 0);
const pendingStepLabel = computed(() => pendingStep.value?.rewindLabel || pendingStep.value?.label || "this point");

function requestRewind(step = {}) {
  if (props.busy || step.canRewind !== true) {
    return;
  }
  pendingStep.value = step;
  confirmationOpen.value = true;
}

function cancelRewind() {
  confirmationOpen.value = false;
  pendingStep.value = null;
}

function confirmRewind() {
  if (props.busy || !pendingStep.value) {
    return;
  }
  const step = pendingStep.value;
  cancelRewind();
  emit("rewind", step);
}

function stepIcon(step = {}) {
  if (step.state === "done") {
    return mdiCheckCircle;
  }
  if (step.state === "current") {
    return mdiCircleSlice8;
  }
  return mdiCircleOutline;
}

watch(confirmationOpen, (open) => {
  if (!open) {
    pendingStep.value = null;
  }
});
</script>

<style scoped>
.studio-autopilot-nav {
  align-items: center;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.studio-autopilot-nav__steps {
  display: grid;
  gap: 0.35rem;
  grid-template-columns: repeat(auto-fit, minmax(5.75rem, 1fr));
  list-style: none;
  margin: 0;
  min-width: 0;
  padding: 0;
}

.studio-autopilot-nav__step {
  align-items: center;
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: flex;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.38rem 0.45rem;
}

.studio-autopilot-nav__step--done {
  color: rgb(var(--v-theme-success));
}

.studio-autopilot-nav__step--current {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.42);
  color: rgb(var(--v-theme-primary));
}

.studio-autopilot-nav__step-icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
}

.studio-autopilot-nav__step-label {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.78rem;
  font-weight: 650;
  line-height: 1.1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-autopilot-nav__jump-list {
  min-width: min(15rem, 88vw);
}

@media (max-width: 640px) {
  .studio-autopilot-nav {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-autopilot-nav :deep(.v-btn) {
    justify-self: end;
  }
}
</style>
