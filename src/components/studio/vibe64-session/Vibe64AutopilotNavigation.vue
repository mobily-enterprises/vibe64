<template>
  <section
    v-if="steps.length"
    class="studio-autopilot-nav"
    :class="[
      `studio-autopilot-nav--${layout}`,
      {
        'studio-autopilot-nav--executing': executing,
        'studio-autopilot-nav--expanded': mobileStepsOpen
      }
    ]"
    aria-label="Autopilot progress"
  >
    <div
      v-if="summaryLayout"
      class="studio-autopilot-nav__summary"
    >
      <button
        :aria-expanded="mobileStepsOpen"
        class="studio-autopilot-nav__summary-stage"
        type="button"
        @click="toggleMobileSteps"
      >
        <span class="studio-autopilot-nav__summary-copy">
          <strong class="studio-autopilot-nav__summary-label">
            {{ currentStepLabel }} ({{ currentStepIndex + 1 }}/{{ steps.length }})
          </strong>
        </span>
        <v-icon :icon="mobileStepsOpen ? mdiChevronUp : mdiChevronDown" size="18" />
      </button>
      <slot name="actions" />
    </div>

    <v-btn
      v-if="railLayout"
      class="studio-autopilot-nav__mobile-toggle"
      :append-icon="mobileStepsOpen ? mdiChevronUp : mdiChevronDown"
      type="button"
      variant="tonal"
      @click="toggleMobileSteps"
    >
      {{ mobileToggleLabel }}
    </v-btn>

    <div
      v-show="!summaryLayout || mobileStepsOpen"
      class="studio-autopilot-nav__content"
    >
      <ol class="studio-autopilot-nav__steps">
        <li
          v-for="step in steps"
          :key="step.id"
          class="studio-autopilot-nav__step"
          :class="`studio-autopilot-nav__step--${step.state}`"
          :aria-current="step.current ? 'step' : undefined"
        >
          <v-tooltip
            :disabled="!stepHint(step)"
            location="bottom"
            :open-delay="1000"
            :text="stepHint(step)"
          >
            <template #activator="{ props: tooltipProps }">
              <span
                class="studio-autopilot-nav__step-hitbox"
                tabindex="0"
                :aria-label="stepHint(step)"
                v-bind="tooltipProps"
              >
                <span class="studio-autopilot-nav__step-icon">
                  <v-icon :icon="stepIcon(step)" size="16" />
                </span>
                <span
                  v-if="step.state === 'done'"
                  class="studio-autopilot-nav__step-done-check"
                  aria-hidden="true"
                >
                  <v-icon :icon="mdiCheck" size="10" />
                </span>
                <span
                  v-if="summaryLayout"
                  class="studio-autopilot-nav__step-label"
                >
                  {{ step.label || step.id }}
                </span>
              </span>
            </template>
          </v-tooltip>
          <v-btn
            v-if="step.canRewind && !step.current"
            class="studio-autopilot-nav__step-rewind"
            color="error"
            :disabled="busy"
            :icon="mdiUndoVariant"
            size="x-small"
            :aria-label="`Rewind to ${step.label || step.id}`"
            type="button"
            variant="text"
            @click.stop="requestRewind(step)"
          />
        </li>
      </ol>
    </div>

    <v-dialog
      v-model="confirmationOpen"
      max-width="28rem"
    >
      <v-card>
        <v-card-title>Rewind?</v-card-title>
        <v-card-text>
          Rewind this session to the selected step. Later Autopilot progress will be discarded.
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
  mdiCheck,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiCircleOutline,
  mdiCircleSlice8,
  mdiUndoVariant
} from "@mdi/js";

const props = defineProps({
  busy: {
    default: false,
    type: Boolean
  },
  executing: {
    default: false,
    type: Boolean
  },
  layout: {
    default: "bar",
    type: String
  },
  steps: {
    default: () => [],
    type: Array
  }
});
const emit = defineEmits(["rewind"]);

const mobileStepsOpen = ref(false);
const pendingStep = ref(null);
const confirmationOpen = ref(false);

