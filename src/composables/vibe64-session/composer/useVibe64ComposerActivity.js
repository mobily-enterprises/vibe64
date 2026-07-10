import { computed, onBeforeUnmount, ref } from "vue";
import {
  agentInteractionLocksControls
} from "@/lib/vibe64AgentInteractionState.js";
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

const AGENT_INTERRUPT_COOLDOWN_MS = 5000;

function useVibe64ComposerActivity({
  agentThinking = false,
  composerHandoff = null,
  interruptAgentTurn = async () => false,
  optimisticComposerTurn = null,
  remoteComposerSubmission = null,
  session = null
} = {}) {
  const interruptCooldownActive = ref(false);
  const interruptRequestPending = ref(false);
  let interruptCooldownTimer = null;

  const currentSession = computed(() => readRefOrGetterValue(session) || {});
  const activeAgentTurn = computed(() => {
    const turn = currentSession.value?.agentSession?.turn;
    return turn && typeof turn === "object" && !Array.isArray(turn) ? turn : {};
  });
  const agentInteractionLocked = computed(() => agentInteractionLocksControls({
    agentThinking: Boolean(readRefOrGetterValue(agentThinking))
  }));
  const agentSteeringAvailable = computed(() => agentInteractionLocked.value);
  const agentTerminalRunning = computed(() => (
    String(currentSession.value?.agentSession?.terminal?.status || "").trim() === "running"
  ));
  const localComposerSubmissionPending = computed(() => optimisticComposerTurnIsLocalPending(
    readRefOrGetterValue(optimisticComposerTurn)
  ));
  const remoteComposerSubmissionPending = computed(() => (
    readRefOrGetterValue(remoteComposerSubmission)?.status === "pending"
  ));
  const composerHandoffPresentation = useVibe64ComposerHandoffPresentation(composerHandoff);
  const agentInterruptVisible = computed(() => activeAgentTurn.value.active === true);
  const agentInterruptBlocked = computed(() => (
    interruptCooldownActive.value || interruptRequestPending.value
  ));
  const composerSubmissionStatus = computed(() => vibe64ComposerSubmissionStatusState({
    agentHandoffLabel: composerHandoffPresentation.value.label,
    agentHandoffPending: composerHandoffPresentation.value.pending,
    agentInterruptBlocked: agentInterruptBlocked.value,
    agentInterruptVisible: agentInterruptVisible.value,
    localComposerSubmissionPending: localComposerSubmissionPending.value,
    remoteComposerSubmissionPending: remoteComposerSubmissionPending.value
  }));
  const agentHandoffPending = computed(() => composerSubmissionStatus.value.handoffPending);
  const agentStopEnabled = computed(() => composerSubmissionStatus.value.agentStopEnabled);
  const agentStopVisible = computed(() => composerSubmissionStatus.value.agentStopVisible);

  async function requestAgentInterrupt(reason = "user_interrupt") {
    if (!agentStopEnabled.value) {
      return false;
    }
    interruptCooldownActive.value = true;
    interruptRequestPending.value = true;
    if (interruptCooldownTimer) {
      clearTimeout(interruptCooldownTimer);
    }
    interruptCooldownTimer = setTimeout(() => {
      interruptCooldownActive.value = false;
      interruptCooldownTimer = null;
    }, AGENT_INTERRUPT_COOLDOWN_MS);
    try {
      return await interruptAgentTurn(reason);
    } finally {
      interruptRequestPending.value = false;
    }
  }

  onBeforeUnmount(() => {
    if (interruptCooldownTimer) {
      clearTimeout(interruptCooldownTimer);
      interruptCooldownTimer = null;
    }
  });

  return {
    activeAgentTurn,
    agentHandoffPending,
    agentInterruptVisible,
    agentInteractionLocked,
    agentSteeringAvailable,
    agentStopEnabled,
    agentStopVisible,
    agentTerminalRunning,
    composerHandoffPresentation,
    composerSubmissionStatus,
    localComposerSubmissionPending,
    remoteComposerSubmissionPending,
    requestAgentInterrupt
  };
}

export {
  AGENT_INTERRUPT_COOLDOWN_MS,
  useVibe64ComposerActivity
};
