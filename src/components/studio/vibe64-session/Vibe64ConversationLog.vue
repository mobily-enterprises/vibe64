<template>
  <AssistantConversationElement class="vibe64-conversation-log" :adapter="adapter" v-model:avatar-size="avatarSize">
    <template v-if="voiceBinding && visible && avatarVisible !== null" #avatar="size">
      <component :is="voice.Avatar || VoiceAvatar" v-bind="avatarVisual" :binding="voiceBinding" :size="size.size" :height="size.height" />
    </template>
    <!-- Minimised, Show avatar draws the same face, small and still, so it is not missed. -->
    <template v-if="voiceBinding && visible && avatarVisible !== null" #avatar-thumbnail>
      <span class="vibe64-conversation-log__thumbnail" aria-hidden="true">
        <component :is="voice.Avatar || VoiceAvatar" state="idle" :still="true" :binding="voiceBinding" />
      </span>
    </template>
    <template v-if="voiceBinding && visible && avatarVisible !== null" #avatar-tools>
      <div ref="voiceToolsTarget" class="vibe64-main-conversation__voice-tools" :class="{ 'vibe64-main-conversation__voice-tools--opening': holdingVoice }">
        <v-btn
          v-if="!voiceSession || holdingVoice" :icon="voiceSession?.voice.listening.value && !voiceSession.microphoneMuted.value ? '$mic' : '$micOff'" variant="text" color="primary" width="40" min-width="40" min-height="44"
          :aria-label="holdingVoice ? 'Release to send' : 'Talk'" title="click or long press to talk"
          :aria-pressed="holdingVoice" :disabled="!voiceBinding.available"
          @pointerdown="voiceGesture.pointerDown" @pointerup="voiceGesture.pointerUp"
          @pointercancel="voiceGesture.cancel" @lostpointercapture="voiceGesture.cancel"
          @keydown.space.prevent="voiceGesture.keyDown" @keyup.space.prevent="voiceGesture.keyUp"
          @keydown.enter.prevent="voiceGesture.keyDown" @keyup.enter.prevent="voiceGesture.keyUp"
          @blur="voiceGesture.cancel" @contextmenu.prevent @click="voiceGesture.click"
        >
          <span class="vibe64-main-conversation__voice-disc"><v-icon size="20" :icon="voiceSession?.voice.listening.value && !voiceSession.microphoneMuted.value ? '$mic' : '$micOff'" /></span>
        </v-btn>
        <v-btn
          v-if="!voiceSession || holdingVoice" :icon="readAloud ? '$volumeHigh' : '$volumeOff'" variant="text" color="primary" width="40" min-width="40" min-height="44"
          :aria-pressed="readAloud" :aria-label="readAloud ? 'Turn project agent read-aloud off' : 'Read project agent answers aloud'"
          :title="readAloud ? 'Spoken replies on' : 'Spoken replies off'" :disabled="!voiceBinding.available || readAloudChangePending"
          @click="toggleReadAloud"
        >
          <span class="vibe64-main-conversation__voice-disc"><v-icon size="20" :icon="readAloud ? '$volumeHigh' : '$volumeOff'" /></span>
        </v-btn>
        <VoiceConversationSettings v-if="!voiceSession || holdingVoice" :voice="voiceSession?.voice" compact @error="voice.controller.state.error = $event.message">
          <template v-if="voice.Settings" #default="settings"><component :is="voice.Settings" v-bind="settings" :binding="voiceBinding" /></template>
        </VoiceConversationSettings>
      </div>
    </template>
    <template v-if="voiceSession" #avatar-control="{ size }">
      <span v-if="size === 'hidden' && voiceSession.voice.listening.value && !voiceSession.microphoneMuted.value" role="img" aria-label="Listening" title="Listening" class="d-inline-flex align-center text-primary">
        <v-icon size="20" icon="$mic" />
      </span>
      <span v-if="size === 'hidden' && voiceSession.voice.speaking.value" role="img" aria-label="Speaking" title="Speaking" class="d-inline-flex align-center text-primary">
        <v-icon size="20" icon="$volumeHigh" />
      </span>
    </template>
    <template #system-message="{ message }">
      <Vibe64ProjectMessage v-if="message.projectMessage" :details="message.projectMessage" :at="message.displayAt" />
      <Vibe64ConversationStatus v-else :message="message" @check-delivery="emit('resend-turn', $event)" @link-click="adapter.actions.openLink" />
    </template>
    <template #user-message-actions="{ message, turn }">
      <div
        v-if="turn.metadata?.sender"
        class="vibe64-conversation-log__sender text-label-small"
        :data-approval-id="turn.metadata.sender.approvalId"
      >
        <v-icon icon="$personCheck" size="14" />
        {{ turn.metadata.sender.displayName }} · approved by {{ turn.metadata.sender.approvedBy }}
      </div>
      <v-chip v-if="turn.metadata?.source === 'lesson'" size="x-small" variant="tonal" class="mt-1 align-self-start" data-test="lesson-sent-chip">
        Sent by the lesson
      </v-chip>
      <Vibe64PageLinkCards :text="message.text || ''" @opened="emit('open-page')" />
    </template>
    <template #attachments="{ items }">
      <Vibe64ConversationAttachments :items="items" :session-id="sessionId" />
    </template>
    <template #message-actions="{ message, turn }">
      <v-card v-if="message.integrationRequest" class="mt-3" variant="outlined">
        <v-card-text class="text-break">
          Configure integration: {{ message.integrationRequest.integrationId }}
        </v-card-text>
        <v-card-actions>
          <v-btn
            :disabled="turn.pending || !integrationRequestsEnabled"
            min-height="48"
            @click="emit('open-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup?.requestId, integrationId: message.integrationRequest.integrationId })"
          >
            Configure
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'pending' && integrationConnections[turn.integrationSetup.requestId]?.status !== 'configuration-only'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit('integration-action', { action: integrationConnections[turn.integrationSetup.requestId]?.status === 'pending' ? 'check' : 'connect', sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            {{ integrationConnections[turn.integrationSetup.requestId]?.status === 'pending' ? 'Check connection' : 'Connect' }}
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'completed' && turn.integrationSetup.continuation?.status !== 'accepted'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit('integration-action', { action: 'resume', sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            Check continuation
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'pending'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit('integration-action', { action: 'skip', sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            Skip
          </v-btn>
          <span v-if="turn.integrationSetup?.outcome === 'skipped'" role="status">Skipped</span>
          <span v-if="turn.integrationSetup?.outcome === 'completed'" role="status">Setup completed</span>
        </v-card-actions>
        <v-card-text v-if="turn.integrationSetup?.outcome === 'pending' && integrationConnections[turn.integrationSetup.requestId]" role="status">
          <template v-if="integrationConnections[turn.integrationSetup.requestId].status === 'pending'">
            <a :href="integrationConnections[turn.integrationSetup.requestId].authorizationUrl" target="_blank" rel="noopener noreferrer">Continue with provider</a>
            <v-btn
              :disabled="!integrationRequestsEnabled || Boolean(integrationActionPending)"
              min-height="48"
              @click="emit('integration-action', { action: 'cancel', sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
            >
              Cancel connection
            </v-btn>
          </template>
          <template v-else-if="integrationConnections[turn.integrationSetup.requestId].status === 'configuration-only'">This integration uses public settings and has no account to connect. Choose Configure to edit them and prepare the application's implementation request. Skip dismisses this connection request; it does not verify tracking.</template>
          <template v-else-if="integrationConnections[turn.integrationSetup.requestId].status === 'unconfigured'">Choose Configure to complete the application's setup.</template>
          <template v-else>{{ integrationConnections[turn.integrationSetup.requestId].status }}</template>
        </v-card-text>
        <v-card-text v-if="turn.integrationSetup?.outcome === 'completed'" role="status">
          <template v-if="turn.integrationSetup.continuation?.status === 'accepted'">Assistant continuation accepted.</template>
          <template v-else-if="turn.integrationSetup.continuation?.status === 'sending'">Assistant delivery is not yet confirmed. Check continuation to inspect delivery without sending it again.</template>
          <template v-else>Assistant continuation is pending. Check continuation to resume.</template>
        </v-card-text>
        <v-card-text v-if="integrationActionError?.turnId === turn.turnId" role="alert">
          {{ integrationActionError.message }}
        </v-card-text>
      </v-card>
      <Vibe64PageLinkCards :text="message.text || ''" @opened="emit('open-page')" />
    </template>
    <template v-if="$slots.hints || voiceSession || voiceError" #hints>
      <div v-if="voiceSession && voiceBinding.presentation === 'inline'" v-show="!voice.controller.state.nextTarget">
        <VoiceConversationHost :controller="voice.controller" presentation="inline">
          <template #conversation="{ session, disabled }">
            <VoiceConversationControls :session="session" :disabled="disabled" compact icon-only :tools-target="voiceToolsTarget" :feedback-target="voiceFeedbackTarget" :review-in-transcript="Boolean(voicePreview)">
              <template #settings-control>
                <VoiceConversationSettings :voice="session.voice" compact @error="voice.controller.state.error = $event.message">
                  <template v-if="voice.Settings" #default="settings"><component :is="voice.Settings" v-bind="settings" :binding="voiceBinding" /></template>
                </VoiceConversationSettings>
              </template>
            </VoiceConversationControls>
          </template>
          <template v-if="voice.Settings" #settings="settings"><component :is="voice.Settings" v-bind="settings" /></template>
        </VoiceConversationHost>
      </div>
      <p v-if="voiceError && visible" class="text-body-small text-error" role="alert">{{ voiceError }}</p>
      <slot name="hints" />
    </template>
    <template v-if="$slots.composer" #composer>
      <slot name="composer" :voice-binding="voiceBinding" :composer-blocked="composerBlocked" :show-avatar="showAvatar" :set-voice-feedback-target="setVoiceFeedbackTarget" />
    </template>
  </AssistantConversationElement>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { VoiceAvatar, VoiceConversationControls, VoiceConversationHost, VoiceConversationSettings } from "@jskit-ai/assistant-voice/client";
import { useVibe64Voice } from "@local/vibe64-voice/client";
import { Vibe64PageLinkCards } from "@local/vibe64-pages/client";
import Vibe64ConversationStatus from "./Vibe64ConversationStatus.vue";
import Vibe64ProjectMessage from "./Vibe64ProjectMessage.vue";
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import { usesCommentaryForThinking } from "@/lib/vibe64ThinkingPresentation.js";
import { conversationTurnPresentation } from "@/lib/vibe64ConversationPresentation.js";
import { useVibe64ConversationVoice } from "@/composables/useVibe64ConversationVoice.js";

const props = defineProps({
  voiceRuntime: { type: Object, default: null },
  working: { type: Boolean, default: undefined },
  integrationConnections: { default: () => ({}), type: Object },
  integrationActionPending: { default: null, type: Object },
  integrationActionError: { default: null, type: Object },
  integrationRequestsEnabled: { default: false, type: Boolean },
  sessionId: { default: "", type: String },
  assistantLabel: {
    default: "Codex",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  followLatestKey: {
    default: 0,
    type: [Number, String]
  },
  hasMoreBefore: {
    default: false,
    type: Boolean
  },
  loading: {
    default: false,
    type: Boolean
  },
  loadingMore: {
    default: false,
    type: Boolean
  },
  loadMoreError: {
    default: "",
    type: String
  },
  reloadable: {
    default: false,
    type: Boolean
  },
  errorReloadable: {
    default: false,
    type: Boolean
  },
  reloading: {
    default: false,
    type: Boolean
  },
  scrollKey: {
    default: "",
    type: [Number, String]
  },
  sourceRoot: {
    default: "",
    type: String
  },
  turns: {
    default: () => [],
    type: Array
  },
  variant: {
    default: "main",
    validator: (value) => ["main", "task"].includes(value),
    type: String
  },
  visible: {
    default: false,
    type: Boolean
  },
  welcomeMessage: {
    default: "",
    type: String
  }
});

const emit = defineEmits([
  "cancel-turn",
  "edit-turn",
  "load-more",
  "open-integration",
  // { action: "connect" | "check" | "cancel" | "skip" | "resume", sessionId, turnId, requestId }
  "integration-action",
  "open-source-file",
  // A page card's Open: the page shows beside the chat.
  "open-page",
  "open-plan-history",
  "reload",
  "resend-turn"
]);

const voice = useVibe64Voice();
const voiceToolsTarget = ref(null);
const voiceFeedbackTarget = ref(null);
function setVoiceFeedbackTarget(element) { voiceFeedbackTarget.value = element; }
const {
  avatarSize, avatarVisible, avatarVisual, composerBlocked, holdingVoice, readAloud, readAloudChangePending,
  toggleReadAloud, voiceBinding, voiceError, voiceGesture, voicePreview, voicePreviews, voiceSession, voiceTranscript
} = useVibe64ConversationVoice(props, { readAdapter: () => adapter.value, voice });
watch(() => [props.voiceRuntime, props.visible], ([runtime], [previousRuntime]) => {
  voiceGesture.cancel();
  if (runtime !== previousRuntime) {
    voiceTranscript.value = null;
    voiceError.value = "";
  }
});
defineExpose({ composerBlocked });

// Recover one visible request at a time through the app's read-only status operation.
// Keep consent URLs out of browser persistence; the application owns pending attempts.
let recoverySession = "";
const recoveredRequests = new Set();
watch(() => [props.sessionId, props.visible, props.integrationRequestsEnabled,
  props.integrationActionPending, props.turns], () => {
  const key = props.visible && props.integrationRequestsEnabled ? props.sessionId : "";
  if (key !== recoverySession) {
    recoverySession = key;
    recoveredRequests.clear();
  }
  if (!key || props.integrationActionPending) return;
  const turn = props.turns.find((entry) => !entry.pending && entry.integrationSetup?.outcome === "pending" &&
    !recoveredRequests.has(`${entry.turnId}/${entry.integrationSetup.requestId}`));
  if (!turn) return;
  recoveredRequests.add(`${turn.turnId}/${turn.integrationSetup.requestId}`);
  emit("integration-action", { action: "check", sessionId: key, turnId: turn.turnId, requestId: turn.integrationSetup.requestId });
}, { immediate: true });
const adapter = computed(() => ({
  conversation: {
    cancellableDelivery: true,
    working: props.working && !props.error,
    previewMessage: voicePreview.value, previewMessages: voicePreviews.value,
    assistantLabel: props.assistantLabel,
    error: props.error,
    followLatestKey: props.followLatestKey,
    hasMoreBefore: props.hasMoreBefore,
    loading: props.loading,
    loadingMore: props.loadingMore,
    loadMoreError: props.loadMoreError,
    reloadable: props.reloadable,
    errorReloadable: props.errorReloadable,
    reloading: props.reloading,
    scrollKey: props.scrollKey,
    variant: props.variant,
    visible: props.visible,
    welcomeMessage: props.welcomeMessage,
    progressPreviewLimit: usesCommentaryForThinking(props.turns.at(-1)?.metadata?.assistantSelection) ? 1 : 2,
    turns: props.turns.map((turn) => conversationTurnPresentation(turn))
  },
  actions: {
    loadMore: (value) => emit("load-more", value),
    reload: () => emit("reload"),
    resend: (id) => emit("resend-turn", id),
    checkDelivery: (id) => emit("resend-turn", id),
    cancel: (id) => emit("cancel-turn", id),
    edit: (id) => emit("edit-turn", id),
    openLink(payload) {
      if (payload.href === "#vibe64-plan-history") {
        payload.event.preventDefault();
        emit("open-plan-history");
        return;
      }
      const target = sourceEditorLinkTarget({ href: payload.href, sourceRoot: props.sourceRoot, text: payload.text });
      if (!target) return;
      payload.event.preventDefault();
      emit("open-source-file", target);
    }
  }
}));
</script>

<style scoped>
.vibe64-conversation-log__sender {
  align-items: center;
  align-self: flex-end;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  display: inline-flex;
  gap: 0.25rem;
  margin-top: 0.25rem;
  overflow-wrap: anywhere;
}
/* Chat bubbles follow the M3 chat shape: a tighter corner at the author side. */
:deep(.assistant-transcript__message--assistant) {
  margin-left: 2.15rem;
  max-width: calc(100% - 2.15rem);
  padding: .75rem 1rem;
  border-radius: var(--v64-shape-xs, 4px) var(--v64-shape-lg, 16px) var(--v64-shape-lg, 16px) var(--v64-shape-lg, 16px);
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}
:deep(.assistant-transcript__message--user) {
  border-radius: var(--v64-shape-lg, 16px) var(--v64-shape-xs, 4px) var(--v64-shape-lg, 16px) var(--v64-shape-lg, 16px);
}
/* Progress reads as a quiet timeline under the turn it belongs to. */
:deep(.assistant-transcript__thinking) {
  border-left: 2px solid var(--v64-outline-variant, rgba(0, 0, 0, .12));
  padding: .1rem 0 .1rem .75rem;
}
:deep(.assistant-progress__toggle) {
  border-radius: var(--v64-shape-full, 999px);
  font: var(--v64-type-label-md, 500 .75rem/1rem system-ui, sans-serif);
  margin-left: -.5rem;
  padding: .3rem .6rem;
  transition: background-color var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}
:deep(.assistant-progress__toggle:hover),
:deep(.assistant-progress__toggle:focus-visible) {
  background: rgba(var(--v-theme-primary), var(--v64-state-hover, .08));
  text-decoration: none;
}
/* The newest turn arrives with a short emphasized entrance (off for reduced motion). */
:deep(.assistant-transcript__turn:last-of-type) {
  animation: vibe64-conversation-arrive var(--v64-duration-medium, 300ms) var(--v64-ease-emphasized-decelerate, ease-out) both;
}
:deep(.assistant-transcript__system:has(.vibe64-project-message) > .assistant-transcript__system-icon),
:deep(.assistant-transcript__system:has(.vibe64-project-message) .assistant-transcript__system-meta) { display: none; }
:deep(.assistant-transcript__system:has(.vibe64-project-message) .assistant-transcript__system-body) { width: 100%; }
:deep(.assistant-transcript__system:has(.vibe64-project-message)) { display: block; width: 100%; max-width: none; padding: 0; }
.vibe64-main-conversation__voice-tools { display: flex; align-items: center; gap: 0; }
.vibe64-conversation-log__thumbnail { display: block; width: 28px; height: 28px; }
/* The avatar tools float over the transcript as one M3 toolbar pill. */
:deep(.assistant-conversation__avatar-tools) {
  background: var(--v64-surface-container-high, rgb(var(--v-theme-surface)));
  border-radius: var(--v64-shape-full, 999px);
  box-shadow: var(--v64-elevation-2);
  padding: 0 4px;
}
.vibe64-main-conversation__voice-disc {
  display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%;
  background: var(--v64-primary-container, rgba(var(--v-theme-primary), .12));
  transition: background-color var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease), box-shadow var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}
.vibe64-main-conversation__voice-tools :deep(.v-btn:hover:not(:disabled)) .vibe64-main-conversation__voice-disc { box-shadow: var(--v64-elevation-1); }
.vibe64-main-conversation__voice-tools :deep(.v-btn[aria-pressed="true"]) .vibe64-main-conversation__voice-disc {
  background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary));
}
.vibe64-main-conversation__voice-tools--opening :deep(.assistant-voice-controls__tools) { display: none; }
@keyframes vibe64-conversation-arrive { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) {
  :deep(.assistant-transcript__turn:last-of-type) { animation: none; }
}
</style>
