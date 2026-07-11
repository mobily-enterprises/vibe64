import { computed, ref } from "vue";
import {
  optimisticComposerTurnIsLocalPending,
  vibe64ComposerSubmissionStatusState
} from "@/lib/vibe64ComposerSubmissionState.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  useVibe64ComposerHandoffPresentation
} from "@/composables/vibe64-session/composer/useVibe64ComposerHandoffPresentation.js";

function useVibe64ComposerActivity({
  composerHandoff = null,
  interruptAgentTurn = async () => false,
  optimisticComposerMessages = null,
  optimisticComposerTurn = null,
  remoteComposerSubmission = null,
  session = null
} = {}) {
  const interruptRequestPending = ref(false);

  const currentSession = computed(() => readRefOrGetterValue(session) || {});
  const activeAgentTurn = computed(() => {
    const turn = currentSession.value?.agentSession?.turn;
    return turn && typeof turn === "object" && !Array.isArray(turn) ? turn : {};
  });
  const agentTerminalRunning = computed(() => (
    String(currentSession.value?.agentSession?.terminal?.status || "").trim() === "running"
  ));
  const localComposerSubmissionPending = computed(() => optimisticComposerTurnIsLocalPending(
    readRefOrGetterValue(optimisticComposerTurn)
  ));
  const composerMessagePending = computed(() => Boolean(
    (Array.isArray(readRefOrGetterValue(optimisticComposerMessages))
      ? readRefOrGetterValue(optimisticComposerMessages)
      : []
    ).some((message) => String(message?.status || "").trim() === "pending") ||
    (Array.isArray(currentSession.value?.composerMessages)
      ? currentSession.value.composerMessages
      : []
    ).some((message) => String(message?.state || "").trim() === "accepted")
  ));
  const remoteComposerSubmissionPending = computed(() => (
    readRefOrGetterValue(remoteComposerSubmission)?.status === "pending"
  ));
  const composerHandoffPresentation = useVibe64ComposerHandoffPresentation(composerHandoff);
  const agentInteractionLocked = computed(() => Boolean(
    activeAgentTurn.value.active === true ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    composerHandoffPresentation.value.pending
  ));
  const agentConversationActive = computed(() => Boolean(
    activeAgentTurn.value.active === true ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    composerHandoffPresentation.value.pending ||
    composerMessagePending.value
  ));
  const agentSteeringAvailable = computed(() => activeAgentTurn.value.active === true);
  const agentInterruptVisible = computed(() => Boolean(
    activeAgentTurn.value.active === true ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    composerHandoffPresentation.value.pending ||
    composerMessagePending.value
  ));
  const agentInterruptBlocked = computed(() => interruptRequestPending.value);
  const composerSubmissionStatus = computed(() => vibe64ComposerSubmissionStatusState({
    agentHandoffLabel: composerHandoffPresentation.value.label,
    agentHandoffPending: composerHandoffPresentation.value.pending,
    agentInterruptBlocked: agentInterruptBlocked.value,
    agentInterruptVisible: agentInterruptVisible.value,
    agentTurnActive: activeAgentTurn.value.active === true,
    localComposerSubmissionPending: localComposerSubmissionPending.value || composerMessagePending.value,
    remoteComposerSubmissionPending: remoteComposerSubmissionPending.value
  }));
  const agentHandoffPending = computed(() => composerSubmissionStatus.value.handoffPending);
  const agentStopEnabled = computed(() => composerSubmissionStatus.value.agentStopEnabled);
  const agentStopVisible = computed(() => composerSubmissionStatus.value.agentStopVisible);

  async function requestAgentInterrupt(reason = "user_interrupt") {
    if (!agentStopEnabled.value) {
      return false;
    }
    interruptRequestPending.value = true;
    try {
      return await interruptAgentTurn(reason);
    } finally {
      interruptRequestPending.value = false;
    }
  }

  return {
    activeAgentTurn,
    agentConversationActive,
    agentHandoffPending,
    agentInterruptVisible,
    agentInteractionLocked,
    agentSteeringAvailable,
    agentStopEnabled,
    agentStopVisible,
    agentTerminalRunning,
    composerHandoffPresentation,
    composerMessagePending,
    composerSubmissionStatus,
    localComposerSubmissionPending,
    remoteComposerSubmissionPending,
    requestAgentInterrupt
  };
}

export {
  useVibe64ComposerActivity
};
