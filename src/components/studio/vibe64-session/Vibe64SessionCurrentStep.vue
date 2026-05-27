<template>
  <Vibe64BackgroundTasks
    v-if="visibleBackgroundTasks.length || backgroundTaskError"
    class="studio-ai-sessions__background-tasks"
    :error="backgroundTaskError"
    :retrying-task-id="retryingBackgroundTaskId"
    :tasks="visibleBackgroundTasks"
    @retry="retryBackgroundTask"
  />

  <form
    v-if="stepInput.visible"
    class="studio-ai-sessions__step-input"
    @submit.prevent="stepInput.submit"
  >
    <p
      v-if="stepInput.interaction?.prompt"
      class="text-body-2 text-medium-emphasis mb-0"
    >
      {{ stepInput.interaction.prompt }}
    </p>

    <component
      :is="field.kind === 'textarea' ? 'v-textarea' : 'v-text-field'"
      v-for="field in stepInput.fields"
      :key="field.name"
      auto-grow
      class="studio-ai-sessions__issue-request-input"
      :disabled="page.busy || stepInput.saving"
      :label="field.label"
      :model-value="stepInput.values[field.name] || ''"
      :placeholder="field.placeholder"
      :rows="field.kind === 'textarea' ? 8 : undefined"
      variant="outlined"
      @update:model-value="stepInput.updateValue(field.name, $event)"
    />

    <v-alert
      v-if="stepInput.error"
      type="warning"
      variant="tonal"
      density="compact"
    >
      {{ stepInput.error }}
    </v-alert>

    <div class="studio-ai-sessions__actions">
      <v-btn
        v-if="actions.currentNext?.visible"
        class="studio-ai-sessions__next-step-button"
        color="primary"
        variant="tonal"
        :disabled="page.busy || actions.currentNext.enabled !== true"
        :loading="actions.advanceCommand.isRunning"
        :prepend-icon="mdiArrowRight"
        :title="actions.currentNext.disabledReason || actions.currentNext.label || 'Next step'"
        @click="actions.goNext"
      >
        {{ actions.currentNext.label || "Next step" }}
      </v-btn>

      <v-btn
        color="primary"
        variant="flat"
        :disabled="page.busy || !stepInput.canSubmit"
        :loading="stepInput.saving"
        :prepend-icon="mdiCheck"
        type="submit"
      >
        {{ stepInput.interaction?.submitLabel || "Submit" }}
      </v-btn>

      <Vibe64SessionActionButton
        v-for="action in actions.currentActions"
        :key="action.id"
        :action="action"
        :actions="actions"
        :busy="page.busy"
        variant="tonal"
      />
    </div>
  </form>

  <div v-else class="studio-ai-sessions__actions">
    <v-btn
      v-if="actions.currentNext?.visible"
      class="studio-ai-sessions__next-step-button"
      color="primary"
      variant="tonal"
      :disabled="page.busy || actions.currentNext.enabled !== true"
      :loading="actions.advanceCommand.isRunning"
      :prepend-icon="mdiArrowRight"
      :title="actions.currentNext.disabledReason || actions.currentNext.label || 'Next step'"
      @click="actions.goNext"
    >
      {{ actions.currentNext.label || "Next step" }}
    </v-btn>

    <v-btn
      v-if="review.acceptChangesUtilitiesVisible"
      color="primary"
      variant="flat"
      :disabled="review.diffDisabled"
      :loading="diff.loading"
      :prepend-icon="mdiFileCompare"
      :title="review.diffTitle"
      @click="diff.openDialog"
    >
      Review diff
    </v-btn>

    <Vibe64SessionActionButton
      v-for="action in actions.currentActions"
      :key="action.id"
      :action="action"
      :actions="actions"
      :busy="page.busy"
      variant="flat"
    />
  </div>

  <v-alert
    v-if="actions.actionResultMessage"
    :type="actions.actionResultType"
    variant="tonal"
    density="compact"
    class="studio-ai-sessions__notice"
  >
    {{ actions.actionResultMessage }}
  </v-alert>

  <v-alert
    v-if="actions.currentStepDisabledReason"
    type="info"
    variant="tonal"
    density="compact"
    class="studio-ai-sessions__notice"
  >
    {{ actions.currentStepDisabledReason }}
  </v-alert>

  <p v-if="page.copyStatus" class="text-caption text-medium-emphasis mb-0">
    {{ page.copyStatus }}
  </p>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiArrowRight,
  mdiCheck,
  mdiFileCompare
} from "@mdi/js";
import Vibe64BackgroundTasks from "@/components/studio/vibe64-session/Vibe64BackgroundTasks.vue";
import Vibe64SessionActionButton from "@/components/studio/vibe64-session/Vibe64SessionActionButton.vue";
import {
  useVibe64BackgroundTasks
} from "@/composables/useVibe64BackgroundTasks.js";

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  diff: {
    default: () => ({}),
    type: Object
  },
  page: {
    default: () => ({}),
    type: Object
  },
  review: {
    default: () => ({}),
    type: Object
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  session: {
    default: null,
    type: Object
  },
  stepInput: {
    default: () => ({}),
    type: Object
  }
});

const {
  backgroundTaskError,
  retryBackgroundTask,
  retryingBackgroundTaskId,
  visibleBackgroundTasks
} = useVibe64BackgroundTasks({
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});
</script>

<style scoped>
.studio-ai-sessions__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: flex-start;
}

.studio-ai-sessions__step-input {
  display: grid;
  gap: 0.65rem;
}

.studio-ai-sessions__background-tasks {
  margin-bottom: 0.55rem;
}

.studio-ai-sessions__issue-request-input {
  max-width: 100%;
}

.studio-ai-sessions__notice {
  margin-top: 0.35rem;
}
</style>
