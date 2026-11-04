<template>
  <v-dialog v-model="open" :aria-labelledby="headingId" max-width="28rem">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        :aria-label="WORDS.renameTask(title)"
        class="ai-task-rename"
        data-vibe64-ai-task-rename
        :icon="mdiPencilOutline"
        variant="text"
      />
    </template>
    <v-card data-vibe64-ai-task-rename-dialog rounded="xl">
      <form @submit.prevent="submit">
        <v-card-title class="pa-6 pb-2">
          <h2 :id="headingId" class="text-title-large">{{ WORDS.rename.heading }}</h2>
        </v-card-title>
        <v-card-text class="px-6">
          <v-text-field
            v-model="name"
            autofocus
            :hint="WORDS.rename.hint"
            :label="WORDS.rename.label"
            maxlength="80"
            persistent-hint
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions class="pa-6 pt-2">
          <v-spacer />
          <v-btn height="48" variant="text" @click="open = false">{{ WORDS.actions.cancel }}</v-btn>
          <v-btn color="primary" height="48" rounded="pill" type="submit" variant="flat">{{ WORDS.rename.submit }}</v-btn>
        </v-card-actions>
      </form>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, useId, watch } from "vue";
import { mdiPencilOutline } from "@mdi/js";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";

// The pencil beside a task's name and the small form it opens. Escape and Cancel keep the name; the server
// tidies what Rename sends and gives an empty name back the task's usual one.
const props = defineProps({
  title: {
    required: true,
    type: String
  }
});
const emit = defineEmits(["rename"]);
const headingId = useId();
const open = ref(false);
const name = ref("");

watch(open, (isOpen) => {
  if (isOpen) name.value = props.title;
});

function submit() {
  open.value = false;
  emit("rename", name.value);
}
</script>

<style scoped>
/* A full touch target on coarse pointers, as the window's other controls are. */
.v-btn.ai-task-rename {
  flex: 0 0 auto;
  height: var(--ai-task-target);
  width: var(--ai-task-target);
}
</style>
