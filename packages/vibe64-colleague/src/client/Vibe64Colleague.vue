<script setup>
import { useVibe64Voice } from "@local/vibe64-voice/client";
import { COLLEAGUE_VOICE_SOCKET_URL } from "@local/vibe64-voice/shared/routes";
import { runTrainingGuideCommand } from "@local/vibe64-training/client/guide";
import { ConversationDialog, VoiceConversationControls, VoiceConversationSettings, projectConversationVoiceState, useVoiceLauncher } from "@jskit-ai/assistant-voice/client";
import { useDisplay } from "vuetify";
import { VNavigationDrawer } from "vuetify/components";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from "vue";
import { useRealtimeEvent, useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { mdiArrowTopRight, mdiCheck, mdiClose, mdiEyeOutline, mdiHeadset, mdiHistory, mdiMicrophone, mdiMinus, mdiSchoolOutline, mdiSend, mdiStop, mdiTuneVariant, mdiVolumeHigh } from "@mdi/js";
import { LOCAL_ASSISTANT_VIEWER, VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_COLLEAGUE_LAUNCHER_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_LEARNING_KEY, VIBE64_PAGE_ACTIVITY_KEY } from "/src/lib/vibe64AssistantHost.js";
import { AssistantConversationElement, AssistantConversationStatus, AssistantPromptInput, AssistantTranscript } from "@jskit-ai/assistant-core/client/conversation";
import { createAssistantApi } from "@jskit-ai/assistant-core/client";
import { useAssistantConversation } from "@jskit-ai/assistant-runtime/client";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import Vibe64SessionAssistantMenu from "/src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";
import { AiOnboardingNudge, requestVibe64AiOnboarding } from "@local/vibe64-accounts/client";
import { registerVibe64ColleagueModel } from "/src/lib/vibe64ColleagueModelBridge.js";
import { createColleagueFocusBinding } from "./colleagueFocusBinding.js";
import { createColleagueNavigation } from "./colleagueNavigation.js";
import { watchColleagueLearningRequests } from "./colleagueLearningRequests.js";
import { createColleagueModel } from "./colleagueModel.js";
import { useColleagueFreshStart } from "./useColleagueFreshStart.js";
import { useColleagueHistory } from "./useColleagueHistory.js";
import { useColleagueLearning } from "./useColleagueLearning.js";
import { useColleagueTeachMe } from "./useColleagueTeachMe.js";
import { useColleagueVoicePreviews } from "./useColleagueVoicePreviews.js";
import { useColleagueWatchesAndOperations } from "./useColleagueWatchesAndOperations.js";
import ColleagueFreshDialog from "./ColleagueFreshDialog.vue";
import ColleagueOperationsDialog from "./ColleagueOperationsDialog.vue";
import ColleagueWatchesDialog from "./ColleagueWatchesDialog.vue";
import { applyLearningNavigation } from "../shared/learningFocus.js";

const props = defineProps({
  name: { type: String, default: "Colleague" },
  holdToTalk: Boolean,
  request: { type: Function, required: true },
  navigate: { type: Function, default: null },
  focus: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["message-submit", "voice-visual"]);
const open = ref(false);
const { xs } = useDisplay();
const voice = useVibe64Voice();
const isColleagueBinding = binding => binding?.socketUrl === COLLEAGUE_VOICE_SOCKET_URL;
const inlineVoice = computed(() => voice.controller.state.binding?.presentation === "inline"
  && !isColleagueBinding(voice.controller.state.binding)
  && !voice.controller.state.nextTarget);
const shown = computed(() => open.value || Boolean(voice.controller.state.visible && !inlineVoice.value));
const minimizedVoice = computed(() => Boolean(voice.controller.state.session && !shown.value && !inlineVoice.value));
const listeningVoice = computed(() => Boolean(minimizedVoice.value && voice.controller.state.session.voice.listening.value && !voice.controller.state.session.microphoneMuted.value));
/** @type {import("/src/lib/vibe64AssistantHost.js").AssistantViewerSource} */
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, LOCAL_ASSISTANT_VIEWER);
const voiceTranscript = ref(null);
/** @type {import("/src/lib/vibe64AssistantHost.js").ShellSlot<any>} */
const companionView = inject(VIBE64_COLLEAGUE_VIEW_KEY);
/**
 * Opening Colleague is page activity a lesson's do beat can wait for.
 * @type {import("/src/types.js").PageActivity}
 */
const pageActivity = inject(VIBE64_PAGE_ACTIVITY_KEY);
watch(shown, (value, was) => {
  if (value !== was) pageActivity.report(value ? "colleague-opened" : "colleague-minimised", { projectSlug: props.focus?.projectSlug });
});
/** @type {import("/src/types.js").Vibe64Learning} The shared Learning controller (L and Courses). */
const learning = inject(VIBE64_LEARNING_KEY);
const learningController = computed(() => learning);
const { learningStep, stepButton, showLearningStep, leaveForLearning } = useColleagueLearning({
  learningController, xs, shown, toggleConversation, reopenConversation, reportFailure
});
/** Shows Colleague again, revealing its own voice chat when one holds the conversation. */
function reopenConversation() {
  if (shown.value) return;
  if (voice.controller.state.session && !inlineVoice.value && !staleVoice.value) voice.controller.reveal();
  else open.value = true;
}
const { holding: holdingAvatar, pointerDown: startAvatarPress, pointerUp: endAvatarPress,
  cancel: cancelAvatarPress, click: avatarClick } = useVoiceLauncher({
  open: openVoice, enabled: () => props.holdToTalk && !shown.value && !voice.controller.state.session, onError: reportFailure
});
async function toggleConversation() {
  const opening = !shown.value;
  if (shown.value) {
    voice.controller.minimize();
    open.value = false;
    launcher.value?.$el?.focus();
  } else if (voice.controller.state.session && !inlineVoice.value && !staleVoice.value) voice.controller.reveal();
  else if (voice) {
    open.value = true;
    await openVoice();
  } else open.value = true;
  if (opening && bodyVisible.value) await focusConversationComposer();
}
async function openVoice() {
  if (freshOperation.value || freshBusy.value) return false;
  if (!conversation.runtime.value) await refresh();
  const target = conversation.runtime.value;
  if (!target) throw new Error(connectionError.value || "Colleague is not connected yet. Try again.");
  let retained;
  const binding = {
    preferenceTarget: "colleague",
    presentation: "inline",
    id: JSON.stringify(["colleague", target.identity.actorKey]),
    conversationId: target.identity.conversationId,
    get label() { return props.name; },
    get state() {
      return projectConversationVoiceState({ turns: target.turns.value, status: target.snapshot.value?.status, interimReply: target.snapshot.value?.interimReply });
    },
    get available() { return mounted && target.current.value; },
    get adapter() { return conversation.runtime.value === target ? adapter.value : null; },
    setConversationTarget(element) { voicePanelTarget.value = element; },
    retain() { retained = target.retain(); },
    release() { retained?.release(); retained = null; },
    socketUrl: COLLEAGUE_VOICE_SOCKET_URL,
    captureContext: () => ({ ...props.focus }),
    submitText(text, { messageId, context }) {
      return sendMessage(text, { messageId, focus: context || {} }, target);
    },
    cancelWork: () => target.cancel(),
    onTranscript(value, { canTake = false } = {}) {
      if (mounted && conversation.runtime.value === target) voiceTranscript.value = value ? { ...value, canTake } : null;
    },
    onVisual(value) { emit("voice-visual", value); },
    onError: reportFailure
  };
  const opened = await voice.open(binding);
  if (!mounted || conversation.runtime.value !== target) return false;
  open.value = false;
  if (opened) return voice.controller.state.session;
  return false;
}
async function closeText() {
  try {
    if (voice.controller.state.session) await voice.controller.end({ discard: true });
    open.value = false;
    launcher.value?.$el?.focus();
  } catch (error) { reportFailure(error); }
}
/** @type {import("/src/lib/vibe64AssistantHost.js").ShellSlot<HTMLElement>} */
const launcherTarget = inject(VIBE64_COLLEAGUE_LAUNCHER_KEY);
const launcher = ref(null);
const composerInput = ref(null);
async function focusConversationComposer() {
  await nextTick();
  composerInput.value?.focus?.({ preventScroll: true });
}
const panelTarget = ref(null);
const desktopPanelTarget = ref(null);
const conversationTarget = computed(() => xs.value ? panelTarget.value : desktopPanelTarget.value);
const voicePanelTarget = ref(null);
const voiceToolsTarget = ref(null);
// The face starts as the person last left it; only Minimise and Show change it.
const avatarVisible = computed(() => voice.avatarVisibleFor("colleague") ?? null);
const avatarSize = computed({
  get: () => avatarVisible.value === false ? "hidden" : "compact",
  set: size => voice.setAvatarVisible("colleague", size !== "hidden")
});
const product = ref({ conversationId: "", error: "" });
const productError = ref("");
const pointerNotice = ref("");
const actorKey = computed(() => viewer?.value?.actorKey || viewer?.actorKey || "");
const feedback = useShellWebErrorRuntime();
const watchButton = ref(null);
const operationButton = ref(null);
const modelMenu = ref(false);
const modelButton = ref(null);
const sendButton = ref(null);
const clientId = crypto.randomUUID();
const working = computed(() => conversation.runtime.value?.snapshot.value?.status === "working");
let mounted = true;
let revision = 0;
const isMounted = () => mounted;

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
function apply(result, expectedRevision, expectedActor, allowRetarget = false) {
  if (!mounted || expectedRevision !== revision || expectedActor !== actorKey.value) return false;
  const runtime = conversation.runtime.value;
  const changingConversation = Boolean(product.value.conversationId && result.conversationId &&
    product.value.conversationId !== result.conversationId);
  // Switching between Develop and a Learn thread (L, or another lesson) is
  // the person's own choice, never another tab's change: each thread keeps
  // its own draft and nothing needs resolving.
  const changingThread = Boolean(product.value.thread && result.thread &&
    (product.value.thread.kind !== result.thread.kind || product.value.thread.attemptId !== result.thread.attemptId));
  if (changingConversation && !changingThread && runtime?.current.value && runtime.identity.actorKey === expectedActor) {
    if (voiceSession.value?.hasUnsentSpeech.value || pointerNotice.value && !allowRetarget) {
      pointerNotice.value = "Colleague changed in another tab. Resolve the old speech first: pause the microphone and discard newer words, or explicitly Stop voice chat. Then choose Refresh conversation. Your typed draft stays unsent.";
      return false;
    }
  }
  // The original runtime owns drafts. Preserve the same person's CURRENT draft
  // before its binding changes; actor changes never enter this copy path.
  const savedDraft = changingConversation && !changingThread && runtime?.current.value && runtime.identity.actorKey === expectedActor
    ? runtime.draft.value : null;
  const { conversationId, thread, assistantSelection, watches, assignments, navigation, operation, operations, modelSetupRequired, error } = result;
  product.value = { conversationId, thread, assistantSelection, watches, assignments, navigation, operation, operations, modelSetupRequired, error };
  if (savedDraft !== null && actorKey.value === expectedActor) conversation.adapter.value.actions.setDraft(savedDraft);
  pointerNotice.value = "";
  void handleNavigation(navigation);
  return true;
}
// Both hosts' navigators run through this wrapper: opening an app place shows
// the app (Courses closes with its state kept), and a guide rings the real
// control after any "show me" navigation, reporting only what it drew.
async function navigateBrowser(command) {
  const controller = learningController.value;
  const appPlace = command.projectSlug || command.route || (command.guide && command.guide.target !== "learning");
  if (appPlace && !command.learning && unref(controller?.coursesOpen) && typeof controller.minimise === "function") {
    await applyLearningNavigation(controller, { open: false });
  }
  if (!command.guide) return props.navigate(command);
  return runTrainingGuideCommand(command, { navigateBrowser: props.navigate, view: { openFile(path) {
    const view = companionView.value;
    return view?.projectSlug === command.projectSlug && view.sessionId === command.sessionId &&
      typeof view.openFile === "function" && view.openFile(path) === true;
  } } });
}
const colleagueNavigation = createColleagueNavigation({
  scope: () => ({ mounted, actorKey: actorKey.value, clientId }),
  navigate: () => props.navigate ? navigateBrowser : null,
  beforeNavigate(command) {
    // A phone shows one surface: reveal Courses, the Lesson pane, the app or the guide ring.
    if (xs.value && shown.value && typeof command.learning?.open === "boolean") return leaveForLearning();
    if (xs.value && shown.value && command.learning) return toggleConversation();
    if (xs.value && shown.value && command.guide) return toggleConversation();
  },
  acknowledge: body => requestColleague("/navigation/ack", { method: "POST", body }),
  error: productError
});
const handleNavigation = colleagueNavigation.handle;
const realtimeSocket = useRealtimeSocket();
const api = createAssistantApi({
  request: (url, options) => props.request(url, options),
  resolveBasePath: () => "/api/assistant/app", resolveSurfaceId: () => "app"
});
const nativeApplicationAdmission = snapshot => ["codex", "claude", "opencode"].includes(snapshot?.engine);
const conversation = useAssistantConversation({
  conversationId: () => product.value.conversationId,
  actorKey, surfaceId: "app", hostSurfaceId: "app", workspaceSlug: "",
  socket: realtimeSocket,
  api: { ...api, sendConversationMessage(id, input) {
    emit("message-submit", input.messageId);
    const activeVoice = voice.controller.state;
    if (isColleagueBinding(activeVoice?.binding)) activeVoice.session.inviteSpeech(input.messageId);
    return api.sendConversationMessage(id, input);
  } },
  clearDraftOn: "accepted", queueWhileSending: true,
  admitWhileWorking: nativeApplicationAdmission, deferWhileWorking: snapshot => !nativeApplicationAdmission(snapshot),
  draftWhileLoading: true,
  // The app selects tab-local scope; the original shared runtime owns the
  // opaque draft/delivery format, restoration and write lifecycle.
  draftStorage: () => {
    try {
      const storage = typeof window !== "undefined" ? window.sessionStorage : null;
      return storage && actorKey.value && product.value.conversationId ? { storage,
        key: `vibe64:colleague-composer:v1:${JSON.stringify([actorKey.value, product.value.conversationId])}` } : null;
    } catch { return null; }
  },
  data: () => ({ clientId, focus: { ...props.focus } }),
  onEvent(event) {
    if (event.type === "application") {
      void conversation.runtime.value?.reload();
      void refresh();
    }
  },
  presentation: () => ({
    assistantLabel: props.name, systemLabel: "Vibe64", variant: "task", visible: open.value,
    userMessageFormat: "plain", progressPreviewLimit: 0,
    welcomeMessage: product.value.thread?.kind === "learn"
      ? "I'm your teacher here. Ask me about a lesson, or press Teach me on a step."
      : "Let's think it through. I can discuss an idea, check on your agents, or help you operate Vibe64.",
    previewMessage: voicePreview.value,
    ariaLabel: `Message ${props.name}`, placeholder: `Talk it through with ${props.name}…`, rows: 1, layout: "compact",
    submitAriaLabel: conversation.runtime.value?.steerable.value ? `Steer ${props.name}` : `Send to ${props.name}`,
    submitLabel: conversation.runtime.value?.steerable.value ? "Steer" : "Send"
  })
});
const voiceSession = computed(() => {
  const state = voice.controller.state;
  const identity = conversation.runtime.value?.identity;
  return isColleagueBinding(state?.binding) &&
    state.binding.conversationId === identity?.conversationId &&
    state.binding.id === JSON.stringify(["colleague", identity?.actorKey]) ? state.session : null;
});
// Colleague's voice controls belong to one conversation. After a thread switch
// (L, another lesson) they still hold the previous thread's conversation.
const staleVoice = computed(() => isColleagueBinding(voice.controller.state.binding) && !voiceSession.value);
// A shown Colleague stays shown and its voice controls follow to the new thread.
watch(() => conversation.runtime.value?.identity.conversationId, (id, previous) => {
  if (!id || !previous || !staleVoice.value || !voice.controller.state.visible) return;
  waitForConversation().then(() => staleVoice.value && openVoice()).catch(reportFailure);
});

const { voicePreviews, voicePreview } = useColleagueVoicePreviews({ voiceTranscript, voiceSession, conversation, isMounted });
const bodyVisible = computed(() => open.value || Boolean((voiceSession.value || staleVoice.value) && voice.controller.state.visible));

const adapter = computed(() => {
  const supplied = conversation.adapter.value;
  return { ...supplied,
    conversation: { ...supplied.conversation, reloadable: false, retainWhenHidden: true, visible: bodyVisible.value, previewMessages: voicePreviews.value },
    composer: { ...supplied.composer, canSend: supplied.composer.canSend && !voiceSession.value?.composerBlocked.value && !freshOperation.value && !freshBusy.value }
  };
});
const draft = computed({ get: () => adapter.value.composer.draft, set: value => adapter.value.actions.setDraft(value) });
const voiceFeedbackTarget = ref(null);
const sending = computed(() => conversation.runtime.value?.delivery.state.sending === true);
const connectionError = computed(() => productError.value || conversation.runtime.value?.error.value || "");
// A native snapshot reports no error as an empty string; it must not hide a
// failed Colleague turn such as an unverified application operation.
const turnError = computed(() => conversation.runtime.value?.snapshot.value?.error || product.value.error);
const { historyOpen, historyLoading, historyError, historyConversations, historyHasMore, historyId, historyPages,
  historyUnconfirmed, historyUnconfirmedDelivery, historyTurns, historyPagination, closeHistory, loadHistory, readHistoryPage
} = useColleagueHistory({ actorKey, requestColleague, isMounted });
const { freshConfirm, freshBusy, freshError, freshOperation, freshBlocked, showFreshConfirmation, closeFreshConfirmation, startFresh } =
  useColleagueFreshStart({ conversation, voice, voiceSession, voiceTranscript, actorKey, product, productError, pointerNotice, open,
    working, sending, isMounted, nextRevision: () => ++revision, requestColleague, apply, openVoice, closeHistory, reportFailure });
realtimeSocket.on("connect", refresh);
// The server picks the thread from the mode and the current lesson.
useRealtimeEvent({
  event: VIBE64_TRAINING_LEARNER_CHANGED_EVENT,
  matches: ({ payload } = {}) => ["learning-mode", "lesson"].includes(payload?.reason),
  onEvent: () => { void refresh(); }
});
async function refresh(options = {}) {
  // A lost fresh response must be retried by its original operation, not
  // silently retargeted by a background product read.
  if (freshOperation.value) return;
  const expectedRevision = ++revision;
  const expectedActor = actorKey.value;
  try {
    const result = await requestColleague(`?clientId=${encodeURIComponent(clientId)}`, { method: "GET" });
    apply(result, expectedRevision, expectedActor, options?.allowRetarget === true);
    if (mounted && expectedRevision === revision && expectedActor === actorKey.value) productError.value = "";
  } catch (error) {
    if (mounted && expectedRevision === revision && expectedActor === actorKey.value) productError.value = error.message;
  }
}
async function sendMessage(message, options = {}, target = conversation.runtime.value) {
  if (!target?.available.value) return false;
  return target.send({ message, data: { clientId, focus: options.focus } }, { messageId: options.messageId });
}
/** Resolves with Colleague's available conversation; fails after timeoutMs or once Colleague leaves this view. */
function waitForConversation(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stop = null;
    const timer = setTimeout(() => finish(new Error(connectionError.value || "Colleague is not connected yet. Press Teach me again.")), timeoutMs);
    function finish(error, target) {
      clearTimeout(timer);
      if (stop) stop();
      else queueMicrotask(() => stop?.());
      if (error) reject(error);
      else resolve(target);
    }
    stop = watch(() => conversation.runtime.value?.available.value ? conversation.runtime.value : null, target => {
      if (!mounted) finish(new Error("Colleague left this browser view."));
      else if (target) finish(null, target);
    }, { immediate: true });
  });
}
// Teach me on a step: reveal this conversation (voice stays as it is) and send
// the step's fixed message through the ordinary send with the current browser focus.
const { teachNeedsModel, revealForLearning } = useColleagueTeachMe({ product, refresh, reopenConversation, waitForConversation,
  bodyVisible, focusConversationComposer });
