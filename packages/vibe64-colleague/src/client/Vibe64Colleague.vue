<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import Vibe64SessionAssistantMenu from "@/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";

const props = defineProps({
  request: { type: Function, required: true },
  navigate: { type: Function, default: null },
  focus: { type: Object, default: () => ({}) }
});
const open = ref(false);
const draft = ref("");
const state = ref({ messages: [], status: "ready", error: "" });
const sending = ref(false);
const connectionError = ref("");
const modelMenu = ref(false);
const modelButton = ref(null);
const clientId = crypto.randomUUID();
const working = computed(() => state.value.status === "working");
const watches = computed(() => (state.value.watches || []).filter((item) => ["active", "pending", "paused"].includes(item.status)));
const destination = computed(() => props.focus.projectSlug || "All projects");
let timer;
let mounted = true;
let revision = 0;
let pendingMessage = null;
let navigating = null;
let navigationReceipt = null;

async function request(suffix = "", options = {}) {
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
    await request("/navigation/ack", { method: "POST", body: navigationReceipt });
  } catch (error) { connectionError.value = error.message; }
  finally { navigating = null; }
}
function schedule() {
  clearTimeout(timer);
  if (mounted && (open.value || working.value || watches.value.length)) timer = setTimeout(refresh, open.value || working.value ? 1000 : 5000);
}
async function refresh() {
  const expectedRevision = ++revision;
  try {
    const result = await request(`?clientId=${encodeURIComponent(clientId)}`, { method: "GET" });
    apply(result, expectedRevision);
    connectionError.value = "";
  } catch (error) { if (mounted) connectionError.value = error.message; }
  finally { schedule(); }
}
async function sendMessage(message, options = {}) {
  if (sending.value) throw new Error("Another message is being sent. Your transcript is kept; retry in a moment.");
  sending.value = true;
  const expectedRevision = ++revision;
  try {
    const result = await request("/messages", { method: "POST", body: { message, messageId: options.messageId, clientId, focus: options.focus } });
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
  } catch (error) { connectionError.value = error.message; }
}
async function stop() {
  const expectedRevision = ++revision;
  try { apply(await request("/stop", { method: "POST", body: {} }), expectedRevision); }
  catch (error) { connectionError.value = error.message; }
  schedule();
}
async function selectModel(assistantSelection) {
  const expectedRevision = ++revision;
  try {
    const result = await request("/model", { method: "POST", body: { assistantSelection } });
    apply(result, expectedRevision);
    connectionError.value = "";
    return result;
  } catch (error) { connectionError.value = error.message; return { ok: false }; }
  finally { schedule(); }
}
async function changeWatch(watchId, operation) {
  try {
    await request(`/watches/${operation}`, { method: "POST", body: { watchId } });
    await refresh();
  } catch (error) { connectionError.value = error.message; }
}
const adapter = computed(() => ({
  conversation: {
    turns: conversationTurnsFromMessages(state.value.messages || []),
    assistantLabel: "Colleague", systemLabel: "Vibe64",
    scrollKey: state.value.conversationId || "colleague", working: working.value,
    variant: "task", visible: open.value, userMessageFormat: "plain", progressPreviewLimit: 0,
    welcomeMessage: state.value.messages?.length ? "" : "Let's think it through. I can discuss an idea, check on your agents, or help you operate Vibe64."
  },
  composer: {
    draft: draft.value, ariaLabel: "Message Colleague", placeholder: "Talk it through with Colleague…",
    rows: 1, density: "compact", disabled: sending.value,
    canSend: Boolean(draft.value.trim()) && !sending.value, canStop: working.value,
    submitAriaLabel: working.value ? "Steer Colleague" : "Send to Colleague",
    submitLabel: working.value ? "Steer" : "Send"
  },
  actions: { setDraft: (value) => { draft.value = value; }, submit, stop }
}));
watch(open, (value) => { if (value) void refresh(); else schedule(); });
watch(() => props.focus, (focus) => {
  void request("/focus", { method: "POST", body: { clientId, focus } }).catch((error) => { connectionError.value = error.message; });
}, { deep: true });
onMounted(() => { void refresh(); window.addEventListener("focus", refresh); });
onBeforeUnmount(() => { mounted = false; clearTimeout(timer); revision += 1; window.removeEventListener("focus", refresh); });
</script>

