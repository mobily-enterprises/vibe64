<script setup>
import { useVibe64Voice } from "@local/vibe64-voice/client";
import { ConversationDialog, VoiceConversationControls, VoiceConversationSettings, projectConversationVoiceState, useVoiceLauncher } from "@jskit-ai/assistant-voice/client";
import { useDisplay } from "vuetify";
import { VNavigationDrawer } from "vuetify/components";
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { mdiArrowTopRight, mdiClose, mdiEyeOutline, mdiHeadset, mdiHistory, mdiMicrophone, mdiMinus, mdiSend, mdiStop, mdiTuneVariant, mdiVolumeHigh } from "@mdi/js";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_COLLEAGUE_LAUNCHER_KEY, VIBE64_COLLEAGUE_PREVIEW_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY } from "/src/lib/vibe64AssistantHost.js";
import { AssistantConversationElement, AssistantConversationStatus, AssistantPromptInput, AssistantTranscript } from "@jskit-ai/assistant-core/client/conversation";
import { mergeConversationLogPages, normalizeConversationLogPage } from "@jskit-ai/assistant-core/shared/conversation";
import { createAssistantApi } from "@jskit-ai/assistant-core/client";
import { useAssistantConversation } from "@jskit-ai/assistant-runtime/client";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import Vibe64SessionAssistantMenu from "/src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";

