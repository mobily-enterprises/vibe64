<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    transition="dialog-bottom-transition"
    @update:model-value="updateOpen"
  >
    <v-card class="ai-studio-draft-editor">
      <v-toolbar
        border
        color="surface"
        density="comfortable"
      >
        <v-btn
          :disabled="saving"
          :icon="mdiClose"
          :title="closeLabel"
          variant="text"
          @click="updateOpen(false)"
        />
        <v-toolbar-title class="ai-studio-draft-editor__title">
          {{ editorTitle }}
        </v-toolbar-title>
        <v-spacer />
        <v-btn
          color="primary"
          :disabled="saveDisabled"
          :loading="saving"
          :prepend-icon="mdiContentSave"
          variant="flat"
          @click="$emit('save')"
        >
          Save
        </v-btn>
      </v-toolbar>

      <v-card-text class="ai-studio-draft-editor__body">
        <StudioErrorNotice
          v-if="error"
          title="Draft editor needs attention"
          :error="error"
          compact
        />

        <v-progress-linear
          v-if="loading"
          color="primary"
          height="6"
          indeterminate
          rounded
        />

        <div class="ai-studio-draft-editor__fields">
          <template
            v-for="field in normalizedFields"
            :key="field.name"
          >
            <v-text-field
              v-if="field.kind === 'text'"
              :model-value="fieldValue(field.name)"
              :label="field.label"
              variant="outlined"
              :disabled="loading || saving"
              @update:model-value="updateFieldValue(field.name, $event)"
            />

            <v-textarea
              v-else
              :model-value="fieldValue(field.name)"
              :label="field.label"
              variant="outlined"
              auto-grow
              rows="22"
              :disabled="loading || saving"
              @update:model-value="updateFieldValue(field.name, $event)"
            />
          </template>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiClose,
  mdiContentSave
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
  error: {
    type: String,
    default: ""
  },
  fields: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  modelValue: {
    type: Boolean,
    default: false
  },
  saving: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: "Edit draft"
  },
  values: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  "save",
  "update:modelValue",
  "update:values"
]);

function normalizeField(field = {}) {
  const name = String(field?.name || "").trim();
  if (!name) {
    return null;
  }
  const kind = String(field.kind || "textarea").trim();
  return {
    kind: kind === "text" ? "text" : "textarea",
    label: String(field.label || name).trim(),
    name,
    required: field.required !== false
  };
}

const normalizedFields = computed(() => {
  return (Array.isArray(props.fields) ? props.fields : [])
    .map(normalizeField)
    .filter(Boolean);
});
const editorTitle = computed(() => String(props.title || "Edit draft"));
const closeLabel = computed(() => `Close ${editorTitle.value.toLowerCase()}`);
const saveDisabled = computed(() => {
  if (props.loading || props.saving) {
    return true;
  }
  if (normalizedFields.value.length < 1) {
    return true;
  }
  return normalizedFields.value.some((field) => {
    return field.required && !String(props.values?.[field.name] || "").trim();
  });
});

function updateOpen(open) {
  emit("update:modelValue", open === true);
}

function fieldValue(name) {
  return String(props.values?.[name] || "");
}

function updateFieldValue(name, value) {
  emit("update:values", {
    ...(props.values || {}),
    [name]: String(value || "")
  });
}
</script>

<style scoped>
.ai-studio-draft-editor {
  min-width: 0;
}

.ai-studio-draft-editor__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-studio-draft-editor__body {
  display: grid;
  gap: 0.9rem;
  height: 100%;
  min-height: 0;
  padding: 1rem;
}

.ai-studio-draft-editor__fields {
  display: grid;
  gap: 0.8rem;
  margin-inline: auto;
  max-width: 72rem;
  min-width: 0;
  width: 100%;
}

.ai-studio-draft-editor__fields :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.45;
}
</style>
