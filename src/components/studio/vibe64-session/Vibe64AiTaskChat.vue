<template>
  <div class="ai-task-chat">
    <p v-if="!task" class="ai-task-chat__loading" role="status">{{ conversation.loadError.value || WORDS.chat.loading }}</p>
    <AssistantConversationElement v-else :adapter="transcript">
      <template #attachments="{ items }">
        <Vibe64ConversationAttachments :items="items" :session-id="sessionId" />
      </template>
      <template #system-message="{ message }">
        <Vibe64ConversationStatus :message="message" @check-delivery="resend" />
      </template>
      <template #hints>
        <div v-if="conversation.error.value || conversation.activityLabel.value" class="ai-task-chat__feedback">
          <p v-if="conversation.error.value" class="ai-task-chat__error" role="alert">{{ conversation.error.value }}</p>
          <AssistantComposerSupport
            v-if="conversation.activityLabel.value"
            :activity="{ label: conversation.activityLabel.value }"
          />
        </div>
      </template>
      <template v-if="projection.ended" #composer>
        <p class="ai-task-chat__ended">{{ WORDS.chat.ended }}</p>
      </template>
      <template v-else #composer>
        <p v-if="task.draftSaveState === 'failed'" class="text-body-small" role="status" aria-live="polite">{{ WORDS.chat.draftFailed }}</p>
        <Vibe64AutopilotPromptTextarea
          ref="prompt"
          :aria-label="WORDS.chat.composerLabel"
          attachments-owned-by-conversation
          :attachments-enabled="!conversation.inputDisabled.value"
          class="ai-task-chat__composer"
          density="compact"
          :disabled="conversation.inputDisabled.value"
          :model-value="task.draft"
          :placeholder="projection.composerHint"
          :rows="2"
          :saved-attachments="task.attachments"
          :session-id="sessionId"
          tab-to-submit
          @attachments-change="conversation.updateAttachments"
          @blur="conversation.typingPresence.blur()"
          @input-activity="conversation.typingPresence.noteInputActivity()"
          @submit="conversation.send(prompt)"
          @tab-to-submit="focusSend"
          @update:model-value="conversation.updateDraft"
        >
          <template #footer="{ attachmentState }">
            <div class="ai-task-chat__composer-actions">
              <Vibe64ChatModeControls
                :active="task.busy"
                :can-configure="canConfigureRouting"
                :disabled="conversation.inputDisabled.value"
                :goal="task.goal"
                :loading="!task.purposes"
                :purposes="task.purposes"
                required-mode="fix"
                :save-preferences="conversation.updateRouting"
                :session="conversation.modeSession.value"
                temporary
                @custom="customTarget = $event; customOpen = true"
              />
              <v-btn
                aria-label="Attach files"
                :disabled="conversation.inputDisabled.value || !attachmentState.canAddFiles"
                icon="$attachFile"
                size="small"
                title="Attach files"
                type="button"
                variant="text"
                @click="prompt.openFilePicker()"
              />
              <v-btn
                v-if="previewAttachmentState.captureAvailable"
                aria-label="Attach preview screenshot"
                :aria-busy="previewAttachmentState.captureBusy ? 'true' : undefined"
                :disabled="conversation.inputDisabled.value || !attachmentState.canAddFiles || previewAttachmentState.captureBusy"
                icon="$photoCamera"
                size="small"
                title="Attach preview screenshot"
                variant="text"
                @click="previewAttachmentState.capture()"
              />
              <v-btn
                v-if="previewAttachmentState.diagnosticsAvailable"
                aria-label="Attach console and network diagnostics"
                :aria-busy="previewAttachmentState.diagnosticsBusy ? 'true' : undefined"
                :disabled="conversation.inputDisabled.value || !attachmentState.canAddFiles || previewAttachmentState.diagnosticsBusy"
                icon="$lan"
                size="small"
                title="Attach console and network diagnostics"
                variant="text"
                @click="previewAttachmentState.attachDiagnostics()"
              />
              <Vibe64AgentSettingsMenu
                v-if="!task.routingMetadata?.assistant_routing"
                :agent-settings="task.agentSettings"
                :assistant-selection="task.assistantSelection || assistantSelection"
                :disabled="conversation.inputDisabled.value"
                @update-setting="conversation.updateAgentSetting"
              />
              <Vibe64ComposerDelivery
                ref="sendButton"
                :can-submit="!connectionUnavailable && !conversation.stopping.value && !conversation.inputDisabled.value &&
                  Boolean(task.draft.trim()) && attachmentState.canSubmit"
                :sending="task.delivery.state.sending"
                :stop-enabled="Boolean(task.conversationId) && !conversation.stopping.value"
                :stop-visible="task.busy"
                :stopping="conversation.stopping.value"
                :submit-aria-label="task.busy ? 'Steer assistant' : 'Send message'"
                :submit-mode="task.busy ? 'steer' : 'send'"
                :submit-title="task.busy ? 'Send this guidance to the active assistant turn' : 'Send message'"
                @stop="conversation.stop()"
                @submit="conversation.send(prompt)"
              />
            </div>
          </template>
        </Vibe64AutopilotPromptTextarea>
      </template>
    </AssistantConversationElement>
    <Vibe64SessionAssistantMenu
      v-if="task && !projection.ended"
      v-model="customOpen"
      :can-configure="canConfigureRouting"
      :changes-disabled="conversation.inputDisabled.value"
      :save-selection="selection => conversation.updateRouting({ mode: 'custom', review: false, override: selection })"
      :session="conversation.modeSession.value"
      :target="customTarget"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AssistantComposerSupport, AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { aiTaskTranscript } from "@/lib/vibe64AiTaskConversation.js";