const railLayout = computed(() => props.layout === "rail");
const summaryLayout = computed(() => props.layout === "summary");
const currentStep = computed(() => props.steps.find((step) => step.current) || props.steps[0] || null);
const currentStepIndex = computed(() => Math.max(0, props.steps.findIndex((step) => step.id === currentStep.value?.id)));
const mobileToggleLabel = computed(() => `Step ${currentStepIndex.value + 1} of ${props.steps.length}`);
const currentStepLabel = computed(() => String(
  currentStep.value?.label || currentStep.value?.description || currentStep.value?.id || "Session ready"
).trim());

function toggleMobileSteps() {
  mobileStepsOpen.value = !mobileStepsOpen.value;
}

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
  if (step.icon) {
    return step.icon;
  }
  if (step.state === "done") {
    return mdiCheckCircle;
  }
  if (step.state === "current") {
    return mdiCircleSlice8;
  }
  return mdiCircleOutline;
}

function stepHint(step = {}) {
  return String(step.description || step.label || step.id || "").trim();
}

watch(confirmationOpen, (open) => {
  if (!open) {
    pendingStep.value = null;
  }
});

watch(currentStepIndex, () => {
  mobileStepsOpen.value = false;
});
</script>

<style scoped>
.studio-autopilot-nav {
  display: grid;
  gap: 0.6rem;
  min-width: 0;
}

.studio-autopilot-nav__mobile-toggle {
  display: none;
}

.studio-autopilot-nav__summary {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  min-width: 0;
}

.studio-autopilot-nav__summary-stage {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.035);
  border: 1px solid rgba(var(--v-theme-outline), 0.22);
  border-radius: 9px;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex: 1 1 auto;
  gap: 0.6rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.3rem 0.6rem;
  text-align: left;
}

.studio-autopilot-nav__summary-stage:hover,
.studio-autopilot-nav__summary-stage:focus-visible {
  background: rgba(var(--v-theme-primary), 0.07);
  border-color: rgba(var(--v-theme-primary), 0.36);
  outline: none;
}

.studio-autopilot-nav__summary-copy {
  min-width: 0;
}

