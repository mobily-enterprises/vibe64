<script setup>
import { computed, ref, watch } from "vue";
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
const checking = ref(false);
const unavailable = ref("");
watch(() => props.attachment ? url.value : "", async (value, _previous, onCleanup) => {
  unavailable.value = "";
  checking.value = Boolean(value);
  if (!value) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  try {
    const response = await fetch(value, { method: "HEAD", signal: controller.signal });
    if (!response.ok) unavailable.value = response.status === 410
      ? "This attachment is no longer retained. Chat text and the attachment description remain available."
      : "This attachment could not be loaded. Close this preview and try again.";
  } catch {
    if (!controller.signal.aborted) unavailable.value = "This attachment could not be loaded. Close this preview and try again.";
  } finally {
    if (!controller.signal.aborted) checking.value = false;
  }
}, { immediate: true });
</script>
<template>
  <v-dialog v-if="attachment && (checking || unavailable)" :model-value="true" max-width="640" @update:model-value="!$event && emit('close')">
    <v-card :title="attachment.fileName">
      <v-card-text><p role="status">{{ checking ? 'Checking attachment…' : unavailable }}</p></v-card-text>
      <v-card-actions><v-spacer /><v-btn @click="emit('close')">Close</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
  <AssistantAttachmentPreview v-else :attachment="attachment" :download-url="url" :preview-url="imageSupported ? `${url}?inline=1` : ''" @close="emit('close')" />
</template>
