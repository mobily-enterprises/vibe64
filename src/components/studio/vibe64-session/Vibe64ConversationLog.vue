<template>
  <AssistantConversationElement class="vibe64-conversation-log" :adapter="adapter" v-model:avatar-size="avatarSize">
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
      <Vibe64ProjectMessage v-if="message.projectMessage" :details="message.projectMessage" :at="message.displayAt" />
      <Vibe64ConversationStatus v-else :message="message" @check-delivery="emit('resend-turn', $event)" @link-click="adapter.actions.openLink" />
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
<script>
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";

// Learning narration opens at most once per lesson conversation and page, so a
// learner who ends voice is not reconnected when Main remounts.
const autoOpenedLearningVoice = new Set();
// Lessons speak unprompted only where a speech service is configured; one
// catalogue read per page keeps speechless installs as quiet text lessons.
let speechCatalogue = null;
function speechServiceConfigured() {
  speechCatalogue ||= getHttpWebClient().request("/api/vibe64/voice/voices", { method: "GET" })
    .then(result => Array.isArray(result?.voices) && result.voices.length > 0, () => false);
  return speechCatalogue;
}
</script>

<script setup>
import { assistantGoalManagementMessage, assistantGoalObjective, assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { conversationAttribution } from "@/lib/vibe64ConversationAttribution.js";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { VoiceAvatar, VoiceConversationControls, VoiceConversationHost, VoiceConversationSettings, useVoiceLauncher } from "@jskit-ai/assistant-voice/client";
import { createProjectVoiceBinding, useVibe64Voice } from "@local/vibe64-voice/client";
import { mdiMicrophone, mdiMicrophoneOff, mdiVolumeHigh, mdiVolumeOff } from "@mdi/js";
import Vibe64ConversationStatus from "./Vibe64ConversationStatus.vue";
import Vibe64ProjectMessage from "./Vibe64ProjectMessage.vue";
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import { thinkingMessagePresentation, usesCommentaryForThinking } from "@/lib/vibe64ThinkingPresentation.js";
import { parseIntegrationSetupRequest, vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { learningGuidancePresentation } from "@local/vibe64-training/shared/learning-guidance";

const props = defineProps({
  voiceRuntime: { type: Object, default: null },
  hiddenByWorkspaceMode: { type: Boolean, default: false },
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
function presentationMessage(message, turn) {
  if (!message || assistantGoalManagementMessage(message, turn)) return null;
  const prefix = message.role === "user" ? "/goal "
    : ["Goal set: ", "Goal cleared: ", "Goal active: "].find(value => message.text?.startsWith(value));
  if (prefix && message.text?.startsWith(prefix)) {
    const objective = message.text.slice(prefix.length);
    const separator = objective.indexOf("\n\n");
    if (separator !== -1) {
      const display = assistantGoalObjective(objective, { objective: objective.slice(separator + 2) });
      if (display !== objective) return { ...message, text: `${prefix}${display}` };
    }
  }
  const integrationRequest = parseIntegrationSetupRequest(message);
  return integrationRequest ? { ...message, text: integrationRequest.text, integrationRequest } : message;
}

// Keep only a mode-hidden reader; ordinary tab/collapse hiding keeps its policy.
const retainedByWorkspaceMode = ref(false);
watch(() => [props.hiddenByWorkspaceMode, props.visible, props.scrollKey],
  ([hiddenByMode, visible, scrollKey], [, , previousScrollKey] = []) => {
    if (scrollKey !== previousScrollKey) retainedByWorkspaceMode.value = false;
    if (hiddenByMode) retainedByWorkspaceMode.value = true;
    else if (!visible) retainedByWorkspaceMode.value = false;
  }, { flush: "post" });

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
    retainWhenHidden: props.hiddenByWorkspaceMode || retainedByWorkspaceMode.value,
    visible: props.visible,
    welcomeMessage: props.welcomeMessage,
    progressPreviewLimit: usesCommentaryForThinking(props.turns.at(-1)?.metadata?.assistantSelection) ? 1 : 2,
    turns: props.turns.map((turn) => {
      const selection = turn.metadata?.assistantSelection;
      return {
        ...turn,
        ...conversationAttribution(selection, turn.metadata?.assistantRouting),
        ...(!turn.system && turn.metadata?.assistantRouting && selection ? { system: { role: "system", text: `${turn.metadata.assistantRouting.requestedMode === "auto" ? "Auto → " : ""}${assistantModeLabel(turn.metadata.assistantRouting.resolvedMode)} · ${vibe64AssistantSelectionLabel(selection)}` } } : {}),
        user: presentationMessage(turn.user, turn),
        ...(turn.metadata?.projectMessage ? {
          user: null,
          system: { ...(turn.system || turn.user), role: "system", projectMessage: turn.metadata.projectMessage }
        } : {}),
        // A Learning watch wake is application-origin: show its short status, not the teacher prompt.
        ...(learningGuidancePresentation(turn.user) ? {
          user: null,
          system: { ...turn.user, role: "system", text: learningGuidancePresentation(turn.user).text }
        } : {}),
        assistant: presentationMessage(turn.assistant, turn),
        thinking: turn.thinking?.map((message) => thinkingMessagePresentation(message, selection)).filter(Boolean),
        commentary: turn.commentary?.map((message) => thinkingMessagePresentation(presentationMessage(message, turn), selection)).filter(Boolean),
        messages: turn.messages?.map((message) => thinkingMessagePresentation(presentationMessage(message, turn), selection)).filter(Boolean)
      };
    })
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
// Lessons are spoken by default: with read-aloud on and no other voice owner,
// open the visible Learning teacher's narration once. Capture stays off until
// Talk; Working conversations keep opt-in voice.
watch(() => {
  const binding = voiceBinding.value;
  const state = voice?.controller.state;
  const narration = binding?.narration;
  // Narration readiness covers chat access and the loaded conversation that
  // the Learning voice gate requires.
  return binding && props.voiceRuntime?.identity?.learningAttemptId !== undefined && narration?.eligible &&
    !narration.loading && !state.session && !state.busy && voice.readAloudFor(binding) &&
    !autoOpenedLearningVoice.has(binding.id) ? binding : null;
}, async binding => {
  if (!binding) return;
  autoOpenedLearningVoice.add(binding.id);
  if (await speechServiceConfigured() && voiceBinding.value === binding && !voice.controller.state.session) void openVoice();
}, { immediate: true });
</script>

<style scoped>
/* Chat bubbles follow the M3 chat shape: a tighter corner at the author side. */
:deep(.assistant-transcript__message-row--assistant) { max-width: min(30rem, 92%); }
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

<style>
/* Learning: the same conversation as a warm tutor dialogue. The teacher speaks
   from a lit card with a yellow badge; the learner answers in the primary
   container; teacher status lines (Watching: …) become quiet tonal chips. */
.studio-app-shell-layout--learning .vibe64-conversation-log {
  --vibe64-tutor-card: color-mix(in srgb, var(--v64-learning, #f5c518) 9%, rgb(var(--v-theme-surface)));
  --vibe64-tutor-edge: color-mix(in srgb, var(--v64-learning, #f5c518) 38%, rgb(var(--v-theme-surface)));
}
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__body { gap: 1.1rem; }
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__avatar--assistant {
  background: var(--v64-learning, #f5c518);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--v64-learning, #f5c518) 25%, transparent);
  color: var(--v64-on-learning, #2b2100);
  height: 1.75rem;
  width: 1.75rem;
}
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__message-row--assistant .assistant-transcript__message-header {
  color: var(--v64-on-learning-container, #4d3a00);
  font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif);
  font-size: .9rem;
  letter-spacing: .01em;
}
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__message--assistant {
  background: var(--vibe64-tutor-card);
  border: 1px solid var(--vibe64-tutor-edge);
  box-shadow: var(--v64-elevation-1);
  color: rgb(var(--v-theme-on-surface));
  font: var(--v64-type-body-lg, 400 1rem/1.5rem system-ui, sans-serif);
  margin-left: 2.4rem;
  max-width: calc(100% - 2.4rem);
  padding: .9rem 1.1rem;
}
/* The teacher's opening greeting is the same tutor card as its replies. */
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__welcome {
  background: var(--vibe64-tutor-card);
  border: 1px solid var(--vibe64-tutor-edge);
  box-shadow: var(--v64-elevation-1);
  color: rgb(var(--v-theme-on-surface));
}
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__message--assistant .studio-long-text-review__paragraph { line-height: 1.6; }
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__message--user {
  background: var(--v64-primary-container, rgba(var(--v-theme-primary), .14));
  color: var(--v64-on-primary-container, rgb(var(--v-theme-on-surface)));
  font: var(--v64-type-body-lg, 400 1rem/1.5rem system-ui, sans-serif);
}
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__message-footer { color: var(--v64-on-surface-variant); font-size: .75rem; }
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__message-footer--assistant { margin-left: 2.4rem; }
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__system:not(:has(.vibe64-project-message)) {
  align-items: center;
  background: var(--v64-surface-container, rgba(var(--v-theme-primary), .05));
  border: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, .12));
  border-radius: var(--v64-shape-lg, 16px);
  font: var(--v64-type-label-lg, 500 .875rem/1.25rem system-ui, sans-serif);
  justify-self: center;
  margin-inline: auto;
  padding: .4rem .85rem .4rem .55rem;
  width: fit-content;
}
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__system:not(:has(.vibe64-project-message)) .assistant-transcript__system-icon {
  background: var(--v64-learning-container, #fdf3c4);
  border-radius: 50%;
  box-sizing: content-box;
  color: var(--v64-on-learning-container, #4d3a00);
  margin-top: 0;
  padding: 4px;
}
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-transcript__thinking {
  border-left-color: var(--vibe64-tutor-edge);
  margin-left: 2.4rem;
}
.studio-app-shell-layout--learning .vibe64-conversation-log .vibe64-main-conversation__voice-disc,
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-conversation__avatar-size-disc {
  background: var(--v64-learning-container, #fdf3c4);
  color: var(--v64-on-learning-container, #4d3a00);
}
.studio-app-shell-layout--learning .vibe64-conversation-log .v-btn[aria-pressed="true"] .vibe64-main-conversation__voice-disc {
  background: var(--v64-learning, #f5c518);
  color: var(--v64-on-learning, #2b2100);
}
/* A soft stage behind the (unchanged) avatar artwork. */
.studio-app-shell-layout--learning .vibe64-conversation-log .assistant-conversation__avatar-visual {
  background: radial-gradient(circle at 50% 58%, color-mix(in srgb, var(--v64-learning, #f5c518) 30%, transparent) 0 52%, transparent 53%);
  border-radius: 50%;
}
</style>
