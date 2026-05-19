<template>
  <form
    v-if="issueRequest.formVisible"
    class="studio-ai-sessions__issue-request"
    @submit.prevent="issueRequest.sendPrompt"
  >
    <v-textarea
      :model-value="issueRequest.text"
      auto-grow
      class="studio-ai-sessions__issue-request-input"
      :disabled="page.busy"
      :error-messages="issueRequest.error ? [issueRequest.error] : []"
      hint="Discuss issue and define scope"
      label="Issue request"
      persistent-hint
      rows="5"
      variant="outlined"
      @update:model-value="emit('update-issue-request-text', $event)"
    />

    <div class="studio-ai-sessions__actions">
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!issueRequest.canSubmit"
        :loading="issueRequest.submitting"
        :prepend-icon="mdiSend"
        :title="issueRequest.submitTitle"
        type="submit"
      >
        Discuss issue
      </v-btn>

      <AiStudioSessionActionButton
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

    <AiStudioSessionActionButton
      v-for="action in actions.currentActions"
      :key="action.id"
      :action="action"
      :actions="actions"
      :busy="page.busy"
      variant="flat"
    />

    <v-btn
      v-if="actions.currentNext?.visible"
      color="primary"
      variant="tonal"
      :disabled="page.busy || actions.currentNext.enabled !== true"
      :loading="actions.advanceCommand.isRunning"
      :prepend-icon="mdiArrowRight"
      :title="actions.currentNext.disabledReason || actions.currentNext.label || 'Next'"
      @click="actions.goNext"
    >
      {{ actions.currentNext.label || "Next" }}
    </v-btn>
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
import {
  mdiArrowRight,
  mdiFileCompare,
  mdiSend
} from "@mdi/js";
import AiStudioSessionActionButton from "@/components/studio/ai-studio-session/AiStudioSessionActionButton.vue";

defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  diff: {
    default: () => ({}),
    type: Object
  },
  issueRequest: {
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
  }
});

const emit = defineEmits(["update-issue-request-text"]);
</script>

<style scoped>
.studio-ai-sessions__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.studio-ai-sessions__issue-request {
  display: grid;
  gap: 0.45rem;
}

.studio-ai-sessions__issue-request-input {
  max-width: 100%;
}

.studio-ai-sessions__notice {
  margin-top: 0.35rem;
}
</style>
