<template>
  <v-sheet
    border
    rounded="lg"
    role="alert"
    class="studio-error-notice"
    :class="{
      'studio-error-notice--compact': compact,
      'studio-error-notice--overlay': overlay
    }"
  >
    <div class="studio-error-notice__icon">
      <v-icon :icon="mdiAlertCircleOutline" size="22" />
    </div>

    <div class="studio-error-notice__body">
      <div class="studio-error-notice__header">
        <strong>{{ displayTitle }}</strong>
        <v-chip
          v-if="displayCode"
          color="error"
          size="x-small"
          variant="tonal"
        >
          {{ displayCode }}
        </v-chip>
        <v-btn
          v-if="dismissible"
          :icon="mdiClose"
          aria-label="Dismiss"
          class="studio-error-notice__dismiss"
          density="comfortable"
          size="small"
          variant="text"
          @click="$emit('dismiss')"
        />
      </div>

      <p v-if="displayMessage" class="studio-error-notice__message">
        {{ displayMessage }}
      </p>

      <div
        v-if="$slots.actions"
        class="studio-error-notice__actions"
      >
        <slot name="actions" />
      </div>

      <div v-if="displayRepairCommand" class="studio-error-notice__repair">
        <code>{{ displayRepairCommand }}</code>
        <v-btn
          :icon="mdiContentCopy"
          aria-label="Copy repair command"
          size="x-small"
          variant="text"
          @click="copyRepairCommand"
        />
      </div>

      <div
        v-if="displayDetails"
        class="studio-error-notice__details"
      >
        <v-btn
          :append-icon="detailsOpen ? mdiChevronUp : mdiChevronDown"
          color="error"
          size="small"
          variant="text"
          @click="detailsOpen = !detailsOpen"
        >
          Details
        </v-btn>
        <v-expand-transition>
          <pre v-show="detailsOpen">{{ displayDetails }}</pre>
        </v-expand-transition>
      </div>

      <p v-if="copyStatus" class="studio-error-notice__copy-status">
        {{ copyStatus }}
      </p>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiAlertCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiContentCopy
} from "@mdi/js";

defineEmits(["dismiss"]);

const props = defineProps({
  code: {
    type: String,
    default: ""
  },
  compact: {
    type: Boolean,
    default: false
  },
  details: {
    type: [String, Object, Array],
    default: ""
  },
  dismissible: {
    type: Boolean,
    default: false
  },
  error: {
    type: [String, Object],
    default: ""
  },
  message: {
    type: String,
    default: ""
  },
  overlay: {
    type: Boolean,
    default: false
  },
  repairCommand: {
    type: String,
    default: ""
  },
  title: {
    type: String,
    default: ""
  }
});

const detailsOpen = ref(false);
const copyStatus = ref("");

const errorObject = computed(() => {
  return props.error && typeof props.error === "object" && !Array.isArray(props.error)
    ? props.error
    : {};
});

const displayCode = computed(() => String(props.code || errorObject.value.code || "").trim());

const displayTitle = computed(() => {
  const title = String(props.title || errorObject.value.title || "").trim();
  if (title) {
    return title;
  }
  if (displayCode.value) {
    return displayCode.value
      .replace(/[_-]+/gu, " ")
      .replace(/\b\w/gu, (letter) => letter.toUpperCase());
  }
  return "Something needs attention";
});

const displayMessage = computed(() => {
  return String(
    props.message ||
    errorObject.value.message ||
    (typeof props.error === "string" ? props.error : "") ||
    ""
  ).trim();
});

const displayRepairCommand = computed(() => {
  return String(props.repairCommand || errorObject.value.repairCommand || "").trim();
});

const displayDetails = computed(() => {
  const details = props.details ||
    errorObject.value.details ||
    errorObject.value.output ||
    errorObject.value.stderr ||
    errorObject.value.stdout ||
    "";
  if (!details) {
    return "";
  }
  if (typeof details === "string") {
    return details.trim();
  }
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details || "").trim();
  }
});

async function copyRepairCommand() {
  const value = displayRepairCommand.value;
  if (!value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    copyStatus.value = "Repair command copied.";
  } catch {
    copyStatus.value = "Copy failed.";
  }
}
</script>

<style scoped>
.studio-error-notice {
  align-items: flex-start;
  background:
    linear-gradient(135deg, rgba(var(--v-theme-error), 0.1), rgba(var(--v-theme-error), 0.035)),
    rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-error), 0.34) !important;
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 0.85rem;
}

.studio-error-notice--compact {
  gap: 0.6rem;
  padding: 0.65rem;
}

.studio-error-notice--overlay {
  left: 0.75rem;
  max-height: calc(100% - 1.5rem);
  overflow: auto;
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  z-index: 8;
}

.studio-error-notice__icon {
  align-items: center;
  background: rgba(var(--v-theme-error), 0.14);
  border: 1px solid rgba(var(--v-theme-error), 0.24);
  border-radius: 999px;
  color: rgb(var(--v-theme-error));
  display: inline-flex;
  height: 2.25rem;
  justify-content: center;
  width: 2.25rem;
}

.studio-error-notice--compact .studio-error-notice__icon {
  height: 2rem;
  width: 2rem;
}

.studio-error-notice__body {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
}

.studio-error-notice__header {
  align-items: center;
  display: grid;
  gap: 0.45rem;
  grid-template-columns: minmax(0, auto) auto minmax(0, 1fr) auto;
  min-width: 0;
}

.studio-error-notice__header strong {
  font-size: 0.9rem;
  letter-spacing: 0;
  line-height: 1.25;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-error-notice__dismiss {
  grid-column: 4;
  justify-self: end;
  margin: -0.35rem -0.35rem -0.35rem 0;
}

.studio-error-notice__message {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.85rem;
  line-height: 1.45;
  margin: 0;
}

.studio-error-notice__repair {
  align-items: center;
  background: rgba(var(--v-theme-error), 0.08);
  border: 1px solid rgba(var(--v-theme-error), 0.18);
  border-radius: 6px;
  display: grid;
  gap: 0.4rem;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 0.45rem 0.45rem 0.45rem 0.6rem;
}

.studio-error-notice__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.studio-error-notice__repair code,
.studio-error-notice__details pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.studio-error-notice__repair code {
  font-size: 0.78rem;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
}

.studio-error-notice__details {
  display: grid;
  justify-items: start;
}

.studio-error-notice__details pre {
  background: rgba(var(--v-theme-surface-variant), 0.42);
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.76rem;
  line-height: 1.45;
  margin: 0.25rem 0 0;
  max-height: 16rem;
  max-width: 100%;
  overflow: auto;
  padding: 0.6rem;
}

.studio-error-notice__copy-status {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.75rem;
  margin: 0;
}

@media (max-width: 700px) {
  .studio-error-notice {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-error-notice__icon {
    display: none;
  }
}
</style>