.studio-autopilot-nav__summary-label {
  font-size: 0.88rem;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot-nav__content {
  align-items: center;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
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
  position: relative;
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
  overflow: visible;
  position: relative;
  transform: translateZ(0);
}

.studio-autopilot-nav__step-hitbox {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  outline: none;
  position: relative;
}

.studio-autopilot-nav__step-label {
  color: inherit;
  font-size: 0.78rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot-nav--summary .studio-autopilot-nav__content {
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 9px;
  max-height: min(18rem, 42vh);
  overflow-y: auto;
  padding: 0.4rem;
}

.studio-autopilot-nav--summary .studio-autopilot-nav__steps {
  grid-template-columns: minmax(0, 1fr);
}

.studio-autopilot-nav--summary .studio-autopilot-nav__step-hitbox {
  flex: 1 1 auto;
  gap: 0.45rem;
  justify-content: flex-start;
  min-width: 0;
}

.studio-autopilot-nav__step-hitbox:focus-visible {
  border-radius: 999px;
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.35);
}

.studio-autopilot-nav--rail {
  align-self: stretch;
  min-height: 0;
}

.studio-autopilot-nav--rail .studio-autopilot-nav__content {
  align-content: start;
  align-items: stretch;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.15rem;
  scrollbar-gutter: stable;
}

.studio-autopilot-nav--rail .studio-autopilot-nav__steps {
  grid-template-columns: minmax(0, 1fr);
}

.studio-autopilot-nav--rail :deep(.v-btn) {
  justify-self: stretch;
}

.studio-autopilot-nav--icons {
  gap: 0.35rem;
}

.studio-autopilot-nav--icons .studio-autopilot-nav__content {
  grid-template-columns: minmax(0, 1fr);
}

.studio-autopilot-nav--icons .studio-autopilot-nav__steps {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.12rem;
  overflow-x: auto;
  padding-block: 0.1rem;
  scrollbar-width: thin;
}

.studio-autopilot-nav--icons .studio-autopilot-nav__step {
  border-radius: 999px;
  flex: 0 0 auto;
  height: 1.9rem;
  justify-content: center;
  padding: 0;
  width: 1.9rem;
}

.studio-autopilot-nav--icons .studio-autopilot-nav__step-hitbox {
  height: 100%;
  width: 100%;
}

.studio-autopilot-nav--icons .studio-autopilot-nav__step--done {
  background: rgba(var(--v-theme-success), 0.09);
  border-color: rgba(var(--v-theme-success), 0.34);
}

.studio-autopilot-nav--icons .studio-autopilot-nav__step-done-check {
  align-items: center;
  background: rgb(var(--v-theme-success));
  border: 2px solid rgb(var(--v-theme-surface));
  border-radius: 999px;
  bottom: -0.08rem;
  color: rgb(var(--v-theme-on-success));
  display: inline-flex;
  height: 0.78rem;
  justify-content: center;
  position: absolute;
  right: -0.08rem;
  width: 0.78rem;
}

.studio-autopilot-nav--icons .studio-autopilot-nav__step--current {
  background: rgba(var(--v-theme-warning), 0.12);
  border-color: rgba(var(--v-theme-warning), 0.54);
  border-width: 2px;
  box-shadow: 0 0 0 4px rgba(var(--v-theme-warning), 0.13);
  color: rgb(var(--v-theme-warning));
  height: 2.35rem;
  margin-inline: 0.02rem;
  width: 2.35rem;
}

.studio-autopilot-nav--icons .studio-autopilot-nav__step--current .studio-autopilot-nav__step-icon {
  transform: scale(1.22);
}

.studio-autopilot-nav--icons .studio-autopilot-nav__step--current::after {
  background: rgb(var(--v-theme-warning));
  border: 2px solid rgb(var(--v-theme-surface));
  border-radius: 999px;
  bottom: 0.12rem;
  box-shadow: 0 0 0 2px rgba(var(--v-theme-warning), 0.18);
  content: "";
  height: 0.48rem;
  position: absolute;
  right: 0.12rem;
  width: 0.48rem;
}

.studio-autopilot-nav__step-rewind {
  opacity: 0;
  position: absolute;
  right: -0.36rem;
  top: -0.36rem;
  transform: scale(0.86);
  transition: opacity 0.14s ease, transform 0.14s ease;
  z-index: 2;
}

.studio-autopilot-nav__step:hover .studio-autopilot-nav__step-rewind,
.studio-autopilot-nav__step:focus-within .studio-autopilot-nav__step-rewind {
  opacity: 1;
  transform: scale(1);
}

.studio-autopilot-nav--icons.studio-autopilot-nav--executing .studio-autopilot-nav__step--current .studio-autopilot-nav__step-icon {
  will-change: transform;
}

.studio-autopilot-nav--icons.studio-autopilot-nav--executing .studio-autopilot-nav__step--current .studio-autopilot-nav__step-icon::after {
  animation: studio-autopilot-nav-current-pulse 5s ease-out infinite;
  border: 2px solid currentColor;
  border-radius: 999px;
  content: "";
  inset: -0.18rem;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transform: scale(1) translateZ(0);
  transform-origin: center;
  will-change: opacity, transform;
}

@media (max-width: 980px) {
  .studio-autopilot-nav--rail {
    align-self: auto;
  }

  .studio-autopilot-nav--rail .studio-autopilot-nav__mobile-toggle {
    display: inline-flex;
    justify-self: stretch;
  }

  .studio-autopilot-nav--rail .studio-autopilot-nav__content {
    border: 1px solid rgba(var(--v-theme-outline), 0.2);
    border-radius: 8px;
    display: none;
    max-height: min(25rem, 62vh);
    overflow-y: auto;
    padding: 0.45rem;
  }

  .studio-autopilot-nav--rail.studio-autopilot-nav--expanded .studio-autopilot-nav__content {
    display: grid;
  }
}

@media (max-width: 640px) {
  .studio-autopilot-nav__content {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-autopilot-nav :deep(.v-btn) {
    justify-self: end;
  }

  .studio-autopilot-nav--rail :deep(.v-btn) {
    justify-self: stretch;
  }
}

@keyframes studio-autopilot-nav-current-pulse {
  0% {
    opacity: 0.42;
    transform: scale(1) translateZ(0);
  }

  16% {
    opacity: 0;
    transform: scale(1.45) translateZ(0);
  }

  100% {
    opacity: 0;
    transform: scale(1.45) translateZ(0);
  }
}
</style>
