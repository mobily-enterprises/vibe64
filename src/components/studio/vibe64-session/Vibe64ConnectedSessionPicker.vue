<script setup>
import { useVibe64ConnectedSessionChoices } from "@/composables/useVibe64ConnectedSessionChoices.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";

const props = defineProps({
  projectSlug: { type: String, required: true },
  sessionId: { type: String, required: true },
  revision: { type: String, required: true },
  disabled: { type: Boolean, required: true }
});
const emit = defineEmits(["resolved"]);
const { busy, choices, error, finishReplacement, linkSession, pendingRepository, selections } = useVibe64ConnectedSessionChoices({
  projectSlug: () => props.projectSlug,
  sessionId: () => props.sessionId,
  revision: () => props.revision,
  onResolved: () => emit("resolved")
});
</script>

<template>
  <section class="d-flex flex-column ga-4" aria-label="Choose connected sessions" style="overflow-wrap: anywhere">
    <p v-if="error" class="ma-0 text-error" role="alert">{{ error }}</p>
    <div v-for="choice in choices" :key="choice.repository" class="d-flex flex-column ga-2" data-testid="connected-session-choice">
      <p class="ma-0"><strong>{{ choice.name }}</strong> needs a connected session. {{ choice.reason }}</p>
      <template v-if="choice.sessions.length">
        <v-select
          v-model="selections[choice.repository]" density="comfortable" hide-details variant="outlined"
          item-title="sessionName" item-value="sessionId" :disabled="disabled || busy"
          :items="choice.sessions" :label="`Session in ${choice.name}`"
        />
        <p class="ma-0 text-body-small">Linking keeps that session's work. Its Save then goes to a contribution branch for review in {{ choice.name }}'s Incoming changes, not straight to its main branch.</p>
        <v-btn
          color="primary" variant="flat" min-height="48" height="auto"
          :disabled="disabled || busy || !selections[choice.repository]"
          :loading="pendingRepository === choice.repository" @click="linkSession(choice)"
        >
          <span class="text-wrap">Link session</span>
        </v-btn>
      </template>
      <template v-else>
        <p class="ma-0">{{ choice.name }} has no free session: each open one is already linked to a contribution or works on its own branch or pull request. Start a session in {{ choice.name }}, then choose Retry here.</p>
        <v-btn variant="tonal" min-height="48" height="auto" :href="projectAppPath(choice.projectSlug, '/')">
          <span class="text-wrap">Open {{ choice.name }}</span>
        </v-btn>
      </template>
      <v-btn
        v-if="choice.replacementReview" variant="tonal" min-height="48" height="auto" :disabled="disabled || busy"
        @click="finishReplacement(choice)"
      >
        <span class="text-wrap">Finish replacement</span>
      </v-btn>
    </div>
  </section>
</template>
