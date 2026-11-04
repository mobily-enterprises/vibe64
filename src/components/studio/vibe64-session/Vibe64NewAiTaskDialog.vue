<template>
  <v-dialog
    :model-value="open" max-width="32rem" aria-label="New AI task" scrollable :persistent="aiTasks.starting"
    @update:model-value="!$event && emit('update:open', false)"
  >
    <v-card rounded="xl" data-vibe64-new-ai-task>
      <v-card-title class="text-wrap">New AI task</v-card-title>
      <v-card-text>
        <v-textarea
          v-model="message" label="What should the AI do?" auto-grow rows="3" max-rows="10" autofocus
          :disabled="aiTasks.starting" hide-details="auto"
        />
        <template v-if="mainHasMessages">
          <v-checkbox
            v-model="includeRecentChatContext" :disabled="aiTasks.starting" label="Include recent chat context"
            hide-details class="mt-2"
          />
          <p class="text-body-small mb-0">
            Copies up to 40 recent visible messages from Main chat, text only. Later messages stay separate.
          </p>
        </template>
      </v-card-text>
      <v-card-actions class="flex-wrap ga-2 px-6 pb-5">
        <v-spacer />
        <v-btn height="48" variant="text" :disabled="aiTasks.starting" @click="emit('update:open', false)">Cancel</v-btn>
        <v-btn
          color="primary" variant="flat" height="48" :loading="aiTasks.starting"
          :disabled="!message.trim() || aiTasks.starting" @click="startTask"
        >
          Start
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { inject, ref, watch } from "vue";
import { VIBE64_AI_TASKS_KEY } from "@local/vibe64-ai-tasks/client";

// The session header's New AI task: the person's own request, run in the AI task window. A refusal, such as
// another task still open, keeps the form and what was typed.
const { open, mainHasMessages, opener } = defineProps({
  open: { type: Boolean, required: true },
  // Recent chat context is offered only when Main chat has something to copy.
  mainHasMessages: { type: Boolean, required: true },
  // Where focus returns when the task window hides.
  opener: { type: Function, required: true }
});
const emit = defineEmits(["update:open"]);
const aiTasks = inject(VIBE64_AI_TASKS_KEY);
const message = ref("");
const includeRecentChatContext = ref(false);

watch(() => open, (value) => {
  if (!value) return;
  message.value = "";
  includeRecentChatContext.value = false;
});

async function startTask() {
  const task = await aiTasks.start("free", opener(), {
    message: message.value,
    includeRecentChatContext: mainHasMessages && includeRecentChatContext.value
  });
  if (task) emit("update:open", false);
}
</script>
