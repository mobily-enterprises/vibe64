<script setup>
import { useVibe64Voice } from "@local/vibe64-voice/client";
import { ConversationDialog, useVoiceLauncher } from "@jskit-ai/assistant-voice/client";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRealtimeEvent, useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { mdiArrowTopRight, mdiClose, mdiHeadset, mdiMicrophone, mdiSend, mdiStop, mdiTuneVariant } from "@mdi/js";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_COLLEAGUE_LAUNCHER_KEY } from "@/lib/vibe64AssistantHost.js";
import { AssistantConversationElement, AssistantPromptInput } from "@jskit-ai/assistant-core/client/conversation";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import Vibe64SessionAssistantMenu from "@/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";

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
  const actorKey = viewer?.value?.actorKey || viewer?.actorKey || "";
  const binding = {
    id: JSON.stringify(["colleague", actorKey]),
    get label() { return props.name; },
    get state() { return state.value; },
    get available() { return mounted && (viewer?.value?.actorKey || viewer?.actorKey || "") === actorKey; },
    socketUrl: "/api/vibe64/colleague/voice/ws",
    captureContext: () => ({ ...props.focus }),
    submitText: (text, { messageId, context }) => sendMessage(text, { messageId, focus: context }),
    cancelWork: stop,
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
const draft = ref("");
const state = ref({ messages: [], status: "ready", error: "" });
const sending = ref(false);
const connectionError = ref("");
const feedback = useShellWebErrorRuntime();
const modelMenu = ref(false);
const modelButton = ref(null);
const sendButton = ref(null);
const clientId = crypto.randomUUID();
const working = computed(() => state.value.status === "working");
const watches = computed(() => (state.value.watches || []).filter((item) => !item.assignmentId && ["active", "pending", "paused"].includes(item.status)));
const assignments = computed(() => (state.value.assignments || []).filter((item) => ["active", "waiting", "needs-user"].includes(item.status)));
let timer;
let mounted = true;
let revision = 0;
let pendingMessage = null;
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
function apply(result, expectedRevision) {
  if (mounted && expectedRevision === revision) {
    if (result.streamEpoch && result.streamEpoch === state.value.streamEpoch &&
        result.streamRevision < state.value.streamRevision) return;
    state.value = result;
    void handleNavigation(result.navigation);
  }
}
async function handleNavigation(command) {
  if (navigating || command?.status !== "pending" || !props.navigate) return;
  navigating = command.id;
  try {
    if (navigationReceipt?.commandId !== command.id) {
      try { navigationReceipt = { commandId: command.id, clientId, ok: true, focus: await props.navigate(command) }; }
      catch (error) { navigationReceipt = { commandId: command.id, clientId, ok: false, error: error.message }; }
    }
    await requestColleague("/navigation/ack", { method: "POST", body: navigationReceipt });
  } catch (error) { connectionError.value = error.message; }
  finally { navigating = null; }
}
const realtimeSocket = useRealtimeSocket();
useRealtimeEvent({ event: "vibe64.colleague.reply.changed", onEvent({ payload }) {
  if (!mounted || !payload?.streamEpoch || !Number.isSafeInteger(payload.streamRevision)) return;
  if (state.value.streamEpoch && state.value.streamEpoch !== payload.streamEpoch) { void refresh(); return; }
  if (payload.streamRevision <= (state.value.streamRevision || 0)) return;
  const messages = [...(state.value.messages || [])];
  if (payload.completedMessage && !messages.some((message) => message.id === payload.completedMessage.id)) {
    messages.push(payload.completedMessage);
  }
  state.value = { ...state.value, conversationId: payload.conversationId,
    streamEpoch: payload.streamEpoch, streamRevision: payload.streamRevision,
    streamingReply: payload.streamingReply, messages,
    ...(payload.streamingReply ? { status: "working" } : {}) };
  if (!payload.streamingReply) void refresh();
} });
realtimeSocket.on("connect", refresh);
function schedule() {
  clearTimeout(timer);
  if (mounted && (open.value || working.value || watches.value.length || assignments.value.length)) timer = setTimeout(refresh, open.value || working.value ? 1000 : 5000);
}
async function refresh() {
  const expectedRevision = ++revision;
  try {
    const result = await requestColleague(`?clientId=${encodeURIComponent(clientId)}`, { method: "GET" });
    apply(result, expectedRevision);
    if (mounted && expectedRevision === revision) connectionError.value = "";
  } catch (error) { if (mounted && expectedRevision === revision) connectionError.value = error.message; }
  finally { schedule(); }
}
async function sendMessage(message, options = {}) {
  if (sending.value) throw new Error("Another message is being sent. Your transcript is kept; retry in a moment.");
  sending.value = true;
  emit("message-submit", options.messageId);
  const activeVoice = voice?.controller.state;
  if (activeVoice?.binding?.socketUrl === "/api/vibe64/colleague/voice/ws") activeVoice.session.inviteSpeech(options.messageId);
  const expectedRevision = ++revision;
  try {
    const result = await requestColleague("/messages", { method: "POST", body: { message, messageId: options.messageId, clientId, focus: options.focus } });
    apply(result, expectedRevision);
    connectionError.value = "";
    return result;
  } finally { sending.value = false; schedule(); }
}
async function submit() {
  const message = draft.value.trim();
  if (!message || sending.value) return;
  pendingMessage = pendingMessage?.message === message ? pendingMessage : { message, messageId: crypto.randomUUID(), focus: { ...props.focus } };
  try {
    await sendMessage(message, pendingMessage);
    if (draft.value.trim() === message) draft.value = "";
    pendingMessage = null;
  } catch (error) { reportFailure(error); }
}
async function stop() {
  const expectedRevision = ++revision;
  try { apply(await requestColleague("/stop", { method: "POST", body: {} }), expectedRevision); }
  catch (error) { reportFailure(error); }
  schedule();
}
async function selectModel(assistantSelection) {
  const expectedRevision = ++revision;
  try {
    const result = await requestColleague("/model", { method: "POST", body: { assistantSelection } });
    apply(result, expectedRevision);
    connectionError.value = "";
    return result;
  } catch (error) { reportFailure(error); return { ok: false }; }
  finally { schedule(); }
}
async function changeWatch(watchId, operation) {
  try {
    await requestColleague(`/watches/${operation}`, { method: "POST", body: { watchId } });
    await refresh();
  } catch (error) { reportFailure(error); }
}
const visibleTurns = computed(() => {
  const messages = state.value.messages || [];
  const pendingTranscript = voiceTranscript.value;
  const pendingVoice = pendingTranscript?.text && pendingTranscript.id && !messages.some(message => message.id === pendingTranscript.id)
    ? { id: pendingTranscript.id, text: pendingTranscript.text, role: "user" } : null;
  const turns = conversationTurnsFromMessages([
    ...messages,
    ...(working.value && state.value.streamingReply?.text ? [state.value.streamingReply] : []),
    ...(pendingVoice ? [pendingVoice] : [])
  ]);
  if (pendingVoice) turns.at(-1).optimistic = { id: pendingVoice.id, status: "pending" };
  return turns;
});
const adapter = computed(() => ({
  conversation: {
    turns: visibleTurns.value,
    assistantLabel: props.name, systemLabel: "Vibe64",
    scrollKey: state.value.conversationId || "colleague", working: working.value,
    variant: "task", visible: open.value, userMessageFormat: "plain", progressPreviewLimit: 0,
    welcomeMessage: state.value.messages?.length ? "" : "Let's think it through. I can discuss an idea, check on your agents, or help you operate Vibe64."
  },
  composer: {
    draft: draft.value, ariaLabel: `Message ${props.name}`, placeholder: `Talk it through with ${props.name}…`,
    rows: 1, density: "compact", disabled: sending.value,
    canSend: Boolean(draft.value.trim()) && !sending.value, canStop: working.value,
    submitAriaLabel: working.value ? `Steer ${props.name}` : `Send to ${props.name}`,
    submitLabel: working.value ? "Steer" : "Send"
  },
  actions: { setDraft: (value) => { draft.value = value; }, submit, stop }
}));
watch(open, (value) => { if (value) void refresh(); else schedule(); });
watch(() => state.value.error, (error) => { if (error) reportFailure(error); });
watch(() => props.focus, (focus) => {
  void requestColleague("/focus", { method: "POST", body: { clientId, focus } }).catch((error) => { connectionError.value = error.message; });
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
  clearTimeout(timer);
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
                  <span v-if="connectionError" class="text-body-small" role="status" :title="connectionError">Reconnecting…</span>
                </template>
                <template #footer>
                  <div class="vibe64-colleague__composer-actions">
                    <v-btn
                      ref="modelButton" :icon="mdiTuneVariant" size="small" variant="text"
                      :aria-label="`Choose ${name} model`" :title="state.assistantSelection?.modelId || 'Choose model'"
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
        v-model="modelMenu" :target="modelButton?.$el" :selection="state.assistantSelection"
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