const stopLearningRequests = watchColleagueLearningRequests({ learning: learningController.value, actorKey: () => actorKey.value,
  reveal: revealForLearning, report: reportFailure,
  send: async message => sendMessage(message, { focus: { ...props.focus } }) });
onBeforeUnmount(stopLearningRequests);
async function submit() {
  if (freshOperation.value || freshBusy.value || voiceSession.value?.composerBlocked.value) return;
  const target = conversation.runtime.value;
  // Without an AI the banner already says what to do; the draft stays put.
  if (product.value.modelSetupRequired) return;
  if (!target?.canSubmit.value) {
    if (draft.value.trim() && connectionError.value) reportFailure(connectionError.value);
    return;
  }
  const result = await adapter.value.actions.submit();
  if ((result === false || result?.ok === false) && target.current.value) {
    const failure = target.delivery.find(target.draftMessageId.value)?.error || target.error.value;
    // A missing AI shows once, as the banner, not again as a snackbar.
    await refresh();
    if (failure && !product.value.modelSetupRequired) reportFailure(failure);
  }
}
async function stop() {
  const target = conversation.runtime.value;
  if (await target?.cancel() === false && target.current.value && target.error.value) reportFailure(target.error.value);
}
// `selection` is { assistantSelection }. Only the model menu reports failures here.
async function saveSelection(selection, { report = true } = {}) {
  if (freshOperation.value || freshBusy.value) return { ok: false, error: "Colleague is busy; try again in a moment." };
  const expectedRevision = ++revision;
  const expectedActor = actorKey.value;
  try {
    const result = await api.selectConversation(product.value.conversationId, selection);
    apply(result, expectedRevision, expectedActor);
    if (mounted && expectedActor === actorKey.value) {
      productError.value = "";
      conversation.runtime.value?.reload();
    }
    return result;
  } catch (error) {
    if (report && expectedActor === actorKey.value) reportFailure(error);
    return { ok: false, error: String(error?.message || error) };
  }
}
const selectModel = assistantSelection => saveSelection({ assistantSelection });
// AI onboarding reads and switches this Colleague's model through the bridge.
const colleagueModel = createColleagueModel({ product, productError, refresh, requestColleague, saveSelection, waitForConversation,
  sendMessage, reopenConversation, focusConversationComposer, readFocus: () => props.focus });
