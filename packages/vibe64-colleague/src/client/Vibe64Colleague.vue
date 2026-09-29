<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mdiArrowTopRight, mdiSend, mdiStop, mdiTuneVariant } from "@mdi/js";
import { VIBE64_COLLEAGUE_LAUNCHER_KEY } from "@/lib/vibe64AssistantHost.js";
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
const emit = defineEmits(["voice-hold-start", "voice-hold-end", "voice-hold-cancel"]);
const holdingAvatar = ref(false);
let avatarPressTimer;
let avatarPointer = null;
let suppressAvatarClick = false;

function startAvatarPress(event) {
  if (!props.holdToTalk || event.button !== 0 || event.isPrimary === false || avatarPointer !== null) return;
  suppressAvatarClick = false;
  avatarPointer = event.pointerId;
  event.currentTarget.setPointerCapture(event.pointerId);
  avatarPressTimer = setTimeout(() => {
    holdingAvatar.value = true;
    emit("voice-hold-start");
  }, 350);
}
function endAvatarPress(event) {
  if (event.pointerId !== avatarPointer) return;
  clearTimeout(avatarPressTimer);
  avatarPointer = null;
  if (holdingAvatar.value) {
    holdingAvatar.value = false;
    suppressAvatarClick = true;
    emit("voice-hold-end");
  }
}
function cancelAvatarPress() {
  clearTimeout(avatarPressTimer);
  avatarPointer = null;
  if (holdingAvatar.value) {
    holdingAvatar.value = false;
    suppressAvatarClick = true;
    emit("voice-hold-cancel");
  }
}
function avatarClick(event) {
  if (suppressAvatarClick && event.detail !== 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  suppressAvatarClick = false;
}
const open = ref(false);
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
const voicePreview = ref(null);
const clientId = crypto.randomUUID();
const working = computed(() => state.value.status === "working");
const watches = computed(() => (state.value.watches || []).filter((item) => !item.assignmentId && ["active", "pending", "paused"].includes(item.status)));
const assignments = computed(() => (state.value.assignments || []).filter((item) => ["active", "waiting", "needs-user"].includes(item.status)));
const destination = computed(() => props.focus.projectSlug || "All projects");
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
const adapter = computed(() => ({
  conversation: {
    turns: conversationTurnsFromMessages(state.value.messages || []),
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
  void refresh();
  window.addEventListener("focus", refresh);
  window.addEventListener("blur", cancelAvatarPress);
  window.addEventListener("pagehide", cancelAvatarPress);
});
onBeforeUnmount(() => {
  mounted = false;
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
      icon variant="text" width="48" height="48" :aria-label="`Open ${name}`" :title="holdToTalk ? `${name} · Hold to talk` : name" aria-haspopup="dialog" :aria-expanded="open"
      @pointerdown="startAvatarPress" @pointerup="endAvatarPress" @pointercancel="cancelAvatarPress" @lostpointercapture="cancelAvatarPress"
      @click.capture="avatarClick" @contextmenu.prevent
    >
      <span class="vibe64-colleague__launcher-avatar"><slot name="avatar" :state="working ? 'thinking' : 'idle'" /></span>
      <span v-if="working" class="vibe64-colleague__working" :aria-label="`${name} is working`" />
    </v-btn>
  </Teleport>
  <v-dialog
    v-model="open" :activator="launcher?.$el" class="vibe64-colleague__drawer"
    width="460" max-width="100%" height="100%" max-height="100%" transition="slide-x-reverse-transition"
    :content-props="{ style: { margin: 0 } }"
    eager :aria-label="`${name} conversation`" :aria-hidden="!open"
  >
    <div ref="panelTarget" class="vibe64-colleague__panel" />
  </v-dialog>
  <Teleport :to="panelTarget || 'body'" :disabled="!panelTarget">
    <aside v-show="open" class="vibe64-colleague" :aria-label="name">
      <header class="vibe64-colleague__header">
        <span class="vibe64-colleague__avatar"><slot name="avatar" :state="working ? 'thinking' : 'idle'" /></span>
        <div class="vibe64-colleague__identity"><strong class="d-block text-truncate">{{ name }}</strong><small>{{ destination }}</small></div>
        <button class="vibe64-colleague__close" :aria-label="`Close ${name}`" :title="`Close ${name}`" @click="open = false">×</button>
      </header>
      <div class="vibe64-colleague__conversation">
        <AssistantConversationElement :adapter="adapter" :label="`${name} conversation`">
          <template #composer="{ adapter: { composer } }">
            <div class="vibe64-colleague__composer-region">
              <div ref="voicePreview" class="vibe64-colleague__voice-preview" />
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
                    <slot name="voice" :conversation="state" :submit="sendMessage" :minimized="!open" :launcher="launcher?.$el" :preview="voicePreview" />
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
.vibe64-colleague__drawer { justify-content: flex-end; }
.vibe64-colleague { display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); }
.vibe64-colleague strong { font-size: 15px; font-weight: 650; letter-spacing: .015em; }
.vibe64-colleague small { display: block; font-size: 12px; opacity: .75; }
.vibe64-colleague__avatar { display: block; width: 50px; height: 50px; flex: 0 0 50px; overflow: hidden; border-radius: 50%; }
.vibe64-colleague__avatar :deep(svg) { width: 100%; height: 100%; }
.vibe64-colleague__header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: linear-gradient(115deg, rgba(var(--v-theme-secondary), .16), rgba(var(--v-theme-primary), .05)); border-bottom: 1px solid rgba(var(--v-theme-on-surface), .1); }
.vibe64-colleague__identity { flex: 1; min-width: 0; }
.vibe64-colleague__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-colleague__close { width: 48px; height: 48px; flex-shrink: 0; border-radius: 50%; font-size: 25px; cursor: pointer; }
.vibe64-colleague__close:hover { background: rgba(var(--v-theme-on-surface), .08); }
.vibe64-colleague__conversation { flex: 1; min-height: 0; display: flex; padding: 12px; }
.vibe64-colleague__conversation :deep(.assistant-conversation) { width: 100%; min-height: 0; }
.vibe64-colleague__composer { flex: 0 0 auto; }
.vibe64-colleague__composer-region { position: relative; flex: 0 0 auto; }
.vibe64-colleague__voice-preview { position: absolute; inset-inline: 0; bottom: calc(100% + 8px); z-index: 1; }
.vibe64-colleague__composer-actions, .vibe64-colleague__delivery { display: flex; align-items: center; gap: 4px; min-width: 0; }
.vibe64-colleague__composer-actions { width: 100%; flex-wrap: wrap; }
.vibe64-colleague__delivery { margin-inline-start: auto; flex-shrink: 0; }
@media (pointer: coarse) {
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
.vibe64-colleague__launcher-avatar { display: block; width: 36px; height: 36px; overflow: hidden; border-radius: 50%; }
.vibe64-colleague__launcher-avatar :deep(svg) { width: 100%; height: 100%; }
.vibe64-colleague__working { position: absolute; right: 5px; bottom: 5px; width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--v-theme-primary)); }
.vibe64-colleague__panel { height: 100%; min-height: 0; }
</style>
