<script setup>
import { computed } from "vue";
import { AssistantAttachmentPreview } from "@jskit-ai/assistant-core/client/conversation";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { conversationAttachmentContentType } from "@local/vibe64-runtime/shared";
import { VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID, vibe64AgentAttachmentFilePath } from "@/lib/vibe64SessionRequestConfig.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";

const props = defineProps({
  attachment: { type: Object, default: null },
  sessionId: { type: String, required: true }
});
const emit = defineEmits(["close"]);
const paths = usePaths();
const url = computed(() => resolveStudioRequestUrl(vibe64AgentAttachmentFilePath(
  paths.api(VIBE64_SESSIONS_API_SUFFIX, { surface: VIBE64_SURFACE_ID }),
  props.sessionId, props.attachment?.attachmentId
)));
const imageSupported = computed(() => conversationAttachmentContentType(props.attachment?.fileName).startsWith("image/"));
</script>
<template>
  <AssistantAttachmentPreview :attachment="attachment" :download-url="url" :preview-url="imageSupported ? `${url}?inline=1` : ''" @close="emit('close')" />
</template>