let unregisterModel = null;
const { watchDetails, operationDetails, watches, operations, assignments, watchControlCount, changeWatch, openOperationTarget,
  prepareOperationRecovery } = useColleagueWatchesAndOperations({ product, draft, requestColleague, refresh, reportFailure,
  readNavigate: () => props.navigate });
watch(open, value => { if (value) void refresh(); });
watch(actorKey, () => {
  revision += 1;
  freshOperation.value = null;
  freshConfirm.value = false;
  freshBusy.value = false;
  freshError.value = "";
  closeHistory();
  watchDetails.value = false;
  product.value = { conversationId: "", error: "" };
  productError.value = "";
  pointerNotice.value = "";
  colleagueNavigation.reset();
  voiceTranscript.value = null;
  void refresh();
}, { flush: "sync" });
const focusBinding = createColleagueFocusBinding({ socket: realtimeSocket,
  readFocus: () => ({ clientId, focus: props.focus }),
  onError: message => { if (mounted) productError.value = message; }
});
watch([actorKey, () => props.focus], ([actor], [previousActor]) => {
  if (previousActor !== undefined && actor !== previousActor) focusBinding.release();
  focusBinding.update();
}, { deep: true, immediate: true });
onMounted(() => {
  if (voice) voice.launcher.value = launcher.value?.$el;
  void refresh();
  unregisterModel = registerVibe64ColleagueModel(colleagueModel);
  window.addEventListener("blur", cancelAvatarPress);
  window.addEventListener("pagehide", cancelAvatarPress);
});
onBeforeUnmount(() => {
  if (voice.launcher.value === launcher.value?.$el) voice.launcher.value = null;
  realtimeSocket.off("connect", refresh);
  focusBinding.close();
  unregisterModel?.();
  mounted = false;
  if (isColleagueBinding(voice.controller.state.binding)) void voice.controller.end({ discard: true });
  cancelAvatarPress();
  revision += 1;
  window.removeEventListener("blur", cancelAvatarPress);
  window.removeEventListener("pagehide", cancelAvatarPress);
});
</script>