import Vibe64AgentSettingsMenu from "./Vibe64AgentSettingsMenu.vue";
import Vibe64AutopilotPromptTextarea from "./Vibe64AutopilotPromptTextarea.vue";
import Vibe64ChatModeControls from "./Vibe64ChatModeControls.vue";
import Vibe64ComposerDelivery from "./Vibe64ComposerDelivery.vue";
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";
import Vibe64ConversationStatus from "./Vibe64ConversationStatus.vue";
import Vibe64SessionAssistantMenu from "./Vibe64SessionAssistantMenu.vue";

const props = defineProps({
  // What useAiTaskConversation returned.
  conversation: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/types.js").AiTaskConversation>} */ (Object)
  },
  projection: {
    required: true,
    type: Object
  },
  sessionId: {
    required: true,
    type: String
  },
  // Whether the window shows this chat now.
  visible: {
    required: true,
    type: Boolean
  },
  assistantSelection: {
    required: true,
    type: Object
  },
  canConfigureRouting: {
    required: true,
    type: Boolean
  },
  connectionUnavailable: {
    required: true,
    type: Boolean
  },
  previewAttachmentState: {
    required: true,
    type: /** @type {import("vue").PropType<{
      attachDiagnostics: () => void,
      capture: () => void,
      captureAvailable: boolean,
      captureBusy: boolean,
      diagnosticsAvailable: boolean,
      diagnosticsBusy: boolean
    }>} */ (Object)
  }
});

const WORDS = {
  chat: {
    composerLabel: "Message the AI",
    draftFailed: "Draft not saved; check the error and retry.",
    ended: "This conversation has ended.",
    loading: "Loading the conversation…"
  }
};
// composer: the composer that takes preview screenshots and diagnostics while this chat is shown, or null.
const emit = defineEmits(["composer"]);
const task = computed(() => props.conversation.task.value);
const prompt = ref(null);
const transcript = computed(() => task.value && aiTaskTranscript(task.value.adapter, {
  routingRequest: props.conversation.routingRequest.value,
  working: task.value.nativeWorking,
  scrollKey: task.value.id,
  actions: { resend, cancel: props.conversation.cancelMessage, edit: props.conversation.editMessage }
}));
const sendButton = ref(null);
const customOpen = ref(false);
const customTarget = ref(null);

/** @param {string} messageId the failed or unconfirmed message to send again with its own id */
function resend(messageId) {
  void props.conversation.send(prompt.value, { retryMessageId: messageId });
}

watch([() => props.visible, prompt], ([visible, composer]) => emit("composer", visible ? composer : null), { immediate: true });
onBeforeUnmount(() => emit("composer", null));

// The dialog's focus trap reads this same Tab key after us, and would wrap Send, its last control, to the top.
function focusSend() {
  setTimeout(() => sendButton.value?.focus());
}
</script>

<style scoped>
.ai-task-chat {
  container-name: studio-chat-pane;
  container-type: inline-size;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.ai-task-chat__ended {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875rem;
  margin: 0;
  padding: 0.5rem 1rem;
  text-align: center;
}

.ai-task-chat__loading {
  align-self: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  justify-self: center;
  margin: 0;
}

.ai-task-chat__composer {
  flex: 0 0 auto;
  margin: 0 auto 0.5rem;
  width: calc(100% - 1rem);
}

.ai-task-chat__composer-actions {
  align-items: center;
  display: flex;
  gap: 0.25rem;
  min-width: 0;
  width: 100%;
}

.ai-task-chat__feedback {
  flex: 0 0 auto;
  max-height: min(12dvh, 6rem);
  min-width: 0;
  overflow-y: auto;
}

.ai-task-chat__error {
  color: rgb(var(--v-theme-error));
  font-size: 0.82rem;
  margin: 0;
  padding: 0.3rem 0.55rem;
}
</style>
