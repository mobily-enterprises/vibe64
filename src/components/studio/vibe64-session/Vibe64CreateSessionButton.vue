<template>
  <v-btn
    ref="button"
    :aria-busy="createSessionRunning ? 'true' : undefined"
    :aria-disabled="creationUnavailable ? 'true' : undefined"
    :aria-label="buttonAriaLabel"
    :block="block"
    :class="[
      buttonClass,
      { 'studio-ai-sessions__create-button--unavailable': creationUnavailable }
    ]"
    :disabled="createSessionRunning"
    :icon="iconOnly ? true : undefined"
    :prepend-icon="iconOnly ? undefined : mdiPlus"
    :size="size"
    :title="buttonTitle"
    :variant="variant"
    @click="requestCreateSession"
  >
    <v-icon v-if="iconOnly" :icon="mdiPlus" />
    <template v-if="!iconOnly">{{ buttonLabel }}</template>
  </v-btn>

  <Vibe64AssistantSessionDialog
    v-model="dialogOpen"
    :toolbar="toolbar"
    @created="handleCreated"
  />
</template>

<script setup>
import { computed, ref } from "vue";
import { mdiPlus } from "@mdi/js";

import Vibe64AssistantSessionDialog from "@/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue";
import {
  focusCreatedVibe64SessionTab
} from "@/lib/vibe64SessionFocus.js";

const props = defineProps({
  ariaLabel: {
    default: "",
    type: String
  },
  block: {
    default: false,
    type: Boolean
  },
  buttonClass: {
    default: "",
    type: [Array, Object, String]
  },
  iconOnly: {
    default: true,
    type: Boolean
  },
  label: {
    default: "New session",
    type: String
  },
  size: {
    default: "small",
    type: String
  },
  toolbar: {
    default: () => ({}),
    type: Object
  },
  variant: {
    default: "flat",
    type: String
  }
});

const button = ref(null);
const dialogOpen = ref(false);
const createSessionRunning = computed(() => props.toolbar.createSessionRunning === true);
const creationUnavailable = computed(() => (
  !createSessionRunning.value && props.toolbar.canCreateSession !== true
));
const buttonAriaLabel = computed(() => {
  if (createSessionRunning.value) {
    return "Creating session…";
  }
  const label = String(props.ariaLabel || props.label || "New session").trim();
  return creationUnavailable.value && buttonTitle.value
    ? `${label}. ${buttonTitle.value}`
    : label;
});
const buttonLabel = computed(() => (
  createSessionRunning.value ? "Creating session…" : props.label
));
const buttonTitle = computed(() => (
  createSessionRunning.value
    ? "Creating session…"
    : String(props.toolbar.createSessionTitle || props.ariaLabel || props.label || "New session").trim()
));
function requestCreateSession() {
  if (creationUnavailable.value || createSessionRunning.value) {
    return;
  }
  dialogOpen.value = true;
}

function handleCreated(response = {}) {
  if (response?.sessionId) {
    void focusCreatedVibe64SessionTab(response.sessionId);
  }
}

</script>

<style scoped>
.studio-ai-sessions__create-button {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: none !important;
  color: #1a73e8 !important;
  height: 3rem;
  min-height: 3rem;
  min-width: 3rem;
  overflow: visible;
  position: relative;
  width: 3rem;
}

.studio-ai-sessions__create-button:hover {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
}

.studio-ai-sessions__create-button :deep(.v-icon) {
  color: currentColor;
  font-size: 1.15rem;
}

.studio-ai-sessions__create-button--attention:not(.v-btn--disabled) {
  border-color: rgba(26, 115, 232, 0.36);
}

.studio-ai-sessions__create-button--attention:not(.v-btn--disabled)::after {
  animation: studio-ai-session-create-pulse 6s ease-out infinite;
  border: 2px solid currentColor;
  border-radius: inherit;
  content: "";
  inset: -0.18rem;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transform: scale(1) translateZ(0);
  transform-origin: center;
  will-change: opacity, transform;
}

.studio-ai-sessions__preview-create-button {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
  border: 1px solid transparent;
  border-radius: var(--studio-control-radius, 7px);
  box-shadow: none !important;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 500;
  letter-spacing: 0;
  min-height: 3rem;
  min-width: 12rem;
}

.studio-ai-sessions__preview-create-button:hover {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
}

.studio-ai-sessions__create-button--unavailable {
  cursor: not-allowed;
  opacity: var(--v-disabled-opacity, 0.38);
}

.studio-ai-sessions__create-button--unavailable:hover {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
}

@keyframes studio-ai-session-create-pulse {
  0% {
    opacity: 0.48;
    transform: scale(1) translateZ(0);
  }

  14% {
    opacity: 0;
    transform: scale(1.34) translateZ(0);
  }

  100% {
    opacity: 0;
    transform: scale(1.34) translateZ(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .studio-ai-sessions__create-button--attention:not(.v-btn--disabled)::after {
    animation: none;
  }
}

</style>
