<template>
  <v-tooltip
    location="bottom"
    :open-delay="400"
    :text="buttonTitle"
  >
    <template #activator="{ props: tooltipProps }">
      <span
        class="studio-ai-source-safety-button__activator"
        v-bind="tooltipProps"
      >
        <v-btn
          :aria-label="buttonLabel"
          class="studio-ai-source-safety-button"
          :class="{ 'studio-ai-source-safety-button--unsafe': unsafe }"
          :color="buttonColor"
          :disabled="buttonDisabled"
          :loading="sourceSafety.prompting"
          :prepend-icon="mdiSourceCommit"
          size="small"
          :style="buttonStyle"
          type="button"
          variant="tonal"
          @click="requestConfirmation"
        >
          {{ buttonText }}
        </v-btn>
      </span>
    </template>
  </v-tooltip>

  <Vibe64SessionSourceSafetyDialog
    :open="confirmationOpen"
    :session-label="sessionLabel"
    :source-safety="sourceSafety"
    @cancel="cancelConfirmation"
    @confirm="confirmSourceSafetyPrompt"
    @view-changes="viewChanges"
  />
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiSourceCommit } from "@mdi/js";
import Vibe64SessionSourceSafetyDialog from "@/components/studio/vibe64-session/Vibe64SessionSourceSafetyDialog.vue";
import {
  sourceSafetyButtonLabel,
  sourceSafetyIsUnsafe,
  sourceSafetyMarkStyle,
  sourceSafetyRequiresPush,
  sourceSafetyStatusTitle
} from "@/lib/vibe64SessionSourceSafety.js";

const props = defineProps({
  sessionLabel: {
    default: "",
    type: String
  },
  sourceSafety: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["view-changes"]);
const confirmationRequested = ref(false);
const unsafe = computed(() => sourceSafetyIsUnsafe(props.sourceSafety));
const promptPending = computed(() => Boolean(
  props.sourceSafety.prompting || props.sourceSafety.promptSent
));
const buttonDisabled = computed(() => !unsafe.value || promptPending.value);
const buttonColor = computed(() => {
  if (props.sourceSafety.error) {
    return "warning";
  }
  return unsafe.value ? undefined : "success";
});
const buttonStyle = computed(() => (
  unsafe.value ? sourceSafetyMarkStyle(props.sourceSafety) : undefined
));
const buttonText = computed(() => sourceSafetyButtonLabel(props.sourceSafety));
const buttonLabel = computed(() => {
  if (props.sourceSafety.loading || !props.sourceSafety.initialized) {
    return "Checking whether session work is safely stored";
  }
  if (props.sourceSafety.error) {
    return "Session source safety could not be checked";
  }
  if (!unsafe.value) {
    return "Session work safely stored";
  }
  return `${sourceSafetyButtonLabel(props.sourceSafety)} session work`;
});
const buttonTitle = computed(() => {
  if (props.sourceSafety.loading || !props.sourceSafety.initialized) {
    return "Checking whether session work is safely stored.";
  }
  if (props.sourceSafety.error) {
    return `Vibe64 could not check this session's source: ${props.sourceSafety.error}`;
  }
  if (props.sourceSafety.available === false) {
    return "The session source is not ready for code sync yet.";
  }
  if (props.sourceSafety.promptSent) {
    return "The save-work prompt was sent.";
  }
  if (props.sourceSafety.prompting) {
    return "Sending the save-work prompt.";
  }
  if (unsafe.value) {
    return sourceSafetyStatusTitle(props.sourceSafety);
  }
  return sourceSafetyRequiresPush(props.sourceSafety)
    ? "All current session work is committed and pushed."
    : "All current session work is committed.";
});
const confirmationOpen = computed(() => Boolean(
  confirmationRequested.value && unsafe.value
));

function requestConfirmation() {
  if (buttonDisabled.value) {
    return;
  }
  confirmationRequested.value = true;
}

function cancelConfirmation() {
  if (!props.sourceSafety.prompting) {
    confirmationRequested.value = false;
  }
}

function viewChanges() {
  if (props.sourceSafety.prompting) {
    return;
  }
  confirmationRequested.value = false;
  emit("view-changes");
}

async function confirmSourceSafetyPrompt() {
  if (buttonDisabled.value) {
    return;
  }
  if (await props.sourceSafety.prompt?.()) {
    confirmationRequested.value = false;
  }
}

watch(unsafe, (isUnsafe) => {
  if (!isUnsafe) {
    confirmationRequested.value = false;
  }
});
</script>

<style scoped>
.studio-ai-source-safety-button__activator {
  display: inline-flex;
  flex: 0 0 auto;
}

.studio-ai-source-safety-button {
  flex: 0 0 auto;
  white-space: nowrap;
}

.studio-ai-source-safety-button.v-btn--disabled {
  opacity: 0.62;
}

.studio-ai-source-safety-button--unsafe {
  color: var(--vibe64-source-safety-color) !important;
}
</style>
