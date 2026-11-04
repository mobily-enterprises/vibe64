<template>
  <slot />
  <template v-if="host.task">
    <Vibe64AiTaskWindow :commentary="commentary" :output="Boolean(checkOutput)" :source="host">
      <template #check-output><pre class="ai-task-host__output">{{ checkOutput }}</pre></template>
      <template #chat>
        <Vibe64AiTaskChat
          :assistant-selection="assistantSelection"
          :can-configure-routing="canConfigureRouting"
          :connection-unavailable="connectionUnavailable"
          :conversation="conversation"
          :preview-attachment-state="previewAttachmentState"
          :projection="host.projection"
          :session-id="sessionId"
        />
      </template>
    </Vibe64AiTaskWindow>
    <Teleport v-if="trayTarget && viewProps.active" :to="trayTarget">
      <Vibe64AiTaskTray />
    </Teleport>
  </template>
  <v-snackbar
    :model-value="Boolean(host.toast)"
    location="bottom"
    :timeout="8000"
    @update:model-value="host.toast = null"
  >
    <span data-vibe64-ai-task-toast>{{ host.toast?.text }}</span>
    <template v-if="host.toast?.action" #actions>
      <v-btn data-vibe64-ai-task-see-result variant="text" @click="host.seeToastResult()">See result</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup>
import { computed, inject, provide } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAiTaskHost, VIBE64_AI_TASKS_KEY, Vibe64AiTaskTray, Vibe64AiTaskWindow } from "@local/vibe64-ai-tasks/client";
import { useAiTaskConversation } from "@/composables/useAiTaskConversation.js";
import { VIBE64_AI_TASK_TRAY_KEY } from "@/lib/vibe64AssistantHost.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { temporaryAiRequest } from "@/lib/vibe64TemporaryAiTasks.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import Vibe64AiTaskChat from "./Vibe64AiTaskChat.vue";

// Holds a session's AI task: the window, the tray and what its Fix it with AI buttons reach.
const { view } = defineProps({
  // The Autopilot view's state and actions. It is never replaced, so its members are read once.
  view: {
    required: true,
    type: Object
  }
});
/** @type {import("@/composables/useVibe64AutopilotView.js").Vibe64AutopilotViewParts} */
const {
  assistantCanConfigureRouting, connectionRecoveryVisible, mainChat, previewAttachmentState: attachmentState,
  projectSlug, props: viewProps, reviewResolvedUpdate, sessionId: sessionIdRef
} = view;

const trayTarget = /** @type {import("vue").ShallowRef<HTMLElement | null>} */ (inject(VIBE64_AI_TASK_TRAY_KEY));
const sessionId = computed(() => sessionIdRef.value);
const sessionsApiPath = computed(() => readRefOrGetterValue(viewProps.sessionsApiPath));
const enabled = computed(() => Boolean(sessionId.value) && !viewProps.sessionSelectionArchived);
const host = useAiTaskHost({
  sessionId,
  sessionsApiPath,
  projectSlug,
  enabled,
  active: () => viewProps.active,
  request: temporaryAiRequest,
  route: useRoute(),
  router: useRouter(),
  openAiSetup: () => requestVibe64AccountConnectionsDialog({}),
  reviewResolved: () => reviewResolvedUpdate(),
  fallbackFocus: () => mainChat.value
});
provide(VIBE64_AI_TASKS_KEY, host);

const assistantSelection = computed(() => viewProps.session?.assistantSelection || {});
const canConfigureRouting = computed(() => assistantCanConfigureRouting.value);
const connectionUnavailable = computed(() => connectionRecoveryVisible.value);
const previewAttachmentState = computed(() => attachmentState.value);
const conversation = useAiTaskConversation({
  taskId: () => host.task?.id || "",
  sessionId,
  sessionsApiPath,
  projectSlug,
  assistantSelection,
  assistantReady: enabled,
  windowOpen: () => host.open,
  composerOpen: () => host.projection?.composerOpen === true,
  connectionUnavailable
});
const commentary = computed(() => (conversation.task.value?.messages || [])
  .filter(({ role, text }) => role === "commentary" && text?.trim())
  .map(({ at, text }) => ({ at, text: text.trim() })));
// What the check's own run printed, read where that run reports it to the page anyway.
const checkOutput = computed(() => {
  const kind = host.task?.kind;
  if (kind === "workspace-setup") return String(viewProps.session?.workspaceSetup?.transcript || "").trim();
  const operation = { save: viewProps.workState?.operation, update: viewProps.workState?.updateOperation }[kind];
  return (operation?.events || [])
    .map(event => String(event.message || "").trim())
    .filter(Boolean)
    .join("\n");
});
</script>

<style scoped>
.ai-task-host__output {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  margin: 0;
  max-height: 12rem;
  overflow: auto;
  padding: 0.625rem 0.75rem;
  white-space: pre-wrap;
}
</style>