const props = defineProps({
  name: { type: String, default: "Colleague" },
  holdToTalk: Boolean,
  request: { type: Function, required: true },
  navigate: { type: Function, default: null },
  settleWorkspace: { type: Function, default: null },
  focus: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["message-submit", "voice-visual"]);
const open = ref(false);
const { xs } = useDisplay();
const voice = useVibe64Voice();
const inlineVoice = computed(() => voice?.controller.state.binding?.presentation === "inline"
  && voice.controller.state.binding.socketUrl !== "/api/vibe64/colleague/voice/ws"
  && !voice.controller.state.nextTarget);
const shown = computed(() => open.value || Boolean(voice?.controller.state.visible && !inlineVoice.value));
const minimizedVoice = computed(() => Boolean(voice?.controller.state.session && !shown.value && !inlineVoice.value));
const listeningVoice = computed(() => Boolean(minimizedVoice.value && voice.controller.state.session.voice.listening.value && !voice.controller.state.session.microphoneMuted.value));
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
const voiceTranscript = ref(null);
const displayedPreview = inject(VIBE64_COLLEAGUE_PREVIEW_KEY, null);
const learnerGestures = inject(VIBE64_TRAINING_LEARNER_GESTURE_KEY, null);
const { holding: holdingAvatar, pointerDown: startAvatarPress, pointerUp: endAvatarPress,
  cancel: cancelAvatarPress, click: avatarClick } = useVoiceLauncher({
  open: openVoice, enabled: () => props.holdToTalk && !shown.value && !voice?.controller.state.session, onError: reportFailure
});
async function toggleConversation(event) {
  const ticket = beginNativeGesture(event, bodyVisible.value ? "colleague-minimize" : "colleague-restore");
  if (shown.value) {
    voice?.controller.minimize();
    open.value = false;
    launcher.value?.$el?.focus();
  } else if (voice?.controller.state.session && !inlineVoice.value) voice.controller.reveal();
  else if (voice) {
    open.value = true;
    await openVoice();
  } else open.value = true;
  if (ticket) void finishNativeGesture(ticket);
}
async function openVoice() {
  if (!voice || freshOperation.value || freshBusy.value) return false;
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
      const state = projectConversationVoiceState({ turns: target.turns.value, status: target.snapshot.value?.status, interimReply: target.snapshot.value?.interimReply });
      const cue = displayedPreview?.value?.presentation?.state.cue;
      // Provider streams are not classified as final until their completion.
      // Buffer this one armed explanation for speech; the transcript still streams.
      return cue?.clientId === clientId && cue.conversationId === target.identity.conversationId && cue.phase === "armed"
        ? { ...state, streamingReply: null } : state;
    },
    get available() { return mounted && target.current.value; },
    get adapter() { return conversation.runtime.value === target ? adapter.value : null; },
    setConversationTarget(element) { voicePanelTarget.value = element; },
    retain() { retained = target.retain(); },
    release() { retained?.release(); retained = null; },
    socketUrl: "/api/vibe64/colleague/voice/ws",
    captureContext: () => ({
      ...props.focus,
      ...(product.value.trainingQuestion ? { trainingQuestion: { ...product.value.trainingQuestion } } : {})
    }),
    submitText(text, { messageId, context }) {
      const { trainingQuestion, ...focus } = context || {};
      return sendMessage(text, { messageId, focus, trainingQuestion }, target);
    },
    cancelWork: () => target.cancel(),
    onTranscript(value, { canTake = false } = {}) {
      if (mounted && conversation.runtime.value === target) voiceTranscript.value = value ? { ...value, canTake } : null;
    },
    onPlayback(event) {
      if (voiceSession.value && event.conversationId === target.identity.conversationId) {
        if (event.phase === "started") audibleOutput = { conversationId: event.conversationId, outputId: event.outputId };
        else if (audibleOutput?.conversationId === event.conversationId && audibleOutput.outputId === event.outputId) audibleOutput = null;
      }
      displayedPreview?.value?.presentation?.playback(event);
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
    if (voice?.controller.state.session) await voice.controller.end({ discard: true });
    open.value = false;
    launcher.value?.$el?.focus();
  } catch (error) { reportFailure(error); }
}
const launcherTarget = inject(VIBE64_COLLEAGUE_LAUNCHER_KEY, null);
const launcher = ref(null);
const panelTarget = ref(null);
const desktopPanelTarget = ref(null);
const conversationTarget = computed(() => xs.value ? panelTarget.value : desktopPanelTarget.value);
const voicePanelTarget = ref(null);
const voiceToolsTarget = ref(null);
const avatarSize = ref("compact");
const product = ref({ conversationId: "", error: "" });
const productError = ref("");
const pointerNotice = ref("");
const actorKey = computed(() => viewer?.value?.actorKey || viewer?.actorKey || "");
const feedback = useShellWebErrorRuntime();
const watchDetails = ref(false);
const watchButton = ref(null);
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
let cueReporting = null;
let cueReported = "";
let audibleOutput = null;

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
  if (changingConversation && runtime?.current.value && runtime.identity.actorKey === expectedActor) {
    if (voiceSession.value?.hasUnsentSpeech.value || pointerNotice.value && !allowRetarget) {
      pointerNotice.value = "Colleague changed in another tab. Resolve the old speech first: pause the microphone and discard newer words, or explicitly Stop voice chat. Then choose Refresh conversation. Your typed draft stays unsent.";
      return false;
    }
  }
  // The original runtime owns drafts. Preserve the same person's CURRENT draft
  // before its binding changes; actor changes never enter this copy path.
  const savedDraft = changingConversation && runtime?.current.value && runtime.identity.actorKey === expectedActor
    ? runtime.draft.value : null;
  const { conversationId, assistantSelection, watches, assignments, navigation, operation, error, cue, trainingQuestion } = result;
  product.value = { conversationId, assistantSelection, watches, assignments, navigation, operation, error, cue, trainingQuestion };
  observePresentationCue(cue);
  if (savedDraft !== null && actorKey.value === expectedActor) conversation.adapter.value.actions.setDraft(savedDraft);
  pointerNotice.value = "";
  void handleNavigation(navigation);
  return true;
}
async function handleNavigation(command) {
  if (navigating || command?.status !== "pending" || !props.navigate) return;
  navigating = command.id;
  const expectedActor = actorKey.value;
  try {
    if (xs.value && shown.value && ["open", "cue"].includes(command.presentation?.operation)) await toggleConversation();
    if (navigationReceipt?.commandId !== command.id) {
      let receipt;
      try {
        const result = await props.navigate(command);
        receipt = { commandId: command.id, clientId, ok: true,
          ...(command.presentation ? { focus: result.focus, presentation: result.presentation } : { focus: result }) };
      }
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
  clearDraftOn: "accepted", queueWhileSending: true, deferWhileWorking: true, draftWhileLoading: true,
  // The app selects tab-local scope; the original shared runtime owns the
  // opaque draft/delivery format, restoration and write lifecycle.
  draftStorage: () => {
    try {
      const storage = typeof window !== "undefined" ? window.sessionStorage : null;
      return storage && actorKey.value && product.value.conversationId ? { storage,
        key: `vibe64:colleague-composer:v1:${JSON.stringify([actorKey.value, product.value.conversationId])}` } : null;
    } catch { return null; }
  },
  data: () => ({
    clientId, focus: { ...props.focus },
    ...(product.value.trainingQuestion ? { trainingQuestion: { ...product.value.trainingQuestion } } : {})
  }),
  onEvent(event) {
    if (event.presentationCue) observePresentationCue(event.presentationCue);
    if (event.type === "application") void refresh();
  },
  presentation: () => ({
    assistantLabel: props.name, systemLabel: "Vibe64", variant: "task", visible: open.value,
    userMessageFormat: "plain", progressPreviewLimit: 0,
    welcomeMessage: "Let's think it through. I can discuss an idea, check on your agents, or help you operate Vibe64.",
    previewMessage: voicePreview.value,
    ariaLabel: `Message ${props.name}`, placeholder: `Talk it through with ${props.name}…`, rows: 1, layout: "compact",
    submitAriaLabel: conversation.runtime.value?.steerable.value ? `Steer ${props.name}` : `Send to ${props.name}`,
    submitLabel: conversation.runtime.value?.steerable.value ? "Steer" : "Send"
  })
});
const voiceSession = computed(() => {
  const state = voice?.controller.state;
  const identity = conversation.runtime.value?.identity;
  return state?.binding?.socketUrl === "/api/vibe64/colleague/voice/ws" &&
    state.binding.conversationId === identity?.conversationId &&
    state.binding.id === JSON.stringify(["colleague", identity?.actorKey]) ? state.session : null;
});
function observePresentationCue(value) {
  if (!mounted || !value || value.clientId !== clientId || value.conversationId !== product.value.conversationId) return false;
  return displayedPreview?.value?.presentation?.observeCue(value, { readAloud: voiceSession.value?.readAloud?.value === true }) || false;
}

watch(() => displayedPreview?.value?.presentation?.state.cue, value => {
  const session = voiceSession.value;
  if (value?.phase !== "interrupted" || value.clientId !== clientId || value.audioPhase !== "started" || !session ||
      audibleOutput?.conversationId !== value.conversationId || audibleOutput.outputId !== value.outputId ||
      conversation.runtime.value?.identity.conversationId !== value.conversationId) return;
  audibleOutput = null;
  // Deliberate diagram retirement uses the existing whole-binding audio stop.
  // A later output or mere drawer minimise never enters this identity fence.
  session.stopSpeech();
}, { flush: "sync" });

watch(() => displayedPreview?.value?.presentation?.state.cue, async value => {
  if (!mounted || !value || value.clientId !== clientId || value.conversationId !== product.value.conversationId ||
      !["completed", "interrupted", "failed"].includes(value.phase)) return;
  const receipt = JSON.stringify(value);
  if (cueReported === receipt || cueReporting === receipt) return;
  cueReporting = receipt;
  const expectedActor = actorKey.value;
  try {
    await requestColleague("/navigation/ack", { method: "POST", body: {
      clientId, commandId: value.navigationId, ok: true, cue: value
    } });
    if (mounted && expectedActor === actorKey.value) cueReported = receipt;
  } catch {
    if (mounted && expectedActor === actorKey.value) productError.value = "The lesson cue receipt was not confirmed. Read its current status before continuing.";
  } finally {
    if (cueReporting === receipt) cueReporting = null;
  }
});

function voicePreviewActionsAllowed(messageId) {
  const transcript = voiceTranscript.value;
  const session = voiceSession.value;
  const runtime = conversation.runtime.value;
  const pending = session?.pendingTranscript.value;
  const selected = pending?.messageId === messageId || transcript?.id === messageId && transcript.canTake;
  const receipt = runtime?.delivery.find?.(messageId);
  return Boolean(selected && session && session.canTakeTranscript(messageId) && !session.sending.value &&
    (!receipt || receipt.status === "failed") &&
    (!receipt || !runtime?.delivery.state.messages.some(message => message.status === "uncertain")));
}
function selectedVoiceTranscriptSession(messageId) {
  const runtime = conversation.runtime.value;
  if (!mounted || !runtime?.current.value || !voicePreviewActionsAllowed(messageId)) return null;
  return voiceSession.value;
}
async function takeVoiceTranscript(messageId) {
  const session = selectedVoiceTranscriptSession(messageId);
  if (!session) return false;
  const runtime = conversation.runtime.value;
  if (!await session.takeTranscript(messageId)) return false;
  if (runtime.delivery.find?.(messageId)?.status === "failed") runtime.delivery.cancel(messageId);
  return true;
}
async function editVoiceTranscript(messageId) {
  const session = selectedVoiceTranscriptSession(messageId);
  if (!session) return false;
  const runtime = conversation.runtime.value;
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
  if (pending?.messageId !== messageId || !pending.text.trim() ||
    conversation.runtime.value?.delivery.state.messages.some(message => message.status === "uncertain")) return false;
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
      canSend: Boolean(review && allowed && !session.sending.value && pending.text.trim() &&
        !conversation.runtime.value?.delivery.state.messages.some(message => message.status === "uncertain")),
      sending: Boolean(review && session.sending.value)
    } };
  });
});
const voicePreview = computed(() => voicePreviews.value.find(preview => preview.id === voiceTranscript.value?.id)
  || voicePreviews.value[0] || null);
