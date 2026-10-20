<script setup>
import { computed, onMounted, ref } from "vue";
import { VIBE64_LEARNING_NOTES_MAX } from "@/lib/vibe64Learning.js";
import Vibe64LearningMarkdown from "./Vibe64LearningMarkdown.vue";

// "What my teacher knows about me" (contract C7): Colleague's private summary
// of this learner. Only this signed-in learner reads it here; editing and
// clearing go through the learner-notes actions. It never affects results.
const props = defineProps({
  learning: { type: Object, required: true }
});
const notes = computed(() => props.learning.notes.value);
const status = computed(() => props.learning.notesState);
const editing = ref(false);
const confirmingClear = ref(false);
const draft = ref("");
const updated = computed(() => {
  const value = notes.value;
  if (!value?.updatedAt) return "";
  const when = new Date(value.updatedAt);
  const date = Number.isNaN(when.getTime()) ? "" : when.toLocaleString();
  return `${value.updatedBy === "colleague" ? "Updated by Colleague" : "Updated by you"}${date ? `, ${date}` : ""}`;
});

onMounted(() => { if (!props.learning.notes.value) void props.learning.readNotes(); });

function edit() {
  draft.value = notes.value?.text || "";
  confirmingClear.value = false;
  editing.value = true;
}
async function save() {
  const result = await props.learning.saveNotes(draft.value);
  if (result) editing.value = false;
}
async function clear() {
  const result = await props.learning.clearNotes();
  if (result) {
    confirmingClear.value = false;
    editing.value = false;
  }
}
</script>

<template>
  <section class="vibe64-teacher-notes" aria-labelledby="vibe64-teacher-notes-title" :aria-busy="status.loading || status.saving"
    data-test="teacher-notes">
    <h2 id="vibe64-teacher-notes-title" class="vibe64-teacher-notes__title">What my teacher knows about me</h2>
    <p class="vibe64-teacher-notes__intro">
      Colleague keeps a short private summary of how you learn, so it can teach you better. Only you can see it,
      and it never changes your lesson results.
    </p>
    <v-alert v-if="status.error" type="error" variant="tonal" density="compact" class="vibe64-teacher-notes__error"
      data-test="teacher-notes-error">{{ status.error }}</v-alert>
    <template v-if="editing">
      <v-textarea v-model="draft" label="Your notes (Markdown)" variant="outlined" rows="8" auto-grow
        :counter="VIBE64_LEARNING_NOTES_MAX" :maxlength="VIBE64_LEARNING_NOTES_MAX" :disabled="status.saving"
        data-test="teacher-notes-draft" />
      <div class="vibe64-teacher-notes__actions">
        <v-btn color="primary" variant="flat" rounded="pill" min-height="48" :loading="status.saving"
          :disabled="status.saving || !draft.trim()" data-test="teacher-notes-save" @click="save">Save</v-btn>
        <v-btn variant="text" rounded="pill" min-height="48" :disabled="status.saving" data-test="teacher-notes-cancel"
          @click="editing = false">Cancel</v-btn>
      </div>
    </template>
    <template v-else>
      <Vibe64LearningMarkdown v-if="notes?.text" class="vibe64-teacher-notes__text" :text="notes.text" />
      <p v-else-if="!status.loading" class="vibe64-teacher-notes__empty" data-test="teacher-notes-empty">
        Nothing yet. Colleague adds notes as it teaches you.
      </p>
      <p v-if="notes?.text && updated" class="vibe64-teacher-notes__updated">{{ updated }}</p>
      <div class="vibe64-teacher-notes__actions">
        <v-btn variant="tonal" rounded="pill" min-height="48" :disabled="status.loading || status.saving"
          data-test="teacher-notes-edit" @click="edit">{{ notes?.text ? "Edit" : "Write notes" }}</v-btn>
        <template v-if="notes?.text">
          <v-btn v-if="!confirmingClear" variant="text" rounded="pill" min-height="48" :disabled="status.saving"
            data-test="teacher-notes-clear" @click="confirmingClear = true">Clear</v-btn>
          <template v-else>
            <v-btn color="error" variant="flat" rounded="pill" min-height="48" :loading="status.saving" :disabled="status.saving"
              data-test="teacher-notes-clear-confirm" @click="clear">Clear all notes</v-btn>
            <v-btn variant="text" rounded="pill" min-height="48" :disabled="status.saving" data-test="teacher-notes-clear-cancel"
              @click="confirmingClear = false">Keep them</v-btn>
          </template>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.vibe64-teacher-notes {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  margin: var(--v64-space-4, 16px) auto 0;
  max-width: 48rem;
  padding: var(--v64-space-4, 16px);
}
.vibe64-teacher-notes__title { font: var(--v64-type-title-md, 600 1.125rem/1.5rem system-ui, sans-serif); margin: 0 0 4px; }
.vibe64-teacher-notes__intro, .vibe64-teacher-notes__updated, .vibe64-teacher-notes__empty {
  color: rgba(var(--v-theme-on-background), 0.72);
  font-size: 0.875rem;
  margin: 0 0 var(--v64-space-2, 8px);
}
.vibe64-teacher-notes__error { margin-bottom: var(--v64-space-2, 8px); }
.vibe64-teacher-notes__actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-2, 8px); }
.vibe64-teacher-notes__actions :deep(.v-btn) { letter-spacing: 0; text-transform: none; }
</style>
