import { computed, onBeforeUnmount, ref } from "vue";
import { useVoiceLauncher } from "@jskit-ai/assistant-voice/client";
import { createProjectVoiceBinding } from "@local/vibe64-voice/client";

/**
 * Main's voice in the conversation: its binding to the voice host while the
 * conversation is shown, the spoken message awaiting review, read-aloud, the
 * avatar's size and the talk button's tap-or-hold launcher.
 * @param {{ visible: boolean, voiceRuntime: any, working: boolean | undefined }} props The conversation's props.
 * @param {object} options
 * @param {() => object} options.readAdapter The conversation's adapter, which an inline voice conversation drives.
 * @param {ReturnType<typeof import("@local/vibe64-voice/client").useVibe64Voice>} options.voice The voice host.
 */
function useVibe64ConversationVoice(props, { readAdapter, voice }) {
  const mounted = ref(true);
  const voiceError = ref("");
  const voiceTranscript = ref(null);
  const pageVisible = ref(globalThis.document?.visibilityState !== "hidden");
  function updatePageVisibility() { pageVisible.value = globalThis.document?.visibilityState !== "hidden"; }
  globalThis.document?.addEventListener("visibilitychange", updatePageVisibility);
  const voiceBinding = computed(() => {
    const runtime = props.voiceRuntime;
    if (!runtime) return null;
    return createProjectVoiceBinding(runtime, {
      get eligible() { return mounted.value && props.visible && props.voiceRuntime === runtime && pageVisible.value; },
      onTranscript(transcript, { canTake = false } = {}) {
        if (mounted.value && props.voiceRuntime === runtime) voiceTranscript.value = transcript ? { ...transcript, canTake } : null;
      },
      get adapter() { return mounted.value && props.visible && props.voiceRuntime === runtime ? readAdapter() : null; },
      get presentation() { return mounted.value && props.visible && props.voiceRuntime === runtime ? "inline" : "dialog"; }
    });
  });
  const voiceSession = computed(() => {
    const binding = voiceBinding.value;
    const state = voice.controller.state;
    return binding && state.binding?.id === binding.id && state.binding.conversationId === binding.conversationId
      ? state.session : null;
  });
  function voicePreviewActionsAllowed(messageId) {
    const transcript = voiceTranscript.value;
    const session = voiceSession.value;
    const runtime = props.voiceRuntime;
    const pending = session?.pendingTranscript.value;
    const selected = pending?.messageId === messageId || transcript?.id === messageId && transcript.canTake;
    const receipt = runtime?.delivery.find(messageId);
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
    // A definitely unsent message leaves the chat through JSKIT's Edit; the
    // speech bubble, not the typed draft, now holds its words.
    if (runtime.delivery.find(messageId)?.status === "failed") runtime.delivery.edit(messageId);
    return true;
  }
  async function editVoiceTranscript(messageId) {
    const session = selectedVoiceTranscriptSession(messageId);
    if (!session) return false;
    const runtime = props.voiceRuntime;
    if (!await session.beginTranscriptEdit(messageId)) return false;
    // Explicit Edit retires only a definite local rejection, through JSKIT's
    // Edit. Plain Retry keeps the original authored text and steering intent
    // on the delivery owner.
    if (runtime.delivery.find(messageId)?.status === "failed") return runtime.delivery.edit(messageId) !== null;
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
  // The face starts as the person last left it; only Minimise and Show change it.
  const avatarVisible = computed(() => voiceBinding.value ? voice.avatarVisibleFor(voiceBinding.value.preferenceTarget) : null);
  const avatarSize = computed({
    get: () => avatarVisible.value === false ? "hidden" : "compact",
    set: size => { if (voiceBinding.value) voice.setAvatarVisible(voiceBinding.value.preferenceTarget, size !== "hidden"); }
  });
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
  onBeforeUnmount(() => {
    mounted.value = false;
    globalThis.document?.removeEventListener("visibilitychange", updatePageVisibility);
  });

  return {
    avatarSize,
    avatarVisible,
    avatarVisual,
    composerBlocked,
    holdingVoice,
    openVoice,
    pageVisible,
    readAloud,
    readAloudChangePending,
    toggleReadAloud,
    voiceBinding,
    voiceError,
    voiceGesture,
    voicePreview,
    voicePreviews,
    voiceSession,
    voiceTranscript
  };
}

export {
  useVibe64ConversationVoice
};