const bodyVisible = computed(() => open.value || Boolean(voiceSession.value && voice.controller.state.visible));
const nativeTickets = new Map();
const nativeControls = ["project-select", "session-select", "preview-select", "chat-show", "colleague-minimize", "colleague-restore"];
function nativeQuestion() {
  const question = product.value.trainingQuestion;
  if (!question || !["workspace-navigation", "return-to-colleague", "try-the-application"].includes(question.assessmentId)) return null;
  return Object.freeze(Object.fromEntries(["attemptId", "questionId", "assessmentId", "issuedRevision", "topicHash", "lessonHash"]
    .map(key => [key, question[key]])));
}
function nativeScopeCurrent(ticket) {
  return mounted && nativeTickets.has(ticket) && actorKey.value === ticket.actorKey &&
    product.value.conversationId === ticket.conversationId && JSON.stringify(nativeQuestion()) === JSON.stringify(ticket.reference);
}
function beginNativeGesture(event, control, target = {}) {
  const reference = nativeQuestion();
  if (!mounted || !event?.isTrusted || event.type !== "click" || !nativeControls.includes(control) ||
      !reference || reference.assessmentId === "try-the-application" || !actorKey.value || !product.value.conversationId || !props.settleWorkspace || nativeTickets.size >= 8 ||
      (control === "colleague-minimize" && !bodyVisible.value) || (control === "colleague-restore" && bodyVisible.value)) return null;
  if (reference.assessmentId !== "return-to-colleague" &&
      ["colleague-minimize", "colleague-restore"].includes(control)) return null;
  const projectSlug = target.projectSlug || props.focus.projectSlug;
  const sessionId = target.sessionId || (!target.projectSlug || target.projectSlug === props.focus.projectSlug ? props.focus.sessionId : "");
  const ticket = Object.freeze({ actorKey: actorKey.value, conversationId: product.value.conversationId,
    reference, gestureId: crypto.randomUUID(), control, target: Object.freeze({ projectSlug, sessionId }) });
  nativeTickets.set(ticket, true);
  return ticket;
}
async function finishNativeGesture(ticket) {
  if (!nativeScopeCurrent(ticket)) return false;
  try {
    const workspace = await props.settleWorkspace({ control: ticket.control, ...ticket.target }, () => nativeScopeCurrent(ticket));
    if (!nativeScopeCurrent(ticket)) return false;
    if (ticket.control === "colleague-minimize" && bodyVisible.value) return false;
    if (ticket.control === "colleague-restore" && !bodyVisible.value) return false;
    const result = await requestColleague("/training/observations", { method: "POST", body: {
      clientId, conversationId: ticket.conversationId, gestureId: ticket.gestureId, control: ticket.control,
      reference: ticket.reference, workspace: { ...workspace, colleagueVisible: bodyVisible.value }
    } });
    if (!nativeScopeCurrent(ticket)) return false;
    return result;
  } catch (error) {
    if (nativeScopeCurrent(ticket)) {
      reportFailure(new Error(`The lesson observation was not confirmed. Repeat this step; your workspace action was not undone. ${error.message}`));
    }
    return false;
  } finally {
    nativeTickets.delete(ticket);
  }
}
function beginExercise(frame, currentFrame) {
  const reference = nativeQuestion();
  if (!mounted || reference?.assessmentId !== "try-the-application" || !actorKey.value || !product.value.conversationId ||
      !props.settleWorkspace || nativeTickets.size >= 8 || !currentFrame() ||
      frame.projectSlug !== props.focus.projectSlug || frame.sessionId !== props.focus.sessionId ||
      props.focus.pane !== "preview" || (xs.value && bodyVisible.value)) return null;
  const ticket = Object.freeze({ actorKey: actorKey.value, conversationId: product.value.conversationId,
    reference, gestureId: crypto.randomUUID(), control: "exercise-response", currentFrame,
    target: Object.freeze({ projectSlug: frame.projectSlug, sessionId: frame.sessionId }),
    exercise: Object.freeze({ instanceId: frame.instanceId, interactionId: frame.interactionId,
      playerInstanceId: frame.playerInstanceId, frameRequestId: frame.frameRequestId }) });
  nativeTickets.set(ticket, true);
  return ticket;
}
function exerciseCurrent(ticket) {
  return nativeScopeCurrent(ticket) && ticket.currentFrame() && props.focus.pane === "preview" &&
    props.focus.projectSlug === ticket.target.projectSlug && props.focus.sessionId === ticket.target.sessionId &&
    !(xs.value && bodyVisible.value);
}
async function finishExercise(ticket, response = null) {
  try {
    // An omitted response retires an unfinished interaction without sending an observation.
    if (!response || !exerciseCurrent(ticket)) return false;
    const workspace = await props.settleWorkspace({ control: ticket.control, ...ticket.target }, () => exerciseCurrent(ticket));
    if (!exerciseCurrent(ticket)) return false;
    const result = await requestColleague("/training/observations", { method: "POST", body: {
      clientId, conversationId: ticket.conversationId, gestureId: ticket.gestureId, control: ticket.control,
      reference: ticket.reference, workspace: { ...workspace, colleagueVisible: bodyVisible.value },
      exercise: { ...ticket.exercise, requestId: response.requestId }
    } });
    return exerciseCurrent(ticket) ? result : false;
  } catch (error) {
    if (exerciseCurrent(ticket)) {
      reportFailure(new Error(`The application observation was not confirmed. Press Ask the server again when Preview is ready. ${error.message}`));
    }
    return false;
  } finally {
    nativeTickets.delete(ticket);
  }
}
const nativeGestureOwner = { begin: beginNativeGesture, finish: finishNativeGesture, beginExercise, finishExercise };
watch(() => [actorKey.value, product.value.conversationId, JSON.stringify(nativeQuestion())], () => nativeTickets.clear(), { flush: "sync" });
watch(() => [props.focus.projectSlug, props.focus.sessionId, props.focus.pane, xs.value, bodyVisible.value], () => {
  for (const ticket of nativeTickets.keys()) {
    if (ticket.control === "exercise-response" && !exerciseCurrent(ticket)) nativeTickets.delete(ticket);
  }
}, { flush: "sync" });

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
const turnError = computed(() => conversation.runtime.value?.snapshot.value?.error ?? product.value.error);
const freshConfirm = ref(false);
const freshBusy = ref(false);
const freshError = ref("");
// Only the pending operator request is retained here. Durable idempotency and
// archived delivery evidence belong to the original server owner.
const freshOperation = shallowRef(null);
const freshBlocked = computed(() => {
  if (pointerNotice.value) return "Colleague already changed in another tab. Resolve the old speech, then choose Refresh conversation instead of starting another fresh request.";
  const runtime = conversation.runtime.value;
  if (!runtime?.current.value || working.value || sending.value || runtime.stopping.value) {
    return "Wait for the current request or Stop to finish before starting fresh.";
  }
  if (voice?.controller.state.busy || voice?.controller.state.nextTarget) return "Finish the pending voice switch before starting fresh.";
  const session = voiceSession.value;
  if (!session) return "";
  if (session.starting?.value || session.capturing?.value || session.sending.value) {
    return "Pause the microphone, then discard newer unsent speech with its X before starting fresh. You can also explicitly stop voice chat.";
  }
  const pending = session.pendingTranscript.value;
  if (pending && runtime.delivery.find(pending.messageId)?.status !== "uncertain") {
    return "Send or discard the reviewed speech before starting fresh.";
  }
  return "";
});
function showFreshConfirmation() {
  closeHistory();
  freshError.value = "";
  freshConfirm.value = true;
}
function closeFreshConfirmation() {
  if (!freshBusy.value) freshConfirm.value = false;
}
function freshScopeCurrent(operation) {
  return mounted && actorKey.value === operation.actor && conversation.runtime.value === operation.runtime &&
    product.value.conversationId === operation.body.expectedConversationId;
}
async function startFresh() {
  if (freshBusy.value) return false;
  if (freshBlocked.value) { freshError.value = freshBlocked.value; return false; }
  let operation = freshOperation.value;
  if (!operation) {
    const runtime = conversation.runtime.value;
    const unconfirmedMessages = runtime.delivery.state.messages.filter(message => message.status === "uncertain").map(message => {
      const request = message.payload?.request;
      const data = request?.data || message.payload?.data;
      return { messageId: message.id, text: request?.text ?? message.payload?.message,
        clientId: data?.clientId, ...(data?.focus ? { focus: { ...data.focus } } : {}) };
    });
    if (unconfirmedMessages.length > 8 || unconfirmedMessages.some(message =>
      typeof message.text !== "string" || !message.text.trim() || message.text.length > 24000 || !message.clientId)) {
      freshError.value = "The original uncertain delivery evidence is incomplete or too large. Check delivery before starting fresh.";
      return false;
    }
    operation = { actor: actorKey.value, runtime, session: voiceSession.value,
      binding: voiceSession.value ? voice.controller.state.binding : null,
      body: { operationId: crypto.randomUUID(), expectedConversationId: product.value.conversationId, unconfirmedMessages } };
    // Invalidate a product read that began before this operation. Its late
    // pointer cannot retire the original binding while archive is unresolved.
    revision += 1;
    freshOperation.value = operation;
  }
  if (!freshScopeCurrent(operation)) return false;
  freshBusy.value = true;
  freshError.value = "";
  try {
    const result = await requestColleague("/conversations/fresh", { method: "POST", body: operation.body });
    if (!freshScopeCurrent(operation)) return false;
    if (result.fresh?.operationId !== operation.body.operationId ||
      result.fresh.previousConversationId !== operation.body.expectedConversationId ||
      !result.fresh.conversationId || !result.conversationId) throw new Error("The fresh conversation receipt did not match this request. Retry the same operation.");
    // Archive success alone cannot discard speech captured while HTTP was held,
    // or end a different assistant that the person opened in the meantime.
    if (freshBlocked.value || operation.session && voice.controller.state.session && (voice.controller.state.session !== operation.session ||
      voice.controller.state.binding !== operation.binding)) {
      throw new Error(freshBlocked.value || "The voice conversation changed. Return to the original conversation before retrying this fresh operation.");
    }
    if (operation.session && voice.controller.state.session === operation.session) await voice.controller.end({ discard: true });
    if (!freshScopeCurrent(operation)) return false;
    if (operation.session && (voice.controller.state.session || voice.controller.state.busy || voice.controller.state.nextTarget)) {
      throw new Error("Another voice conversation opened during retirement. Resolve it before retrying this fresh operation.");
    }
    // The original apply owner preserves the latest same-actor draft while
    // following the CURRENT server pointer, never a historic receipt successor.
    apply(result, ++revision, operation.actor, true);
    if (mounted && actorKey.value === operation.actor && product.value.conversationId === result.conversationId) {
      freshBusy.value = false;
      freshOperation.value = null;
      freshConfirm.value = false;
      productError.value = "";
      open.value = true;
      voiceTranscript.value = null;
      const controller = voice?.controller;
      if (controller && !controller.state.session && !controller.state.binding && !controller.state.busy && !controller.state.nextTarget) {
        // Restore the original controls with a paused binding. Archive success
        // is already committed; presentation failure must not repeat it.
        try { await openVoice(); }
        catch (error) {
          if (mounted && actorKey.value === operation.actor && product.value.conversationId === result.conversationId) {
            reportFailure(new Error(`The fresh conversation is ready, but its voice controls could not open. Reopen Colleague to try again. ${error.message}`));
          }
        }
        if (!mounted || actorKey.value !== operation.actor || product.value.conversationId !== result.conversationId) return false;
        open.value = true;
      }
      return true;
    }
    return false;
  } catch (error) {
    if (freshScopeCurrent(operation)) freshError.value = `${error.message} Nothing was resent. Retry this same fresh operation to check its result.`;
    return false;
  } finally {
    if (freshOperation.value === operation) freshBusy.value = false;
  }
}

