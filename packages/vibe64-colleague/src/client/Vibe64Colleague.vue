<script setup>
import { useVibe64Voice } from "@local/vibe64-voice/client";
import { ConversationDialog, projectConversationVoiceState, useVoiceLauncher } from "@jskit-ai/assistant-voice/client";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { mdiArrowTopRight, mdiClose, mdiHeadset, mdiMicrophone, mdiSend, mdiStop, mdiTuneVariant } from "@mdi/js";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_COLLEAGUE_LAUNCHER_KEY } from "/src/lib/vibe64AssistantHost.js";
import { AssistantConversationElement, AssistantPromptInput } from "@jskit-ai/assistant-core/client/conversation";
import { createAssistantApi } from "@jskit-ai/assistant-core/client";
import { useAssistantConversation } from "@jskit-ai/assistant-runtime/client";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import Vibe64SessionAssistantMenu from "/src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";

const props = defineProps({
  name: { type: String, default: "Colleague" },
  holdToTalk: Boolean,
  request: { type: Function, required: true },
  navigate: { type: Function, default: null },
  focus: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["message-submit", "voice-visual"]);
const open = ref(false);
const voice = useVibe64Voice();
const shown = computed(() => open.value || Boolean(voice?.controller.state.visible));
const minimizedVoice = computed(() => Boolean(voice?.controller.state.session && !shown.value));
const listeningVoice = computed(() => Boolean(minimizedVoice.value && voice.controller.state.session.voice.listening.value && !voice.controller.state.session.microphoneMuted.value));
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
const voiceTranscript = ref(null);
const { holding: holdingAvatar, pointerDown: startAvatarPress, pointerUp: endAvatarPress,
  cancel: cancelAvatarPress, click: avatarClick } = useVoiceLauncher({
  open: openVoice, enabled: () => props.holdToTalk && !shown.value && !voice?.controller.state.session, onError: reportFailure
});
async function toggleConversation() {
  if (shown.value) {
    voice?.controller.minimize();
    open.value = false;
  } else if (voice?.controller.state.session) voice.controller.reveal();
  else if (voice) await openVoice();
  else open.value = true;
}
async function openVoice() {
  if (!voice) return false;
  if (!conversation.runtime.value) await refresh();
  const target = conversation.runtime.value;
  if (!target) throw new Error(connectionError.value || "Colleague is not connected yet. Try again.");
  let retained;
  const binding = {
    id: JSON.stringify(["colleague", target.identity.actorKey]),
    get label() { return props.name; },
    get state() { return projectConversationVoiceState({ turns: target.turns.value, status: target.snapshot.value?.status, interimReply: target.snapshot.value?.interimReply }); },
    get available() { return mounted && target.current.value; },
    retain() { retained = target.retain(); },
    release() { retained?.release(); retained = null; },
    socketUrl: "/api/vibe64/colleague/voice/ws",
    captureContext: () => ({ ...props.focus }),
    submitText: (text, { messageId, context }) => sendMessage(text, { messageId, focus: context }, target),
    cancelWork: () => target.cancel(),
    openText() { open.value = true; },
    onTranscript(value) { voiceTranscript.value = value; },
    onVisual(value) { emit("voice-visual", value); },
    onError: reportFailure
  };
  const opened = await voice.open(binding);
  open.value = false;
  if (opened) return voice.controller.state.session;
  return false;
}
async function closeText() {
  try {
    if (voice?.controller.state.session) await voice.controller.end({ discard: true });
    open.value = false;
  } catch (error) { reportFailure(error); }
}
const launcherTarget = inject(VIBE64_COLLEAGUE_LAUNCHER_KEY, null);
const launcher = ref(null);
const panelTarget = ref(null);
const product = ref({ conversationId: "", error: "" });
const productError = ref("");
const actorKey = computed(() => viewer?.value?.actorKey || viewer?.actorKey || "");
const feedback = useShellWebErrorRuntime();
const modelMenu = ref(false);
const modelButton = ref(null);
const sendButton = ref(null);
const clientId = crypto.randomUUID();
const working = computed(() => conversation.runtime.value?.snapshot.value?.status === "working");
const watches = computed(() => (product.value.watches || []).filter((item) => !item.assignmentId && ["active", "pending", "paused"].includes(item.status)));
const assignments = computed(() => (product.value.assignments || []).filter((item) => ["active", "waiting", "needs-user"].includes(item.status)));
let mounted = true;
let revision = 0;
let navigating = null;
let navigationReceipt = null;

function reportFailure(error) {
  const message = String(error?.message || error || "Colleague could not complete this request.");
  feedback.report({ source: "vibe64.colleague", intent: "action-feedback", severity: "error", message,
    dedupeKey: `vibe64.colleague:${message}`, dedupeWindowMs: 1000 });
}

async function requestColleague(suffix = "", options = {}) {
  const result = await props.request(`/api/vibe64/colleague${suffix}`, options);
  if (result?.ok === false) throw new Error(result.error || result.errors?.[0]?.message || "Colleague could not complete this request.");
  return result;
}
function apply(result, expectedRevision, expectedActor) {
  if (mounted && expectedRevision === revision && expectedActor === actorKey.value) {
    const { conversationId, assistantSelection, watches, assignments, navigation, operation, error } = result;
    product.value = { conversationId, assistantSelection, watches, assignments, navigation, operation, error };
    void handleNavigation(navigation);
  }
}
async function handleNavigation(command) {
  if (navigating || command?.status !== "pending" || !props.navigate) return;
  navigating = command.id;
  const expectedActor = actorKey.value;
  try {
    if (navigationReceipt?.commandId !== command.id) {
      let receipt;
      try { receipt = { commandId: command.id, clientId, ok: true, focus: await props.navigate(command) }; }
      catch (error) { receipt = { commandId: command.id, clientId, ok: false, error: error.message }; }
      if (!mounted || expectedActor !== actorKey.value) return;
      navigationReceipt = receipt;
    }
    if (!mounted || expectedActor !== actorKey.value) return;
    await requestColleague("/navigation/ack", { method: "POST", body: navigationReceipt });
  } catch (error) { if (mounted && expectedActor === actorKey.value) productError.value = error.message; }
  finally { if (expectedActor === actorKey.value) navigating = null; }
}
const realtimeSocket = useRealtimeSocket();
const api = createAssistantApi({
  request: (url, options) => props.request(url, options),
  resolveBasePath: () => "/api/assistant/app", resolveSurfaceId: () => "app"
});
const conversation = useAssistantConversation({
  conversationId: () => product.value.conversationId,
  actorKey, surfaceId: "app", hostSurfaceId: "app", workspaceSlug: "",
  socket: realtimeSocket,
  api: { ...api, sendConversationMessage(id, input) {
    emit("message-submit", input.messageId);
    const activeVoice = voice?.controller.state;
    if (activeVoice?.binding?.socketUrl === "/api/vibe64/colleague/voice/ws") activeVoice.session.inviteSpeech(input.messageId);
    return api.sendConversationMessage(id, input);
  } },
  clearDraftOn: "accepted", queueWhileSending: false, draftWhileLoading: true,
  data: () => ({ clientId, focus: { ...props.focus } }),
  onEvent(event) { if (event.type === "application") void refresh(); },
  presentation: () => ({
    assistantLabel: props.name, systemLabel: "Vibe64", variant: "task", visible: open.value,
    userMessageFormat: "plain", progressPreviewLimit: 0,
    welcomeMessage: "Let's think it through. I can discuss an idea, check on your agents, or help you operate Vibe64.",
    previewMessage: voiceTranscript.value,
    ariaLabel: `Message ${props.name}`, placeholder: `Talk it through with ${props.name}…`, rows: 1, layout: "compact",
    submitAriaLabel: working.value ? `Steer ${props.name}` : `Send to ${props.name}`,
    submitLabel: working.value ? "Steer" : "Send"
  })
});
const adapter = conversation.adapter;
const draft = computed({ get: () => adapter.value.composer.draft, set: value => adapter.value.actions.setDraft(value) });
const sending = computed(() => conversation.runtime.value?.delivery.state.sending === true);
const connectionError = computed(() => productError.value || conversation.runtime.value?.error.value || "");
const turnError = computed(() => conversation.runtime.value?.snapshot.value?.error ?? product.value.error);
realtimeSocket.on("connect", refresh);
async function refresh() {
  const expectedRevision = ++revision;
  const expectedActor = actorKey.value;
  try {
    const result = await requestColleague(`?clientId=${encodeURIComponent(clientId)}`, { method: "GET" });
    apply(result, expectedRevision, expectedActor);
    if (mounted && expectedRevision === revision && expectedActor === actorKey.value) productError.value = "";
  } catch (error) {
    if (mounted && expectedRevision === revision && expectedActor === actorKey.value) productError.value = error.message;
  }
}
async function sendMessage(message, options = {}, target = conversation.runtime.value) {
  if (target?.delivery.state.sending) throw new Error("Another message is being sent. Your transcript is kept; retry in a moment.");
  if (!target?.available.value) return false;
  return target.send({ message, data: { clientId, focus: options.focus } }, { messageId: options.messageId });
}
async function submit() {
  const target = conversation.runtime.value;
  if (!target?.canSubmit.value) {
    if (draft.value.trim() && connectionError.value) reportFailure(connectionError.value);
    return;
  }
  const result = await adapter.value.actions.submit();
  if ((result === false || result?.ok === false) && target.current.value) {
    const failure = target.delivery.find(target.draftMessageId.value)?.error || target.error.value;
    if (failure) reportFailure(failure);
  }
}
async function stop() {
  const target = conversation.runtime.value;
  if (await target?.cancel() === false && target.current.value && target.error.value) reportFailure(target.error.value);
}
async function selectModel(assistantSelection) {
  const expectedRevision = ++revision;
  const expectedActor = actorKey.value;
  try {
    const result = await api.selectConversation(product.value.conversationId, { assistantSelection });
    apply(result, expectedRevision, expectedActor);
    if (mounted && expectedActor === actorKey.value) {
      productError.value = "";
      conversation.runtime.value?.reload();
    }
    return result;
  } catch (error) { if (expectedActor === actorKey.value) reportFailure(error); return { ok: false }; }
}
async function changeWatch(watchId, operation) {
  try {
    await requestColleague(`/watches/${operation}`, { method: "POST", body: { watchId } });
    await refresh();
  } catch (error) { reportFailure(error); }
}
watch(open, value => { if (value) void refresh(); });
watch(actorKey, () => {
  revision += 1;
  product.value = { conversationId: "", error: "" };
  productError.value = "";
  navigationReceipt = null;
  navigating = null;
  voiceTranscript.value = null;
  void refresh();
}, { flush: "sync" });
watch(() => product.value.error, (error) => { if (error) reportFailure(error); });
watch(() => props.focus, (focus) => {
  const expectedActor = actorKey.value;
  void requestColleague("/focus", { method: "POST", body: { clientId, focus } }).catch(error => {
    if (mounted && expectedActor === actorKey.value) productError.value = error.message;
  });
}, { deep: true });
onMounted(() => {
  if (voice) voice.launcher.value = launcher.value?.$el;
  void refresh();
  window.addEventListener("focus", refresh);
  window.addEventListener("blur", cancelAvatarPress);
  window.addEventListener("pagehide", cancelAvatarPress);
});
onBeforeUnmount(() => {
  if (voice?.launcher.value === launcher.value?.$el) voice.launcher.value = null;
  realtimeSocket.off("connect", refresh);
  mounted = false;
  if (voice?.controller.state.binding?.socketUrl === "/api/vibe64/colleague/voice/ws") void voice.controller.end({ discard: true });
  cancelAvatarPress();
  revision += 1;
  window.removeEventListener("focus", refresh);
  window.removeEventListener("blur", cancelAvatarPress);
  window.removeEventListener("pagehide", cancelAvatarPress);
});
</script>

<template>
  <Teleport :to="launcherTarget || 'body'" :disabled="!launcherTarget">
    <v-btn
      ref="launcher" class="vibe64-colleague__launcher" :class="{ 'vibe64-colleague__launcher--floating': !launcherTarget, 'vibe64-colleague__launcher--listening': holdingAvatar }"
      icon variant="text" width="48" height="48"
      :aria-label="shown ? `Minimize ${voice?.controller.state.binding?.label || name}` : minimizedVoice ? `Reopen ${voice.controller.state.binding.label || 'Assistant'} voice chat${listeningVoice ? ' · Listening' : ''}` : `Open ${name}`"
      :title="shown ? 'Minimize conversation' : listeningVoice ? 'Listening · Reopen voice chat' : minimizedVoice ? 'Reopen voice chat' : holdToTalk ? `${name} · Hold to talk` : name" aria-haspopup="dialog"
      :aria-expanded="shown"
      @pointerdown="startAvatarPress" @pointerup="endAvatarPress" @pointercancel="cancelAvatarPress" @lostpointercapture="cancelAvatarPress"
      @click.capture="avatarClick" @click="toggleConversation().catch(reportFailure)" @contextmenu.prevent
    >
      <span class="vibe64-colleague__launcher-avatar"><slot name="avatar" :state="working ? 'thinking' : 'idle'" /></span>
      <span v-if="minimizedVoice" class="vibe64-colleague__voice-badge" :class="{ 'vibe64-colleague__voice-badge--listening': listeningVoice }" aria-hidden="true"><v-icon :icon="listeningVoice ? mdiMicrophone : mdiHeadset" size="14" /></span>
      <span v-if="working" class="vibe64-colleague__working" :aria-label="`${name} is working`" />
    </v-btn>
    <v-btn
      v-if="minimizedVoice" class="vibe64-colleague__voice-stop" :class="{ 'vibe64-colleague__voice-stop--floating': !launcherTarget }"
      :icon="mdiClose" variant="text" width="48" height="48" aria-label="Stop voice chat" title="Stop voice chat" @click="closeText"
    />
  </Teleport>
  <ConversationDialog
    :model-value="open" :title="name" mode="text" :show-modes="Boolean(voice)" :close-label="`Close ${name}`" :minimizable="Boolean(voice?.controller.state.session)"
    :activator="launcher?.$el" :open-on-click="false" eager
    @update:model-value="value => !value && closeText()" @minimize="open = false" @update:mode="value => value === 'talk' && openVoice().catch(reportFailure)"
  >
    <div ref="panelTarget" class="vibe64-colleague__panel" />
  </ConversationDialog>
  <Teleport :to="panelTarget || 'body'" :disabled="!panelTarget">
    <aside v-show="open" class="vibe64-colleague" :aria-label="name">
      <div class="vibe64-colleague__conversation">
        <AssistantConversationElement :adapter="adapter" :label="`${name} conversation`">
          <template #composer="{ adapter: { composer } }">
            <div class="vibe64-colleague__composer-region">
              <!-- Keep the dialog from handling Tab again after the input focuses Send. -->
              <AssistantPromptInput
                v-model="draft" class="vibe64-colleague__composer" :aria-label="composer.ariaLabel" :placeholder="composer.placeholder"
                :disabled="composer.disabled" :submit-enabled="composer.canSend" :rows="composer.rows" :density="composer.density"
                tab-to-submit @submit="submit" @tab-to-submit="sendButton?.$el?.focus()"
                @keydown.tab="$event.defaultPrevented && $event.stopPropagation()"
              >
                <template #input-start>
                  <span v-if="turnError" class="text-body-small text-error" role="alert">{{ turnError }}</span>
                  <span v-else-if="connectionError" class="text-body-small" role="status" :title="connectionError">Reconnecting…</span>
                </template>
                <template #footer>
                  <div class="vibe64-colleague__composer-actions">
                    <v-btn
                      ref="modelButton" :icon="mdiTuneVariant" size="small" variant="text"
                      :aria-label="`Choose ${name} model`" :title="product.assistantSelection?.modelId || 'Choose model'"
                      :disabled="working || sending" @click="modelMenu = true"
                    />
                    <div class="vibe64-colleague__delivery">
                      <v-btn v-if="composer.canStop" :icon="mdiStop" size="small" variant="text" :aria-label="`Stop ${name}`" title="Stop assistant" @click="stop" />
                      <v-btn
                        ref="sendButton" :icon="working ? mdiArrowTopRight : mdiSend" size="small" variant="flat" color="primary"
                        :aria-label="composer.submitAriaLabel" :title="composer.submitLabel"
                        :disabled="!composer.canSend" @click="submit"
                      />
                    </div>
                  </div>
                </template>
              </AssistantPromptInput>
            </div>
          </template>
        </AssistantConversationElement>
      </div>
      <details v-if="watches.length" class="vibe64-colleague__watches">
        <summary>{{ watches.length }} conversation {{ watches.length === 1 ? 'watch' : 'watches' }}</summary>
        <ul>
          <li v-for="item in watches" :key="item.watchId">
            <span><strong>{{ item.projectSlug || 'Workspace' }}</strong> · {{ item.status }}<small>{{ item.question }}</small><small v-if="item.error">{{ item.error }}</small></span>
            <button v-if="item.status === 'paused'" :aria-label="`Resume watch: ${item.question}`" @click="changeWatch(item.watchId, 'resume')">Resume</button>
            <button :aria-label="`Cancel watch: ${item.question}`" @click="changeWatch(item.watchId, 'cancel')">Cancel</button>
          </li>
        </ul>
      </details>
      <details v-if="assignments.length" class="vibe64-colleague__watches">
        <summary>{{ assignments.length }} ongoing {{ assignments.length === 1 ? 'assignment' : 'assignments' }}</summary>
        <ul>
          <li v-for="item in assignments" :key="item.assignmentId">
            <span><strong>{{ item.projectSlug }}</strong> · {{ item.turnLimit - item.turnsUsed }} turns left
              <small>{{ item.summary }}</small>
              <small>{{ item.criteria }}</small>
            </span>
          </li>
        </ul>
      </details>
      <Vibe64SessionAssistantMenu
        v-model="modelMenu" :target="modelButton?.$el" :selection="product.assistantSelection"
        :save-selection="selectModel" catalog-path="/api/vibe64/colleague/models" :changes-disabled="working || sending"
      />
    </aside>
  </Teleport>
</template>

<style scoped>
.vibe64-colleague { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); }
.vibe64-colleague strong { font-size: 15px; font-weight: 650; letter-spacing: .015em; }
.vibe64-colleague small { display: block; font-size: 12px; opacity: .75; }
.vibe64-colleague__conversation { flex: 1; min-height: 0; display: flex; padding: 12px; }
.vibe64-colleague__conversation :deep(.assistant-conversation) { width: 100%; min-height: 0; }
.vibe64-colleague__conversation :deep(.assistant-transcript__avatar--user) { display: none; }
.vibe64-colleague__conversation :deep(.assistant-transcript__assistant-header) { margin-bottom: 6px; }
.vibe64-colleague__conversation :deep(.studio-long-text-review__blocks > * + *) { margin-top: 0.6rem; }
.vibe64-colleague__composer { flex: 0 0 auto; }
.vibe64-colleague__composer-region { position: relative; flex: 0 0 auto; }
.vibe64-colleague__composer-actions, .vibe64-colleague__delivery { display: flex; align-items: center; gap: 4px; min-width: 0; }
.vibe64-colleague__composer-actions { width: 100%; flex-wrap: wrap; }
.vibe64-colleague__delivery { margin-inline-start: auto; flex-shrink: 0; }
@media (pointer: coarse), (max-width: 600px) {
  .vibe64-colleague__composer-actions :deep(.v-btn) { min-width: 48px; min-height: 48px; }
}
.vibe64-colleague__watches { padding: 6px 16px; font-size: 12px; max-height: 160px; overflow: auto; }
.vibe64-colleague__watches summary { min-height: 48px; padding-block: 14px; line-height: 20px; cursor: pointer; }
.vibe64-colleague__watches ul { list-style: none; padding: 0; }
.vibe64-colleague__watches li { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.vibe64-colleague__watches li > span { flex: 1; min-width: 0; }
.vibe64-colleague__watches button { min-width: 48px; min-height: 48px; color: rgb(var(--v-theme-primary)); }
.vibe64-colleague__launcher { flex: 0 0 48px; touch-action: none; user-select: none; -webkit-touch-callout: none; }
.vibe64-colleague__launcher--listening { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-colleague__launcher--floating { position: fixed; right: 8px; top: env(safe-area-inset-top, 0px); z-index: 1800; }
.vibe64-colleague__voice-stop { flex: 0 0 48px; }
.vibe64-colleague__voice-stop--floating { position: fixed; right: 56px; top: env(safe-area-inset-top, 0px); z-index: 1800; }
.vibe64-colleague__launcher-avatar { display: block; width: 36px; height: 36px; overflow: hidden; border-radius: 50%; }
.vibe64-colleague__launcher-avatar :deep(svg) { width: 100%; height: 100%; }
.vibe64-colleague__working { position: absolute; right: 5px; bottom: 5px; width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--v-theme-primary)); }
.vibe64-colleague__panel { height: 100%; min-height: 0; }
.vibe64-colleague__voice-badge { position: absolute; right: 0; bottom: 0; display: grid; place-items: center; width: 20px; height: 20px; border: 2px solid rgb(var(--v-theme-surface)); border-radius: 50%; background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); }
.vibe64-colleague__voice-badge--listening { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 1px; }
</style>