<template>
  <Teleport :to="launcherTarget || 'body'" :disabled="!launcherTarget">
    <v-btn
      ref="launcher" class="vibe64-colleague__launcher" :class="{ 'vibe64-colleague__launcher--floating': !launcherTarget, 'vibe64-colleague__launcher--listening': holdingAvatar }"
      icon variant="text" width="48" height="48" data-vibe64-guide="colleague"
      :aria-label="shown ? `Minimize ${voice.controller.state.binding?.label || name}` : minimizedVoice ? `Reopen ${voice.controller.state.binding.label || 'Assistant'} voice chat${listeningVoice ? ' · Listening' : ''}` : `Open ${name}`"
      :title="shown ? 'Minimize conversation' : listeningVoice ? 'Listening · Reopen voice chat' : minimizedVoice ? 'Reopen voice chat' : holdToTalk ? `${name} · Hold to talk` : name" aria-haspopup="dialog"
      :aria-expanded="shown"
      @pointerdown="startAvatarPress" @pointerup="endAvatarPress" @pointercancel="cancelAvatarPress" @lostpointercapture="cancelAvatarPress"
      @click.capture="avatarClick" @click="toggleConversation($event).catch(reportFailure)" @contextmenu.prevent
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
  <VNavigationDrawer
    :model-value="bodyVisible && !xs" location="right" :width="380" :order="1" :mobile="false" :scrim="false"
    disable-resize-watcher disable-route-watcher touchless tag="section" :aria-label="`${name} conversation`"
    @keydown.esc.stop="closeText"
  >
    <div class="vibe64-colleague__drawer">
      <header class="vibe64-colleague__drawer-header">
        <span class="text-title-large">{{ name }}</span>
        <v-btn v-if="learningStep && !xs" v-bind="stepButton" @click="showLearningStep">
          <v-icon :icon="learningStep.passed ? mdiCheck : mdiSchoolOutline" size="18" start />Step {{ learningStep.position }}/{{ learningStep.total }}
        </v-btn>
        <v-btn :icon="mdiMinus" variant="text" aria-label="Minimize conversation" title="Minimize conversation" @click="toggleConversation($event).catch(reportFailure)" />
        <v-btn :icon="mdiClose" variant="text" :aria-label="`Close ${name}`" :title="`Close ${name}`" @click="closeText" />
      </header>
      <ConversationDialog presentation="inline" :title="name" class="vibe64-colleague__inline">
        <div ref="desktopPanelTarget" class="vibe64-colleague__panel" />
      </ConversationDialog>
    </div>
  </VNavigationDrawer>
  <ConversationDialog
    :model-value="bodyVisible && xs" :title="name" :close-label="`Close ${name}`" minimizable
    :activator="launcher?.$el" :open-on-click="false" eager
    @update:model-value="value => !value && closeText()" @minimize="toggleConversation($event).catch(reportFailure)"
  >
    <template v-if="learningStep && xs" #header-actions>
      <v-btn v-bind="stepButton" @click="showLearningStep">
        <v-icon :icon="learningStep.passed ? mdiCheck : mdiSchoolOutline" size="18" start />Step {{ learningStep.position }}/{{ learningStep.total }}
      </v-btn>
    </template>
    <div ref="panelTarget" class="vibe64-colleague__panel" />
  </ConversationDialog>
  <Teleport :to="voicePanelTarget || conversationTarget || 'body'" :disabled="!voicePanelTarget && !conversationTarget">
    <aside v-show="bodyVisible" class="vibe64-colleague" :aria-label="name">
      <div v-if="!product.modelSetupRequired" class="vibe64-colleague__nudge"><AiOnboardingNudge /></div>
      <v-alert v-if="voiceSession && !voicePanelTarget && voice.controller.state.error" type="error" density="compact" role="alert">{{ voice.controller.state.error }}</v-alert>
      <v-alert v-if="pointerNotice" variant="tonal" type="info" role="status">
        <p>{{ pointerNotice }}</p>
        <v-btn :disabled="Boolean(voiceSession?.hasUnsentSpeech.value)" @click="refresh({ allowRetarget: true })">Refresh conversation</v-btn>
      </v-alert>
      <v-alert v-if="product.modelSetupRequired" class="vibe64-colleague__notice" variant="tonal" type="warning" role="status">
        <p v-if="teachNeedsModel" data-test="colleague-teach-needs-model">Connect an AI first, then press Teach me again. Nothing was sent.</p>
        <p v-else>Connect an AI first. Your message stays here until you do.</p>
        <v-btn variant="flat" color="primary" min-height="48" @click="requestVibe64AiOnboarding()">Set up your AI</v-btn>
      </v-alert>
      <div class="vibe64-colleague__conversation">
        <AssistantConversationElement :adapter="adapter" :label="`${name} conversation`" v-model:avatar-size="avatarSize">
          <template v-if="$slots.avatar && avatarVisible !== null" #avatar="size">
            <slot name="avatar" v-bind="voiceSession?.avatarVisual.value || { state: working ? 'thinking' : 'idle' }" :size="size.size" :height="size.height" />
          </template>
          <template #avatar-tools>
            <div ref="voiceToolsTarget" class="vibe64-colleague__voice-tools" />
          </template>
          <template #avatar-control>
            <span v-if="avatarSize === 'hidden' && voiceSession?.voice.listening.value && !voiceSession.microphoneMuted.value" role="img" aria-label="Listening" title="Listening" class="d-inline-flex align-center text-primary">
              <v-icon size="20" :icon="mdiMicrophone" />
            </span>
            <span v-if="avatarSize === 'hidden' && voiceSession?.voice.speaking.value" role="img" aria-label="Speaking" title="Speaking" class="d-inline-flex align-center text-primary">
              <v-icon size="20" :icon="mdiVolumeHigh" />
            </span>
          </template>
          <template #system-message="{ message }">
            <AssistantConversationStatus :message="message" @check-delivery="adapter.actions.checkDelivery($event)" />
            <v-btn v-if="message.delivery" variant="tonal" min-height="48" :disabled="freshBusy" @click="showFreshConfirmation">Start fresh</v-btn>
          </template>
          <template #composer="{ adapter: { composer } }">
            <div class="vibe64-colleague__composer-region">
              <!-- Keep the dialog from handling Tab again after the input focuses Send. -->
              <AssistantPromptInput
                ref="composerInput" v-model="draft" class="vibe64-colleague__composer" :aria-label="composer.ariaLabel" :placeholder="composer.placeholder"
                :disabled="composer.disabled" :submit-enabled="composer.canSend" :rows="composer.rows" :density="composer.density"
                tab-to-submit @submit="submit" @tab-to-submit="sendButton?.$el?.focus()"
                @keydown.tab="$event.defaultPrevented && $event.stopPropagation()"
              >
                <template #input-start>
                  <span v-if="turnError && turnError !== adapter.conversation.error" class="text-body-small text-error" role="alert">{{ turnError }}</span>
                  <span v-else-if="connectionError && connectionError !== adapter.conversation.error" class="text-body-small" role="status" :title="connectionError">Reconnecting…</span>
                </template>
                <template #footer>
                  <div class="vibe64-colleague__composer-actions">
                    <v-btn
                      ref="modelButton" :icon="mdiTuneVariant" size="small" variant="text"
                      :aria-label="`Choose ${name} model`" :title="product.assistantSelection?.modelId || 'Choose model'"
                      :disabled="working || sending || Boolean(freshOperation)" @click="modelMenu = true"
                    />
                    <v-btn :icon="mdiHistory" size="small" variant="text" aria-label="Previous conversations" title="Previous conversations" @click="loadHistory()" />
                    <v-btn
                      v-if="operations.length" ref="operationButton" size="small" min-height="48" variant="text"
                      :aria-label="`Recent operations (${operations.length})`" title="Recent operations"
                      aria-haspopup="dialog" :aria-expanded="operationDetails" @click="operationDetails = true"
                    >
                      Operations {{ operations.length }}
                    </v-btn>
                    <v-btn
                      v-if="watches.length || assignments.length" ref="watchButton" size="small" min-height="48" variant="text"
                      :aria-label="`Watches and assignments (${watchControlCount})`" title="Watches and assignments"
                      aria-haspopup="dialog" :aria-expanded="watchDetails" @click="watchDetails = true"
                    >
                      <v-icon :icon="mdiEyeOutline" /><span class="ms-1">{{ watchControlCount }}</span>
                    </v-btn>
                    <v-btn v-if="freshOperation" variant="text" :disabled="freshBusy" @click="showFreshConfirmation">Resume fresh operation</v-btn>
                    <div class="vibe64-colleague__delivery">
                      <v-btn v-if="composer.canStop" :icon="mdiStop" size="small" variant="text" :aria-label="`Stop ${name}`" title="Stop assistant" @click="stop" />
                      <v-btn
                        ref="sendButton" :icon="working ? mdiArrowTopRight : mdiSend" size="small" variant="flat" color="primary"
                        :aria-label="composer.submitAriaLabel" :title="composer.submitLabel"
                        :disabled="!composer.canSend" @click="submit"
                      />
                    </div>
                  </div>
                  <div ref="voiceFeedbackTarget" class="vibe64-colleague__voice-feedback" />
                </template>
              </AssistantPromptInput>
              <VoiceConversationControls
                v-if="voiceSession" :key="voice.controller.state.binding.id" :session="voiceSession"
                :disabled="voice.controller.state.busy" compact icon-only :tools-target="voiceToolsTarget" :feedback-target="voiceFeedbackTarget" :review-in-transcript="Boolean(voicePreview)"
              >
                <template #settings-control>
                  <VoiceConversationSettings :voice="voiceSession.voice" compact @error="reportFailure">
                    <template v-if="voice.Settings" #default="settings"><component :is="voice.Settings" v-bind="settings" :binding="voice.controller.state.binding" /></template>
                  </VoiceConversationSettings>
                </template>
              </VoiceConversationControls>
            </div>
          </template>
        </AssistantConversationElement>
      </div>
      <Vibe64SessionAssistantMenu
        v-model="modelMenu" :target="modelButton?.$el" :selection="product.assistantSelection"
        :save-selection="selectModel" catalog-path="/api/vibe64/colleague/models" :changes-disabled="working || sending || Boolean(freshOperation)"
      />
    </aside>
  </Teleport>
  <ColleagueWatchesDialog
    v-model="watchDetails" :activator="watchButton?.$el || modelButton?.$el" :fullscreen="xs"
    :watches="watches" :assignments="assignments" @change-watch="changeWatch"
  />
  <ColleagueOperationsDialog
    v-model="operationDetails" :activator="operationButton?.$el || modelButton?.$el" :fullscreen="xs"
    :operations="operations" :can-open-targets="Boolean(props.navigate)"
    @open-target="openOperationTarget" @prepare-recovery="prepareOperationRecovery"
  />
  <ColleagueFreshDialog
    :open="freshConfirm" :busy="freshBusy" :blocked="freshBlocked" :error="freshError" :resuming="Boolean(freshOperation)"
    @close="closeFreshConfirmation" @start="startFresh"
  />
  <ConversationDialog :model-value="historyOpen" title="Previous conversations" close-label="Close previous conversations" @update:model-value="value => !value && closeHistory()">
    <div class="vibe64-colleague__history">
      <p>Read-only history. Unconfirmed words are annotations, not accepted messages.</p>
      <p v-if="historyError" role="alert">{{ historyError }}</p>
      <v-skeleton-loader v-if="historyLoading && !historyId" type="list-item-two-line@3" aria-label="Loading previous conversations" />
      <template v-if="!historyId">
        <v-btn variant="tonal" min-height="48" :disabled="freshBusy || Boolean(freshBlocked)" @click="showFreshConfirmation">Start fresh</v-btn>
        <p v-if="freshBlocked" role="status">{{ freshBlocked }}</p>
        <v-btn v-for="item in historyConversations" :key="item.conversationId" variant="text" min-height="48" :disabled="historyLoading" @click="readHistoryPage(item.conversationId)">
          {{ item.archivedAt }} · {{ item.unconfirmedCount }} unconfirmed
        </v-btn>
        <p v-if="!historyLoading && !historyConversations.length && !historyError">No previous conversations.</p>
        <v-btn v-if="historyHasMore" :disabled="historyLoading" @click="loadHistory({ more: true })">More conversations</v-btn>
      </template>
      <template v-else>
        <v-btn :disabled="historyLoading" @click="loadHistory()">Back to previous conversations</v-btn>
        <AssistantTranscript
          :turns="historyTurns"
          :assistant-label="name"
          :scroll-key="historyId"
          :loading="historyLoading && !historyPages.length"
          :has-more-before="historyPagination.hasMoreBefore"
          :loading-more="historyLoading && Boolean(historyPages.length)"
          :load-more-error="historyError"
          @load-more="readHistoryPage(historyId, { more: true, complete: $event.complete })"
        >
          <template #system-message="{ message }"><p>{{ message.text }}</p></template>
        </AssistantTranscript>
        <div v-for="message in historyUnconfirmed" :key="message.messageId" class="vibe64-colleague__history-annotation">
          <strong>Unconfirmed · client-reported words</strong><p>{{ message.text }}</p>
        </div>
        <p v-if="historyUnconfirmedDelivery">Delivery of {{ historyUnconfirmedDelivery.messageId }} remains unconfirmed.</p>
      </template>
    </div>
  </ConversationDialog>
