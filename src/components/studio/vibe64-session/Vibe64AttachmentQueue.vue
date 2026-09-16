<script setup>
import { ref, watch } from "vue";
import { AssistantAttachmentQueue } from "@jskit-ai/assistant-core/client/conversation";
import Vibe64AttachmentDialog from "./Vibe64AttachmentDialog.vue";
defineOptions({ inheritAttrs: false });
const props = defineProps({ sessionId: { type: String, default: "" } });
const selectedAttachment = ref(null);
const queue = ref(null);
watch(() => props.sessionId, () => { selectedAttachment.value = null; });
function focusComposer() {
  const root = queue.value?.$el;
  const container = root?.closest?.(".assistant-prompt-input, .vibe64-terminal-surface") || root?.parentElement;
  const terminalToggle = container?.classList?.contains("vibe64-terminal-surface")
    ? container.querySelector("button[aria-controls^='vibe64-terminal-body-']:not([disabled])") : null;
  (terminalToggle || container?.querySelector?.("textarea:not([disabled]), [contenteditable='true'], button:not([disabled])"))?.focus();
}
</script>
<template>
  <AssistantAttachmentQueue
    ref="queue" v-bind="$attrs" :preview-enabled="Boolean(sessionId)"
    @preview="selectedAttachment = $event" @focus-input="focusComposer"
  />
  <Vibe64AttachmentDialog v-if="selectedAttachment" :attachment="selectedAttachment" :session-id="sessionId" @close="selectedAttachment = null" />
</template>
