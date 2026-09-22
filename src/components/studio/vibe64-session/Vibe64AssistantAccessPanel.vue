<template>
  <section
    v-if="accessError || suggestionsError || pendingSuggestions.length || recentSuggestions.length"
    class="vibe64-assistant-access"
    aria-label="Message requests"
  >
    <div v-if="accessError || suggestionsError" class="vibe64-assistant-access__feedback" role="status">
      <span>{{ accessError || suggestionsError }}</span>
      <v-btn size="small" type="button" variant="text" @click="$emit('reload')">Try again</v-btn>
    </div>
    <template v-if="pendingSuggestions.length">
      <header class="vibe64-assistant-access__heading">
        <strong>{{ canManage ? 'Ready for your approval' : 'Waiting for the owner' }}</strong>
        <span class="text-label-medium">{{ pendingSuggestions.length }} request{{ pendingSuggestions.length === 1 ? '' : 's' }}</span>
      </header>
      <div class="vibe64-assistant-access__items">
        <article v-for="suggestion in pendingSuggestions" :key="suggestion.id" class="vibe64-assistant-access__item">
          <div class="vibe64-assistant-access__author">
            <v-icon :icon="mdiAccountCircleOutline" size="20" />
            <strong>{{ suggestion.author?.displayName || suggestion.author?.username || 'Member' }}</strong>
            <span class="text-label-small text-medium-emphasis">{{ suggestion.status === 'delivering' ? 'Sending to AI…' : 'Message request' }}</span>
          </div>
          <p class="vibe64-assistant-access__message">{{ suggestion.displayMessage || suggestion.message }}</p>
          <Vibe64ConversationAttachments :items="suggestion.displayAttachments || []" :session-id="sessionId" />
          <span v-if="suggestion.attachmentIds?.length && !suggestion.displayAttachments?.length" class="text-label-small text-medium-emphasis">
            {{ suggestion.attachmentIds.length }} attached file{{ suggestion.attachmentIds.length === 1 ? '' : 's' }} will be sent with this request.
          </span>
          <div v-if="suggestion.lastDeliveryError" class="text-body-small" role="status">
            This request hasn’t been sent. {{ suggestion.lastDeliveryError }}
          </div>
          <span v-if="canManage && assistantBusy && suggestion.attachmentIds?.length" class="text-body-small text-medium-emphasis">
            The AI is working. You can send this request with its files when it finishes.
          </span>
          <div class="vibe64-assistant-access__actions">
            <template v-if="canManage">
              <v-btn :disabled="Boolean(pendingAction) || suggestion.status === 'delivering'" size="small" type="button" variant="text" @click="$emit('discard', suggestion.id)">
                Decline
              </v-btn>
              <v-btn
                :loading="actionIsPending('approve', suggestion.id)"
                :disabled="Boolean(pendingAction) || (assistantBusy && Boolean(suggestion.attachmentIds?.length))"
                :prepend-icon="mdiCheck"
                color="primary" size="small" type="button" variant="flat"
                @click="$emit('approve', suggestion.id)"
              >
                {{ suggestion.lastDeliveryError ? 'Retry sending' : suggestion.status === 'delivering' ? 'Check delivery' : 'Approve & send' }}
              </v-btn>
            </template>
            <v-btn v-else :disabled="Boolean(pendingAction) || suggestion.status === 'delivering'" size="small" type="button" variant="text" @click="$emit('withdraw', suggestion.id)">
              Withdraw request
            </v-btn>
          </div>
        </article>
      </div>
    </template>
    <details v-if="recentSuggestions.length" class="vibe64-assistant-access__recent">
      <summary>{{ requestStatusLabels[recentSuggestions[0].status] }} · Recent requests</summary>
      <article v-for="suggestion in recentSuggestions" :key="suggestion.id">
        <strong>{{ suggestion.author?.displayName || suggestion.author?.username }} · {{ requestStatusLabels[suggestion.status] }}</strong>
        <p>{{ suggestion.displayMessage || suggestion.message }}</p>
      </article>
    </details>
    <span class="sr-only" role="status" aria-live="polite">{{ pendingSuggestions.length }} messages waiting for approval.</span>
  </section>
</template>

<script setup>
import { mdiAccountCircleOutline, mdiCheck } from "@mdi/js";
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";

defineProps({
  accessError: { default: "", type: String },
  assistantBusy: { default: false, type: Boolean },
  actionIsPending: { default: () => false, type: Function },
  canManage: { default: false, type: Boolean },
  pendingAction: { default: null, type: Object },
  pendingSuggestions: { default: () => [], type: Array },
  recentSuggestions: { default: () => [], type: Array },
  sessionId: { default: "", type: String },
  suggestionsError: { default: "", type: String }
});
defineEmits(["approve", "discard", "reload", "withdraw"]);
const requestStatusLabels = { delivered: "Approved and sent", discarded: "Declined by owner", withdrawn: "Withdrawn" };
</script>

<style scoped>
.vibe64-assistant-access {
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 0.875rem;
  background: rgba(var(--v-theme-primary), 0.04);
  margin-bottom: 0.65rem;
  min-width: 0;
  overflow: hidden;
}
.vibe64-assistant-access__heading,
.vibe64-assistant-access__feedback {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: space-between;
  padding: 0.65rem 0.8rem;
  font-size: 0.85rem;
}
.vibe64-assistant-access__items { max-height: min(20rem, 35dvh); overflow: auto; }
.vibe64-assistant-access__item {
  display: grid;
  gap: 0.55rem;
  padding: 0.8rem;
  border-top: 1px solid rgba(var(--v-theme-outline), 0.14);
}
.vibe64-assistant-access__author,
.vibe64-assistant-access__actions { align-items: center; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.vibe64-assistant-access__author { font-size: 0.85rem; }
.vibe64-assistant-access__actions { justify-content: flex-end; }
.vibe64-assistant-access__message {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 10rem;
  overflow: auto;
}
.vibe64-assistant-access__recent { padding: 0.65rem 0.8rem; font-size: 0.8rem; }
.vibe64-assistant-access__recent summary { cursor: pointer; }
.vibe64-assistant-access__recent article { margin-top: 0.6rem; }
.vibe64-assistant-access__recent p { margin: 0.15rem 0 0; max-height: 5rem; overflow: auto; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 600px), (pointer: coarse) {
  .vibe64-assistant-access__actions .v-btn { min-height: 2.75rem; }
}
</style>