</template>

<style scoped>
.vibe64-colleague { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); }
.vibe64-colleague__notice { flex: 0 0 auto; margin: 12px 12px 0; }
.vibe64-colleague__notice p { margin-bottom: 12px; }
.vibe64-colleague__nudge { flex: 0 0 auto; padding: 12px 12px 0; }
.vibe64-colleague__nudge:empty { display: none; }
.vibe64-colleague__conversation { flex: 1; min-height: 0; display: flex; padding: 12px; }
.vibe64-colleague__conversation :deep(.assistant-conversation) { width: 100%; min-height: 0; }
.vibe64-colleague__conversation :deep(.assistant-conversation__avatar) { position: relative; align-self: flex-end; flex: 0 0 auto; }
.vibe64-colleague__conversation :deep(.assistant-conversation__avatar--hidden) { min-height: 48px; }
.vibe64-colleague__conversation :deep(.assistant-conversation__avatar--hidden .assistant-conversation__avatar-controls) { position: static; }
.vibe64-colleague__conversation :deep(.assistant-transcript__avatar--user) { display: none; }
.vibe64-colleague__conversation :deep(.assistant-transcript__assistant-header) { margin-bottom: 6px; }
.vibe64-colleague__conversation :deep(.studio-long-text-review__blocks > * + *) { margin-top: 0.6rem; }
.vibe64-colleague__composer { flex: 0 0 auto; }
.vibe64-colleague__composer-region { position: relative; flex: 0 0 auto; }
.vibe64-colleague__composer-actions, .vibe64-colleague__delivery { display: flex; align-items: center; gap: 4px; min-width: 0; }
.vibe64-colleague__composer-actions { width: 100%; flex-wrap: wrap; }
.vibe64-colleague__delivery { margin-inline-start: auto; flex-shrink: 0; }
.vibe64-colleague__voice-tools { display: flex; min-width: 0; }
@media (pointer: coarse), (max-width: 600px) {
  .vibe64-colleague__composer-actions :deep(.v-btn) { min-width: 48px; min-height: 48px; }
  .vibe64-colleague__voice-tools :deep(.v-btn),
  .vibe64-colleague :deep(.assistant-conversation__avatar-size) { min-width: 48px !important; min-height: 48px !important; }
}
.vibe64-colleague__launcher { flex: 0 0 48px; touch-action: none; user-select: none; -webkit-touch-callout: none; }
.vibe64-colleague__launcher--listening { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-colleague__launcher--floating { position: fixed; right: 8px; top: env(safe-area-inset-top, 0px); z-index: 1800; }
.vibe64-colleague__voice-stop { flex: 0 0 48px; }
.vibe64-colleague__voice-stop--floating { position: fixed; right: 56px; top: env(safe-area-inset-top, 0px); z-index: 1800; }
.vibe64-colleague__launcher-avatar { display: block; width: 36px; height: 36px; overflow: hidden; border-radius: 50%; }
.vibe64-colleague__launcher-avatar :deep(svg) { width: 100%; height: 100%; }
.vibe64-colleague__working { position: absolute; right: 5px; bottom: 5px; width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--v-theme-primary)); }
.vibe64-colleague__drawer { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.vibe64-colleague__drawer-header { display: flex; align-items: center; gap: 4px; padding: 8px 12px; flex: 0 0 auto; }
.vibe64-colleague__drawer-header > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-colleague__inline { flex: 1; overflow: hidden; }
.vibe64-colleague__inline :deep(.conversation-dialog__surface) { flex: 1; }
.vibe64-colleague__panel { display: flex; flex: 1; height: 100%; min-height: 0; min-width: 0; }
.vibe64-colleague__voice-badge { position: absolute; right: 0; bottom: 0; display: grid; place-items: center; width: 20px; height: 20px; border: 2px solid rgb(var(--v-theme-surface)); border-radius: 50%; background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); }
.vibe64-colleague__voice-badge--listening { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 1px; }
.vibe64-colleague__history { display: flex; flex-direction: column; gap: 8px; padding: 16px; min-height: 0; overflow: auto; }
.vibe64-colleague__history-annotation p { white-space: pre-wrap; overflow-wrap: anywhere; }
.vibe64-colleague__voice-feedback { flex: 1 1 100%; min-width: 0; }
.vibe64-colleague__step-button { flex: 0 0 auto; min-width: 0; padding: 0 12px; font-size: 0.875rem; line-height: 1.25rem; background: var(--v64-learning, #f5c518) !important; color: var(--v64-on-learning, #2b2100) !important; font-weight: 700; letter-spacing: 0; text-transform: none; }
.vibe64-colleague__step-button--passed { background: var(--v64-learning-container, #fdf3c4) !important; color: var(--v64-on-learning-container, inherit) !important; }
</style>
