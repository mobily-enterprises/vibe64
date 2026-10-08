import { watch } from "vue";

// Original Colleague cue coordination. The Preview, speech session and receipt
// transport remain their existing owners; this owner creates no delivery facts.
export function useTrainingPresentationCue({ scope, presentation, voiceSession, acknowledge, error }) {
  let cueReporting = null;
  let cueReported = "";
  let audibleOutput = null;

  function voiceState(state, targetConversationId) {
    const cue = presentation()?.state.cue;
    // Provider streams are not classified as final until their completion.
    // Buffer this one armed explanation for speech; the transcript still streams.
    return cue?.clientId === scope().clientId && cue.conversationId === targetConversationId && cue.phase === "armed"
      ? { ...state, streamingReply: null } : state;
  }

  function observe(value) {
    const current = scope();
    if (!current.mounted || !value || value.clientId !== current.clientId || value.conversationId !== current.conversationId) return false;
    return presentation()?.observeCue(value, { readAloud: voiceSession.value?.readAloud?.value === true }) || false;
  }

  function playback(event, targetConversationId) {
    if (voiceSession.value && event.conversationId === targetConversationId) {
      if (event.phase === "started") audibleOutput = { conversationId: event.conversationId, outputId: event.outputId };
      else if (audibleOutput?.conversationId === event.conversationId && audibleOutput.outputId === event.outputId) audibleOutput = null;
    }
    presentation()?.playback(event);
  }

  watch(() => presentation()?.state.cue, value => {
    const current = scope();
    const session = voiceSession.value;
    if (value?.phase !== "interrupted" || value.clientId !== current.clientId || value.audioPhase !== "started" || !session ||
        audibleOutput?.conversationId !== value.conversationId || audibleOutput.outputId !== value.outputId ||
        current.runtimeConversationId !== value.conversationId) return;
    audibleOutput = null;
    // Deliberate diagram retirement uses the existing whole-binding audio stop.
    // A later output or mere drawer minimise never enters this identity fence.
    session.stopSpeech();
  }, { flush: "sync" });

  watch(() => presentation()?.state.cue, async value => {
    const current = scope();
    if (!current.mounted || !value || value.clientId !== current.clientId || value.conversationId !== current.conversationId ||
        !["completed", "interrupted", "failed"].includes(value.phase)) return;
    const receipt = JSON.stringify(value);
    if (cueReported === receipt || cueReporting === receipt) return;
    cueReporting = receipt;
    const expectedActor = current.actorKey;
    try {
      await acknowledge({ clientId: current.clientId, commandId: value.navigationId, ok: true, cue: value });
      if (scope().mounted && expectedActor === scope().actorKey) cueReported = receipt;
    } catch {
      if (scope().mounted && expectedActor === scope().actorKey) error.value = "The lesson cue receipt was not confirmed. Read its current status before continuing.";
    } finally {
      if (cueReporting === receipt) cueReporting = null;
    }
  });

  function retire(reason) { presentation()?.retireCue(reason); }
  function reset() { cueReported = ""; cueReporting = null; audibleOutput = null; }
  return { voiceState, observe, playback, retire, reset };
}
