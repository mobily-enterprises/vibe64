import { computed } from "vue";

/**
 * The speech previews Colleague's transcript shows: the pending reviewed speech
 * and the words being captured, each with the Discard, Edit and Send actions
 * that Colleague's voice session allows for it. Snapshots only the existing
 * pending and current capture owners; never queues.
 * @param {object} options
 * @param {import("vue").Ref<object | null>} options.voiceTranscript
 * @param {import("vue").ComputedRef<object | null>} options.voiceSession
 * @param {{ runtime: import("vue").Ref<object | null> }} options.conversation
 * @param {() => boolean} options.isMounted
 */
function useColleagueVoicePreviews({ voiceTranscript, voiceSession, conversation, isMounted }) {
  function voicePreviewActionsAllowed(messageId) {
    const transcript = voiceTranscript.value;
    const session = voiceSession.value;
    const runtime = conversation.runtime.value;
    const pending = session?.pendingTranscript.value;
    const selected = pending?.messageId === messageId || transcript?.id === messageId && transcript.canTake;
    const receipt = runtime?.delivery.find(messageId);
    return Boolean(selected && session && session.canTakeTranscript(messageId) && !session.sending.value &&
      (!receipt || receipt.status === "failed") &&
      (!receipt || !runtime?.delivery.state.messages.some(message => message.status === "uncertain")));
  }
  function selectedVoiceTranscriptSession(messageId) {
    const runtime = conversation.runtime.value;
    if (!isMounted() || !runtime?.current.value || !voicePreviewActionsAllowed(messageId)) return null;
    return voiceSession.value;
  }
  async function takeVoiceTranscript(messageId) {
    const session = selectedVoiceTranscriptSession(messageId);
    if (!session) return false;
    const runtime = conversation.runtime.value;
    if (!await session.takeTranscript(messageId)) return false;
    // A definitely unsent message leaves the chat through JSKIT's Edit; the
    // speech bubble, not the typed draft, now holds its words.
    if (runtime.delivery.find(messageId)?.status === "failed") runtime.delivery.edit(messageId);
    return true;
  }
  async function editVoiceTranscript(messageId) {
    const session = selectedVoiceTranscriptSession(messageId);
    if (!session) return false;
    const runtime = conversation.runtime.value;
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
    if (pending?.messageId !== messageId || !pending.text.trim() ||
      conversation.runtime.value?.delivery.state.messages.some(message => message.status === "uncertain")) return false;
    await session.deliverTranscript();
    return true;
  }
  const voicePreviews = computed(() => {
    const transcript = voiceTranscript.value;
    const session = voiceSession.value;
    const pending = session?.pendingTranscript.value;
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
  return { voicePreviews, voicePreview };
}

export { useColleagueVoicePreviews };
