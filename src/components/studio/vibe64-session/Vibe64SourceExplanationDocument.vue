<template>
  <section class="source-explanation-document" :aria-busy="busy || closing" aria-label="Generated explanation">
    <LongTextPreviewBlocks v-if="documentBody" :blocks="documentBlocks" @link-click="emit('link-click', $event)" />
    <div v-if="busy || closing" class="source-explanation-document__progress" role="status">
      <span>{{ closing ? 'Stopping…' : 'Generating explanation…' }}</span>
      <v-btn v-if="!closing" size="small" variant="text" @click="emit('stop')">Stop</v-btn>
    </div>
    <details v-if="busy && documentProgress" class="source-explanation-document__activity" open>
      <summary>Progress</summary>
      <LongTextPreviewBlocks :blocks="parseLongTextReviewBlocks(documentProgress)" @link-click="emit('link-click', $event)" />
    </details>
    <div v-else-if="!busy && !closing && ['failed', 'stopped'].includes(explanation.status)" class="source-explanation-document__progress" role="status">
      <span>{{ explanation.status === 'stopped' ? 'Generation stopped.' : documentFailure || 'Generation failed.' }}</span>
      <v-btn size="small" variant="text" :disabled="!assistantAvailable" @click="emit('retry')">Retry</v-btn>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";
import { sourceExplanationMessages } from "@/lib/vibe64SourceExplanationDisplay.js";

// An explanation read as a document inside the file's Interface: the saved
// answer, the generation's progress with Stop, and Retry after it stops or fails.
const props = defineProps({
  assistantAvailable: { type: Boolean, default: true },
  busy: { type: Boolean, default: false },
  closing: { type: Boolean, default: false },
  explanation: { type: Object, required: true },
  savedBody: { type: String, default: "" }
});
const emit = defineEmits(["link-click", "retry", "stop"]);

const messages = computed(() => sourceExplanationMessages(props.explanation));
// The document reader uses the saved answer, not the conversation transcript.
const documentBody = computed(() => props.explanation?.body || props.savedBody || messages.value.findLast(message => message.role === 'assistant' && message.status === 'complete')?.text || '');
const documentBlocks = computed(() => parseLongTextReviewBlocks(documentBody.value));
const documentProgress = computed(() => messages.value.findLast(message => message.role === 'assistant' && message.status === 'thinking')?.text || '');
const documentFailure = computed(() => messages.value.findLast(message => message.role === 'assistant' && message.status === 'failed')?.text || '');
</script>

<style scoped>
.source-explanation-document { min-width: 0; font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; }
.source-explanation-document :deep(p), .source-explanation-document :deep(ul), .source-explanation-document :deep(ol) { margin: 0 0 .7em; }
.source-explanation-document :deep(h2), .source-explanation-document :deep(h3), .source-explanation-document :deep(h4) { font-size: 14px; margin: 1em 0 .3em; }
.source-explanation-document :deep(pre) { overflow: auto; font-size: 12px; line-height: 1.65; }
.source-explanation-document__progress { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; color: rgba(var(--v-theme-on-surface), .72); }
.source-explanation-document__activity { font-size: 12px; color: rgba(var(--v-theme-on-surface), .72); }
.source-explanation-document__activity summary { cursor: pointer; }
</style>