const historyOpen = ref(false);
const historyLoading = ref(false);
const historyError = ref("");
const historyConversations = ref([]);
const historyNextOffset = ref(null);
const historyHasMore = ref(false);
const historyId = ref("");
const historyPages = ref([]);
const historyUnconfirmed = ref([]);
const historyUnconfirmedDelivery = ref(null);
const historyTurns = computed(() => mergeConversationLogPages(historyPages.value).conversationLog);
const historyPagination = computed(() => historyPages.value[0]?.pagination || {});
let historyRevision = 0;
function closeHistory() {
  historyRevision += 1;
  historyOpen.value = false;
  historyLoading.value = false;
  historyId.value = "";
  historyPages.value = [];
  historyConversations.value = [];
  historyUnconfirmed.value = [];
  historyUnconfirmedDelivery.value = null;
  historyError.value = "";
}
async function loadHistory({ more = false } = {}) {
  if (historyLoading.value) return;
  const expectedActor = actorKey.value;
  const expectedHistory = ++historyRevision;
  historyOpen.value = true;
  historyId.value = "";
  historyPages.value = [];
  historyUnconfirmed.value = [];
  historyUnconfirmedDelivery.value = null;
  historyLoading.value = true;
  historyError.value = "";
  try {
    const offset = more ? historyNextOffset.value : 0;
    const result = await requestColleague(`/conversations/history?offset=${offset}&limit=20`, { method: "GET" });
    if (!mounted || expectedActor !== actorKey.value || expectedHistory !== historyRevision || !historyOpen.value) return;
    historyConversations.value = more ? [...historyConversations.value, ...result.conversations] : result.conversations;
    historyNextOffset.value = result.nextOffset;
    historyHasMore.value = result.hasMore;
  } catch (error) {
    if (mounted && expectedActor === actorKey.value && expectedHistory === historyRevision) historyError.value = error.message;
  } finally {
    if (expectedHistory === historyRevision) historyLoading.value = false;
  }
}
async function readHistoryPage(conversationId, { more = false, complete } = {}) {
  if (historyLoading.value) {
    complete?.({ changed: false });
    return;
  }
  let changed = false;
  const expectedActor = actorKey.value;
  const expectedHistory = ++historyRevision;
  const before = more ? historyPagination.value.nextBeforeTurnId : "";
  historyId.value = conversationId;
  if (!more) {
    historyPages.value = [];
    historyUnconfirmed.value = [];
    historyUnconfirmedDelivery.value = null;
  }
  historyLoading.value = true;
  historyError.value = "";
  try {
    const result = await requestColleague(`/conversations/history/page?conversationId=${encodeURIComponent(conversationId)}&limit=20${before ? `&beforeTurnId=${encodeURIComponent(before)}` : ""}`, { method: "GET" });
    if (!mounted || expectedActor !== actorKey.value || expectedHistory !== historyRevision || !historyOpen.value) return;
    if (result.id !== conversationId || result.readOnly !== true) throw new Error("The saved conversation response did not match this read-only history.");
    historyPages.value = [normalizeConversationLogPage(result), ...(more ? historyPages.value : [])];
    historyUnconfirmed.value = result.unconfirmedMessages || [];
    historyUnconfirmedDelivery.value = result.unconfirmedDelivery || null;
    changed = true;
  } catch (error) {
    if (mounted && expectedActor === actorKey.value && expectedHistory === historyRevision) historyError.value = error.message;
  } finally {
    if (expectedHistory === historyRevision) historyLoading.value = false;
    complete?.({ changed });
  }
}
realtimeSocket.on("connect", refresh);
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
  return target.send({ message, data: { clientId, focus: options.focus,
    ...(options.trainingQuestion ? { trainingQuestion: options.trainingQuestion } : {}) } }, { messageId: options.messageId });
}
async function submit() {
  if (freshOperation.value || freshBusy.value || voiceSession.value?.composerBlocked.value) return;
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
  if (freshOperation.value || freshBusy.value) return { ok: false };
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
  freshOperation.value = null;
  freshConfirm.value = false;
  freshBusy.value = false;
  freshError.value = "";
  closeHistory();
  watchDetails.value = false;
  product.value = { conversationId: "", error: "" };
  productError.value = "";
  pointerNotice.value = "";
  displayedPreview?.value?.presentation?.retireCue("The signed-in learner changed.");
  cueReported = "";
  cueReporting = null;
  audibleOutput = null;
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
  if (learnerGestures) learnerGestures.value = nativeGestureOwner;
  void refresh();
  window.addEventListener("focus", refresh);
  window.addEventListener("blur", cancelAvatarPress);
  window.addEventListener("pagehide", cancelAvatarPress);
});
onBeforeUnmount(() => {
  if (voice?.launcher.value === launcher.value?.$el) voice.launcher.value = null;
  realtimeSocket.off("connect", refresh);
  displayedPreview?.value?.presentation?.retireCue("Colleague left this browser view.");
  if (learnerGestures?.value === nativeGestureOwner) learnerGestures.value = null;
  nativeTickets.clear();
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
    <div ref="panelTarget" class="vibe64-colleague__panel" />
  </ConversationDialog>
  <Teleport :to="voicePanelTarget || conversationTarget || 'body'" :disabled="!voicePanelTarget && !conversationTarget">
    <aside v-show="bodyVisible" class="vibe64-colleague" :aria-label="name">
      <v-alert v-if="voiceSession && !voicePanelTarget && voice.controller.state.error" type="error" density="compact" role="alert">{{ voice.controller.state.error }}</v-alert>
      <v-alert v-if="pointerNotice" variant="tonal" type="info" role="status">
        <p>{{ pointerNotice }}</p>
        <v-btn :disabled="Boolean(voiceSession?.hasUnsentSpeech.value)" @click="refresh({ allowRetarget: true })">Refresh conversation</v-btn>
      </v-alert>
      <div class="vibe64-colleague__conversation">
        <AssistantConversationElement :adapter="adapter" :label="`${name} conversation`" v-model:avatar-size="avatarSize">
          <template v-if="$slots.avatar" #avatar="size">
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
                v-model="draft" class="vibe64-colleague__composer" :aria-label="composer.ariaLabel" :placeholder="composer.placeholder"
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
                      v-if="watches.length || assignments.length" ref="watchButton" size="small" min-height="48" variant="text"
                      :aria-label="`Watches and assignments (${watches.length + assignments.length})`" title="Watches and assignments"
                      aria-haspopup="dialog" :aria-expanded="watchDetails" @click="watchDetails = true"
                    >
                      <v-icon :icon="mdiEyeOutline" /><span class="ms-1">{{ watches.length + assignments.length }}</span>
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
  <v-dialog v-model="watchDetails" :activator="watchButton?.$el || modelButton?.$el" :open-on-click="false" :fullscreen="xs" max-width="620" scrollable aria-label="Watches and assignments">
    <v-card>
      <v-card-title class="d-flex align-center text-title-large">
        <span class="flex-grow-1">Watches and assignments</span>
        <v-btn :icon="mdiClose" variant="text" aria-label="Close watches and assignments" title="Close watches and assignments" @click="watchDetails = false" />
      </v-card-title>
      <v-card-text class="vibe64-colleague__watch-details">
        <section v-if="watches.length" aria-label="Conversation watches">
          <p class="text-title-medium">Conversation watches ({{ watches.length }})</p>
          <ul>
            <li v-for="item in watches" :key="item.watchId">
              <div>
                <strong>{{ item.projectSlug || 'Workspace' }}</strong> · {{ item.status }}
                <p>{{ item.question }}</p><p v-if="item.error" class="text-error">{{ item.error }}</p>
              </div>
              <div class="d-flex flex-wrap ga-1">
                <v-btn v-if="item.status === 'paused'" variant="text" min-height="48" :aria-label="`Resume watch: ${item.question}`" @click="changeWatch(item.watchId, 'resume')">Resume</v-btn>
                <v-btn variant="text" min-height="48" :aria-label="`Cancel watch: ${item.question}`" @click="changeWatch(item.watchId, 'cancel')">Cancel</v-btn>
              </div>
            </li>
          </ul>
        </section>
        <section v-if="assignments.length" aria-label="Ongoing assignments">
          <p class="text-title-medium">Ongoing assignments ({{ assignments.length }})</p>
          <ul>
            <li v-for="item in assignments" :key="item.assignmentId">
              <strong>{{ item.projectSlug }}</strong> · {{ item.status }} · {{ item.turnLimit - item.turnsUsed }} turns left
              <p>{{ item.summary }}</p><p>{{ item.criteria }}</p>
            </li>
          </ul>
        </section>
        <p v-if="!watches.length && !assignments.length" role="status">No ongoing watches or assignments.</p>
      </v-card-text>
    </v-card>
  </v-dialog>
  <v-dialog :model-value="freshConfirm" max-width="520" :persistent="freshBusy" @update:model-value="value => !value && closeFreshConfirmation()">
    <v-card title="Start a fresh conversation?">
      <v-card-text>
        <p>This ends the old voice conversation. Nothing will be resent. Its history and any unconfirmed words remain available in Previous conversations. Watches and assignments continue.</p>
        <p>Your typed draft and personal microphone, speaker, avatar and voice preferences stay. The new conversation does not automatically start voice.</p>
        <p v-if="freshBlocked" role="status">{{ freshBlocked }}</p>
        <p v-if="freshError" role="alert">{{ freshError }}</p>
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="freshBusy" @click="closeFreshConfirmation">{{ freshOperation ? 'Close' : 'Cancel' }}</v-btn>
        <v-btn :disabled="freshBusy || Boolean(freshBlocked)" color="primary" @click="startFresh">{{ freshBusy ? 'Checking fresh conversation…' : freshOperation ? 'Retry same fresh operation' : 'Start fresh' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
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
.vibe64-colleague__voice-tools { display: flex; min-width: 0; }
@media (pointer: coarse), (max-width: 600px) {
  .vibe64-colleague__composer-actions :deep(.v-btn) { min-width: 48px; min-height: 48px; }
}
.vibe64-colleague__watch-details { padding: 16px; min-height: 0; overflow: auto; overflow-wrap: anywhere; }
.vibe64-colleague__watch-details section + section { margin-top: 16px; }
.vibe64-colleague__watch-details ul { list-style: none; padding: 0; }
.vibe64-colleague__watch-details li { padding-block: 12px; }
.vibe64-colleague__watch-details li + li { border-top: 1px solid rgb(var(--v-theme-outline-variant)); }
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
</style>
