<script setup>
import { computed, ref, watch } from "vue";
import { AssistantMessageAttachments } from "@jskit-ai/assistant-core/client/conversation";
import { normalizeVibe64ConversationAttachments } from "@local/vibe64-runtime/shared";
import Vibe64AttachmentDialog from "./Vibe64AttachmentDialog.vue";
const props = defineProps({ sessionId: { type: String, default: "" }, items: { type: Array, default: () => [] } });
const attachments = computed(() => normalizeVibe64ConversationAttachments(props.items));
const selectedAttachment = ref(null);
watch(() => props.sessionId, () => { selectedAttachment.value = null; });
</script>
<template>
  <AssistantMessageAttachments
    :attachments="attachments" :preview-enabled="Boolean(sessionId)"
    @preview="$event.attachmentId && (selectedAttachment = $event)"
  />
  <Vibe64AttachmentDialog v-if="selectedAttachment" :attachment="selectedAttachment" :session-id="sessionId" @close="selectedAttachment = null" />
</template>
