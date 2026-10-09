<template>
  <AssistantConversationElement :adapter="adapter" v-model:avatar-size="avatarSize">
    <template v-if="voiceBinding && visible" #avatar="size">
      <component :is="voice.Avatar || VoiceAvatar" v-bind="avatarVisual" :binding="voiceBinding" :size="size.size" :height="size.height" />
    </template>
    <template v-if="voiceBinding && visible" #avatar-tools>
      <div ref="voiceToolsTarget" class="vibe64-main-conversation__voice-tools" :class="{ 'vibe64-main-conversation__voice-tools--opening': holdingVoice }">
        <v-btn
          v-if="!voiceSession || holdingVoice" :icon="voiceSession?.voice.listening.value && !voiceSession.microphoneMuted.value ? mdiMicrophone : mdiMicrophoneOff" variant="text" color="primary" width="40" min-width="40" min-height="44"
          :aria-label="holdingVoice ? 'Release to send' : 'Talk'" title="click or long press to talk"
          :aria-pressed="holdingVoice" :disabled="!voiceBinding.available"
          @pointerdown="voiceGesture.pointerDown" @pointerup="voiceGesture.pointerUp"
          @pointercancel="voiceGesture.cancel" @lostpointercapture="voiceGesture.cancel"
          @keydown.space.prevent="voiceGesture.keyDown" @keyup.space.prevent="voiceGesture.keyUp"
          @keydown.enter.prevent="voiceGesture.keyDown" @keyup.enter.prevent="voiceGesture.keyUp"
          @blur="voiceGesture.cancel" @contextmenu.prevent @click="voiceGesture.click"
        >
          <span class="vibe64-main-conversation__voice-disc"><v-icon size="20" :icon="voiceSession?.voice.listening.value && !voiceSession.microphoneMuted.value ? mdiMicrophone : mdiMicrophoneOff" /></span>
        </v-btn>
        <v-btn
          v-if="!voiceSession || holdingVoice" :icon="readAloud ? mdiVolumeHigh : mdiVolumeOff" variant="text" color="primary" width="40" min-width="40" min-height="44"
          :aria-pressed="readAloud" :aria-label="readAloud ? 'Turn project agent read-aloud off' : 'Read project agent answers aloud'"
          :title="readAloud ? 'Spoken replies on' : 'Spoken replies off'" :disabled="!voiceBinding.available || readAloudChangePending"
          @click="toggleReadAloud"
        >
          <span class="vibe64-main-conversation__voice-disc"><v-icon size="20" :icon="readAloud ? mdiVolumeHigh : mdiVolumeOff" /></span>
        </v-btn>
        <VoiceConversationSettings v-if="!voiceSession || holdingVoice" :voice="voiceSession?.voice" compact @error="voice.controller.state.error = $event.message">
          <template v-if="voice.Settings" #default="settings"><component :is="voice.Settings" v-bind="settings" :binding="voiceBinding" /></template>
        </VoiceConversationSettings>
      </div>
    </template>
    <template v-if="voiceSession" #avatar-control="{ size }">
      <span v-if="size === 'hidden' && voiceSession.voice.listening.value && !voiceSession.microphoneMuted.value" role="img" aria-label="Listening" title="Listening" class="d-inline-flex align-center text-primary">
        <v-icon size="20" :icon="mdiMicrophone" />
      </span>
      <span v-if="size === 'hidden' && voiceSession.voice.speaking.value" role="img" aria-label="Speaking" title="Speaking" class="d-inline-flex align-center text-primary">
        <v-icon size="20" :icon="mdiVolumeHigh" />
      </span>
    </template>
    <template #system-message="{ message }">
      <Vibe64ConversationStatus :message="message" @check-delivery="emit('resend-turn', $event)" @link-click="adapter.actions.openLink" />
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
            @click="emit(integrationConnections[turn.integrationSetup.requestId]?.status === 'pending' ? 'check-integration' : 'connect-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            {{ integrationConnections[turn.integrationSetup.requestId]?.status === 'pending' ? 'Check connection' : 'Connect' }}
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'completed' && turn.integrationSetup.continuation?.status !== 'accepted'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit('resume-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            Check continuation
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'pending'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit('skip-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
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
              @click="emit('cancel-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
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
import { assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { VoiceAvatar, VoiceConversationControls, VoiceConversationHost, VoiceConversationSettings, useVoiceLauncher } from "@jskit-ai/assistant-voice/client";
import { createProjectVoiceBinding, useVibe64Voice } from "@local/vibe64-voice/client";
import { mdiMicrophone, mdiMicrophoneOff, mdiVolumeHigh, mdiVolumeOff } from "@mdi/js";
import Vibe64ConversationStatus from "./Vibe64ConversationStatus.vue";
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import { thinkingMessagePresentation, usesCommentaryForThinking } from "@/lib/vibe64ThinkingPresentation.js";
import { parseIntegrationSetupRequest, vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";

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
  "skip-integration",
  "resume-integration",
  "connect-integration",
  "check-integration",
  "cancel-integration",
  "open-source-file",
  "open-plan-history",
  "reload",
  "resend-turn"
]);

const voice = useVibe64Voice();
const mounted = ref(true);
const avatarSize = ref("compact");
const voiceError = ref("");
const voiceToolsTarget = ref(null);
const voiceFeedbackTarget = ref(null);
const voiceTranscript = ref(null);
const pageVisible = ref(globalThis.document?.visibilityState !== "hidden");
function updatePageVisibility() { pageVisible.value = globalThis.document?.visibilityState !== "hidden"; }
globalThis.document?.addEventListener("visibilitychange", updatePageVisibility);
function setVoiceFeedbackTarget(element) { voiceFeedbackTarget.value = element; }
const voiceBinding = computed(() => {
  const runtime = props.voiceRuntime;
  if (!voice || !runtime) return null;
  return createProjectVoiceBinding(runtime, {
    get eligible() { return mounted.value && props.visible && props.voiceRuntime === runtime && pageVisible.value; },
    onTranscript(transcript, { canTake = false } = {}) {
      if (mounted.value && props.voiceRuntime === runtime) voiceTranscript.value = transcript ? { ...transcript, canTake } : null;
    },
    get adapter() { return mounted.value && props.visible && props.voiceRuntime === runtime ? adapter.value : null; },
    get presentation() { return mounted.value && props.visible && props.voiceRuntime === runtime ? "inline" : "dialog"; }
  });
});
const voiceSession = computed(() => {
  const binding = voiceBinding.value;
  const state = voice?.controller.state;
  return binding && state?.binding?.id === binding.id && state.binding.conversationId === binding.conversationId
    ? state.session : null;
});
function voicePreviewActionsAllowed(messageId) {
  const transcript = voiceTranscript.value;
  const session = voiceSession.value;
  const runtime = props.voiceRuntime;
  const pending = session?.pendingTranscript.value;
  const selected = pending?.messageId === messageId || transcript?.id === messageId && transcript.canTake;
  const receipt = runtime?.delivery.find?.(messageId);
  return Boolean(selected && session && session.canTakeTranscript(messageId) && !session.sending.value &&
    (!receipt || receipt.status === "failed") &&
    !runtime?.delivery.state.messages.some(message => message.status === "uncertain"));
}
function selectedVoiceTranscriptSession(messageId) {
  const runtime = props.voiceRuntime;
  if (!mounted.value || !props.visible || !runtime?.available.value || !voicePreviewActionsAllowed(messageId)) return null;
  return voiceSession.value;
}
async function takeVoiceTranscript(messageId) {
  const session = selectedVoiceTranscriptSession(messageId);
  if (!session) return false;
  const runtime = props.voiceRuntime;
  if (!await session.takeTranscript(messageId)) return false;
  if (runtime.delivery.find?.(messageId)?.status === "failed") runtime.delivery.cancel(messageId);
  return true;
}
async function editVoiceTranscript(messageId) {
  const session = selectedVoiceTranscriptSession(messageId);
  if (!session) return false;
  const runtime = props.voiceRuntime;
  if (!await session.beginTranscriptEdit(messageId)) return false;
  // Explicit Edit retires only a definite local rejection. Plain Retry keeps
  // the original authored text and steering intent on the delivery owner.
  if (runtime.delivery.find?.(messageId)?.status === "failed") return runtime.delivery.cancel(messageId);
  return true;
}
function updateVoiceTranscript(messageId, text) {
  const session = selectedVoiceTranscriptSession(messageId);
  if (session?.pendingTranscript.value?.messageId !== messageId) return false;
  session.editTranscript(text, messageId);
  return true;
}
async function sendVoiceTranscript(messageId) {
  const session = selectedVoiceTranscriptSession(messageId);
  const pending = session?.pendingTranscript.value;
  if (pending?.messageId !== messageId || !pending.text.trim()) return false;
  await session.deliverTranscript();
  return true;
}
const voicePreviews = computed(() => {
  const transcript = voiceTranscript.value;
  const session = voiceSession.value;
  const pending = session?.pendingTranscript.value;
  // Snapshot only the existing pending and current capture owners; never queue.
  const previews = pending ? [{ id: pending.messageId, text: pending.text }] : [];
  if (transcript && transcript.id !== pending?.messageId) previews.push(transcript);
  return previews.map(preview => {
    const review = pending?.messageId === preview.id;
    const allowed = voicePreviewActionsAllowed(preview.id);
    return { ...preview, actions: {
      canDiscard: allowed,
      canEdit: allowed && (!pending || review),
      discard: takeVoiceTranscript,
      edit: editVoiceTranscript,
      editing: review && pending.editing === true,
      update: updateVoiceTranscript,
      send: review && (pending.reviewBeforeSend || !session.sending.value) ? sendVoiceTranscript : null,
      canSend: Boolean(review && allowed && !session.sending.value && pending.text.trim()),
      sending: Boolean(review && session.sending.value)
    } };
  });
});
const voicePreview = computed(() => voicePreviews.value.find(preview => preview.id === voiceTranscript.value?.id)
  || voicePreviews.value[0] || null);
const composerBlocked = computed(() => voiceSession.value?.composerBlocked.value === true);
const readAloud = computed(() => voiceSession.value ? voiceSession.value.readAloud.value === true
  : Boolean(voiceBinding.value && voice.readAloudFor(voiceBinding.value)));
const readAloudChangePending = computed(() => Boolean(voiceBinding.value && voice.readAloudChangePendingFor(voiceBinding.value)));
const avatarVisual = computed(() => voiceSession.value?.avatarVisual.value || { state: props.working ? "thinking" : "idle" });
function showAvatar() { avatarSize.value = "compact"; }
function reportVoiceFailure(error) { if (voiceSession.value) voiceError.value = error.message; }
async function openVoice() {
  const binding = voiceBinding.value;
  if (!binding?.available || !props.visible) return null;
  const runtime = props.voiceRuntime;
  voiceError.value = "";
  try {
    if (!await voice.open(binding)) return null;
  } catch (error) {
    if (mounted.value && props.voiceRuntime === runtime) voiceError.value = error.message;
    return null;
  }
  if (!mounted.value || !props.visible || props.voiceRuntime !== runtime || !binding.available) return null;
  showAvatar();
  return voiceSession.value;
}
const voiceGesture = useVoiceLauncher({
  enabled: () => Boolean(props.visible && voiceBinding.value?.available && !voiceSession.value),
  async open() {
    const session = await openVoice();
    return session ? {
      startHeldRecording: session.startPushToTalk,
      finishHeldRecording: session.finishPushToTalk,
      discardHeldRecording: session.cancelPushToTalk
    } : null;
  },
  async onTap() { const session = await openVoice(); await session?.toggleHandsFree(); },
  onError: reportVoiceFailure
});
// Retain the held launcher while opening replaces its tools with live controls.
const holdingVoice = voiceGesture.holding;
async function toggleReadAloud() {
  if (readAloudChangePending.value) return;
  const session = voiceSession.value || await openVoice();
  try { await session?.toggleReadAloud(); }
  catch (error) { reportVoiceFailure(error); }
}
watch(() => [props.voiceRuntime, props.visible], ([runtime], [previousRuntime]) => {
  voiceGesture.cancel();
  if (runtime !== previousRuntime) {
    avatarSize.value = "compact";
    voiceTranscript.value = null;
    voiceError.value = "";
  }
});
onBeforeUnmount(() => {
  mounted.value = false;
  globalThis.document?.removeEventListener("visibilitychange", updatePageVisibility);
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
  emit("check-integration", { sessionId: key, turnId: turn.turnId, requestId: turn.integrationSetup.requestId });
}, { immediate: true });
function presentationMessage(message) {
  if (!message) {
    return message;
  }
  const integrationRequest = parseIntegrationSetupRequest(message);
  return integrationRequest ? { ...message, text: integrationRequest.text, integrationRequest } : message;
}

const adapter = computed(() => ({
  conversation: {
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
    turns: props.turns.map((turn) => {
      const selection = turn.metadata?.assistantSelection;
      return {
        ...turn,
        assistantLabel: !selection ? "agent" : `${turn.metadata?.assistantRouting?.resolvedMode ? `${assistantModeLabel(turn.metadata.assistantRouting.resolvedMode)} · ` : ""}${vibe64AssistantSelectionLabel(selection)}`,
        ...(!turn.system && turn.metadata?.assistantRouting && selection ? { system: { role: "system", text: `${turn.metadata.assistantRouting.requestedMode === "auto" ? "Auto → " : ""}${assistantModeLabel(turn.metadata.assistantRouting.resolvedMode)} · ${vibe64AssistantSelectionLabel(selection)}` } } : {}),
        assistantDetails: selection
          ? `${vibe64AssistantSelectionLabel(selection)}\nProvider: ${selection.modelProviderId}`
          : undefined,
        assistant: presentationMessage(turn.assistant),
        thinking: turn.thinking?.map((message) => thinkingMessagePresentation(message, selection)).filter(Boolean),
        commentary: turn.commentary?.map((message) => thinkingMessagePresentation(message, selection)).filter(Boolean),
        messages: turn.messages?.map((message) => thinkingMessagePresentation(presentationMessage(message), selection)).filter(Boolean)
      };
    })
  },
  actions: {
    loadMore: (value) => emit("load-more", value),
    reload: () => emit("reload"),
    resend: (id) => emit("resend-turn", id),
    cancel: (id) => emit("cancel-turn", id),
    edit: (id) => emit("edit-turn", id),
    openLink(payload) {
      if (payload.href === "#vibe64-plan-history") {
        payload.event?.preventDefault?.();
        emit("open-plan-history");
        return;
      }
      const target = sourceEditorLinkTarget({ href: payload.href, sourceRoot: props.sourceRoot, text: payload.text });
      if (!target) return;
      payload.event?.preventDefault?.();
      emit("open-source-file", target);
    }
  }
}));
</script>

<style scoped>
.vibe64-main-conversation__voice-tools { display: flex; align-items: center; gap: 0; }
.vibe64-main-conversation__voice-disc { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(var(--v-theme-primary), .12); }
.vibe64-main-conversation__voice-tools--opening :deep(.assistant-voice-controls__tools) { display: none; }
</style>