<template>
  <aside class="vibe64-colleague" :class="{ 'vibe64-colleague--open': open }" aria-label="Colleague">
    <button v-if="!open" class="vibe64-colleague__launcher" aria-label="Open Colleague" @click="open = true">
      <span class="vibe64-colleague__avatar"><slot name="avatar" :state="working ? 'thinking' : 'idle'" /></span>
      <span><strong>Colleague</strong><small>{{ working ? 'Working…' : 'Let’s talk' }}</small></span>
    </button>
    <template v-else>
      <header class="vibe64-colleague__header">
        <span class="vibe64-colleague__avatar"><slot name="avatar" :state="working ? 'thinking' : 'idle'" /></span>
        <div class="vibe64-colleague__identity"><strong>Colleague</strong><small>{{ destination }}</small></div>
        <button class="vibe64-colleague__close" aria-label="Minimize Colleague" title="Minimize Colleague" @click="open = false">−</button>
      </header>
      <div class="vibe64-colleague__conversation">
        <AssistantConversationElement :adapter="adapter" label="Colleague conversation" />
      </div>
      <details v-if="watches.length" class="vibe64-colleague__watches">
        <summary>{{ watches.length }} conversation {{ watches.length === 1 ? 'watch' : 'watches' }}</summary>
        <ul>
          <li v-for="item in watches" :key="item.watchId">
            <span><strong>{{ item.projectSlug }}</strong> · {{ item.status }}<small>{{ item.question }}</small><small v-if="item.error">{{ item.error }}</small></span>
            <button v-if="item.status === 'paused'" :aria-label="`Resume watch: ${item.question}`" @click="changeWatch(item.watchId, 'resume')">Resume</button>
            <button :aria-label="`Cancel watch: ${item.question}`" @click="changeWatch(item.watchId, 'cancel')">Cancel</button>
          </li>
        </ul>
      </details>
      <p v-if="connectionError || state.error" class="vibe64-colleague__error" role="alert">{{ connectionError || state.error }}</p>
      <footer class="vibe64-colleague__footer">
        <span aria-live="polite">{{ working ? 'Working · you can steer me' : 'Available across your projects' }}</span>
        <button ref="modelButton" class="vibe64-colleague__model" aria-label="Choose Colleague model" :disabled="working || sending" @click="modelMenu = true">
          {{ state.assistantSelection?.modelId || 'Choose model' }} ▾
        </button>
      </footer>
    </template>
    <div v-if="$slots.voice" class="vibe64-colleague__voice">
      <slot name="voice" :conversation="state" :submit="sendMessage" :minimized="!open" />
    </div>
    <Vibe64SessionAssistantMenu v-model="modelMenu" :target="modelButton" :selection="state.assistantSelection"
      :save-selection="selectModel" catalog-path="/api/vibe64/colleague/models" :changes-disabled="working || sending" />
  </aside>
</template>

<style scoped>
.vibe64-colleague { position: fixed; right: 20px; bottom: max(18px, env(safe-area-inset-bottom)); z-index: 1800; color: rgb(var(--v-theme-on-surface)); }
.vibe64-colleague__launcher { display: flex; align-items: center; gap: 9px; padding: 5px 19px 5px 6px; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-secondary), .5); border-radius: 32px; box-shadow: 0 5px 24px #0002; cursor: pointer; text-align: left; }
.vibe64-colleague strong { font-size: 15px; font-weight: 650; letter-spacing: .015em; }
.vibe64-colleague small { display: block; font-size: 12px; opacity: .75; }
.vibe64-colleague__avatar { display: block; width: 50px; height: 50px; flex: 0 0 50px; overflow: hidden; border-radius: 50%; }
.vibe64-colleague__avatar :deep(svg) { width: 100%; height: 100%; }
.vibe64-colleague--open { display: flex; flex-direction: column; width: min(460px, calc(100vw - 32px)); height: min(690px, calc(100dvh - 100px)); background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-secondary), .5); border-radius: 22px; overflow: hidden; box-shadow: 0 16px 65px #0003; }
.vibe64-colleague__header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: linear-gradient(115deg, rgba(var(--v-theme-secondary), .16), rgba(var(--v-theme-primary), .05)); border-bottom: 1px solid rgba(var(--v-theme-on-surface), .1); }
.vibe64-colleague__identity { flex: 1; min-width: 0; }
.vibe64-colleague__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-colleague__close { width: 36px; height: 36px; border-radius: 50%; font-size: 25px; cursor: pointer; }
.vibe64-colleague__close:hover { background: rgba(var(--v-theme-on-surface), .08); }
.vibe64-colleague__conversation { flex: 1; min-height: 0; display: flex; padding: 12px; }
.vibe64-colleague__conversation :deep(.assistant-conversation) { width: 100%; min-height: 0; }
.vibe64-colleague__footer { display: flex; justify-content: space-between; gap: 8px; padding: 8px 16px 12px; font-size: 11px; opacity: .72; }
.vibe64-colleague__model { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-colleague__error { padding: 8px 16px; color: rgb(var(--v-theme-error)); font-size: 13px; }
.vibe64-colleague__watches { padding: 6px 16px; font-size: 12px; max-height: 160px; overflow: auto; }
.vibe64-colleague__watches summary { cursor: pointer; }
.vibe64-colleague__watches ul { list-style: none; padding: 0; }
.vibe64-colleague__watches li { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.vibe64-colleague__watches li > span { flex: 1; min-width: 0; }
.vibe64-colleague__watches button { color: rgb(var(--v-theme-primary)); }
.vibe64-colleague__voice { padding: 8px 12px; background: rgb(var(--v-theme-surface)); border-radius: 18px; }
.vibe64-colleague:not(.vibe64-colleague--open) .vibe64-colleague__voice { margin-top: 6px; max-width: min(360px, calc(100vw - 32px)); box-shadow: 0 5px 24px #0002; }
@media (max-width: 600px) { .vibe64-colleague { right: 10px; bottom: max(10px, env(safe-area-inset-bottom)); } .vibe64-colleague--open { width: calc(100vw - 20px); height: calc(100dvh - 80px); } }
</style>
