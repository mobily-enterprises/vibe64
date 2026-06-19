<template>
  <v-dialog
    :model-value="input.open"
    max-width="520"
    persistent
    @update:model-value="updateOpen"
  >
    <v-card>
      <v-card-title>{{ input.title }}</v-card-title>
      <v-card-text class="studio-ai-session-input-dialog__body">
        <StudioErrorNotice
          v-if="input.error"
          title="Action needs attention"
          :error="input.error"
          compact
        />

        <template
          v-for="field in input.fields"
          :key="field.name"
        >
          <v-textarea
            v-if="field.kind === 'textarea' && !inputFieldIsPrivate(field)"
            :model-value="input.values[field.name]"
            auto-grow
            :disabled="input.submitting"
            :label="field.label"
            :placeholder="field.placeholder || undefined"
            rows="5"
            variant="outlined"
            @update:model-value="updateField(field.name, $event)"
          />
          <v-text-field
            v-else
            :model-value="input.values[field.name]"
            :autocomplete="field.autocomplete || (inputFieldIsPrivate(field) ? 'off' : undefined)"
            :disabled="input.submitting"
            :label="field.label"
            :placeholder="field.placeholder || undefined"
            :type="inputFieldIsPrivate(field) ? 'password' : 'text'"
            variant="outlined"
            @update:model-value="updateField(field.name, $event)"
          />
        </template>
      </v-card-text>
      <v-card-actions class="studio-ai-session-input-dialog__actions">
        <v-btn
          variant="text"
          :disabled="input.submitting"
          @click="input.close"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="input.saveDisabled"
          :loading="input.submitting"
          @click="input.submit"
        >
          Continue
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  actionInputFieldIsPrivate
} from "@/lib/vibe64ActionInputModel.js";

const props = defineProps({
  input: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["update-values"]);

function updateOpen(open) {
  if (open !== true) {
    props.input.close();
  }
}

function updateField(name, value) {
  emit("update-values", {
    ...(props.input.values || {}),
    [name]: String(value || "")
  });
}

function inputFieldIsPrivate(field = {}) {
  return actionInputFieldIsPrivate(field);
}
</script>

<style scoped>
.studio-ai-session-input-dialog__body {
  display: grid;
  gap: 0.75rem;
}

.studio-ai-session-input-dialog__actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}
</style>
