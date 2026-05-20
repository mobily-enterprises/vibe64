<template>
  <form
    class="studio-autopilot__issue-form"
    @submit.prevent="$emit('submit')"
  >
    <v-alert
      v-if="intro"
      type="info"
      variant="tonal"
      density="compact"
    >
      {{ intro }}
    </v-alert>

    <div class="studio-autopilot__questions">
      <div
        v-for="question in questions"
        :key="question.id"
        class="studio-autopilot__question"
      >
        <p>{{ question.text }}</p>
        <v-textarea
          :model-value="question.answer"
          auto-grow
          class="studio-autopilot__issue-input"
          :disabled="disabled"
          label="Your answer"
          rows="2"
          variant="outlined"
          @update:model-value="$emit('answer-change', question.id, $event)"
        />
      </div>
    </div>

    <v-alert
      v-if="failure"
      type="warning"
      variant="tonal"
      density="compact"
    >
      {{ failure }}
    </v-alert>

    <div class="studio-autopilot__actions">
      <v-btn
        color="primary"
        :disabled="!canSubmit"
        :loading="loading"
        :prepend-icon="submitIcon"
        type="submit"
        variant="flat"
      >
        Continue
      </v-btn>

      <v-btn
        :disabled="loading"
        :prepend-icon="cancelIcon"
        type="button"
        variant="tonal"
        @click="$emit('cancel')"
      >
        Cancel
      </v-btn>
    </div>
  </form>
</template>

<script setup>
import {
  mdiClose,
  mdiSend
} from "@mdi/js";

defineEmits(["answer-change", "cancel", "submit"]);

defineProps({
  canSubmit: {
    default: false,
    type: Boolean
  },
  cancelIcon: {
    default: mdiClose,
    type: String
  },
  disabled: {
    default: false,
    type: Boolean
  },
  failure: {
    default: "",
    type: String
  },
  intro: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  questions: {
    default: () => [],
    type: Array
  },
  submitIcon: {
    default: mdiSend,
    type: String
  }
});
</script>

<style scoped>
.studio-autopilot__issue-form {
  display: grid;
  gap: 0.75rem;
  max-width: 44rem;
  width: 100%;
}

.studio-autopilot__issue-input {
  text-align: left;
}

.studio-autopilot__questions {
  display: grid;
  gap: 0.9rem;
}

.studio-autopilot__question {
  display: grid;
  gap: 0.45rem;
  text-align: left;
}

.studio-autopilot__question p {
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.35;
  margin: 0;
}
</style>
