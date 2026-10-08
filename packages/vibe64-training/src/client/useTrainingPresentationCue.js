import { watch } from "vue";

// Original Colleague cue coordination. The Preview, speech session and receipt
// transport remain their existing owners; this owner creates no delivery facts.
export function useTrainingPresentationCue({ scope, presentation, voiceSession, acknowledge, error, holdMainReplies = false }) {
  let cueReporting = null;
  let cueReported = "";
  let audibleOutput = null;
  // Main native saved blocks arrive before their exact turn checkpoint. Keep
  // only retired originating identities; never copy reply text or audio.
  const retiredOrigins = holdMainReplies ? new Map() : null;

  function requireCueCapacity() {
    if (holdMainReplies && retiredOrigins.size >= 128) {
      throw new Error("This lesson browser has retained 128 interrupted explanations. End voice and reload this page before requesting another visual explanation.");
    }
  }

  function narration(value, targetConversationId) {
    if (!holdMainReplies) return value;
    const cue = presentation()?.state.cue;
    const current = scope();
    const origin = (value.turns || []).findLast(turn => turn.user);
    const ownCue = cue?.clientId === current.clientId && cue.conversationId === targetConversationId;
    const held = origin && (retiredOrigins.has(origin.turnId) || ownCue && origin.turnId === cue.turnId && !cue.canonicalFinal);
    // Original narration eligibility cancels optional queued speech and consumes
    // raw activity silently. Keep its cursor, raw turns and preferences intact.
    return held ? { ...value, eligible: false } : value;
  }

  function voiceState(state, targetConversationId, retainedTurns = []) {
    if (!holdMainReplies) {
      const cue = presentation()?.state.cue;
      // Provider streams are not classified as final until their completion.
      // Buffer this one armed explanation for speech; the transcript still streams.
      return cue?.clientId === scope().clientId && cue.conversationId === targetConversationId && cue.phase === "armed"
        ? { ...state, streamingReply: null } : state;
    }
    const current = scope();
    const cue = presentation()?.state.cue;
    const ownCue = cue?.clientId === current.clientId && cue.conversationId === targetConversationId;
    const blockedIds = new Set();
    for (const turn of retainedTurns) {
      const reply = turn.assistant;
      if (!reply || !retiredOrigins.has(turn.turnId) && !(ownCue && turn.turnId === cue.turnId &&
          (!cue.canonicalFinal || !cue.outputId || reply.outputId !== cue.outputId))) continue;
      blockedIds.add(reply.outputId || `${turn.turnId}:assistant`);
    }
    const reply = state.streamingReply;
    return { ...state,
      messages: (state.messages || []).filter(message => message.role !== "assistant" || !blockedIds.has(message.id)),
      streamingReply: reply && (blockedIds.has(reply.id) || ownCue && reply.turnId === cue.turnId &&
        (!cue.canonicalFinal || reply.outputId !== cue.outputId)) ? null : reply };
  }

  if (holdMainReplies) {
    watch(() => presentation()?.state.cue, value => {
      const current = scope();
      if (value?.clientId === current.clientId && value.conversationId === current.conversationId &&
          !value.canonicalFinal && ["interrupted", "failed"].includes(value.phase)) retiredOrigins.set(value.turnId, true);
    }, { flush: "sync" });
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
  function reset() { cueReported = ""; cueReporting = null; audibleOutput = null; retiredOrigins?.clear(); }
  return { voiceState, narration, observe, playback, retire, reset, requireCueCapacity };
}
