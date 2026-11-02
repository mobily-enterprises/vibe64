import { computed, unref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * The selected session's native assistant turn as the server reports it, and
 * the assistant connection the composer can use: whether the assistant is
 * working, ready to steer, reasoning, or unavailable.
 */
function useVibe64AgentTurnState(props, { assistantCanRouteChat, projectSlug, reportActivity, sessionId }) {
  const activeAgentTurn = computed(() => {
    const turn = props.session?.agentSession?.turn;
    return turn && typeof turn === "object" && !Array.isArray(turn) ? turn : {};
  });
  const agentActive = computed(() => activeAgentTurn.value.active === true);
  watch(agentActive, (active, was) => {
    if (was && !active) reportActivity("agent-finished", { projectSlug: projectSlug.value, sessionId: sessionId.value });
  });
  const agentObservationLost = computed(() => activeAgentTurn.value.status === "observation_lost");
  // The only source of the chat's working indicator: the server's live native
  // turn. Routing, sending, uncertain delivery and connection states have their
  // own labels and controls but can never show the assistant as working.
  const agentWorking = computed(() => agentActive.value && !agentObservationLost.value);
  const composerConnectionStatus = computed(() => !agentActive.value && unref(assistantCanRouteChat) === true &&
    ["restricted", "unavailable", "failed"].includes(props.agentConnectionStatus)
    ? "connected" : props.agentConnectionStatus);
  const agentNativeTurnReady = computed(() => Boolean(
    agentActive.value && !agentObservationLost.value &&
    normalizeText(activeAgentTurn.value.id) &&
    normalizeText(activeAgentTurn.value.state) === "active" &&
    props.agentConnectionStatus === "connected"
  ));
  const agentSteerable = computed(() => agentNativeTurnReady.value &&
    props.conversationRuntime?.steerable.value === true);
  const assistantConnectionReady = computed(() => composerConnectionStatus.value === "connected");
  const reasoningActive = computed(() => assistantConnectionReady.value && agentActive.value &&
    !agentObservationLost.value && activeAgentTurn.value.phase === "reasoning");
  const assistantAccountUnavailable = computed(() => composerConnectionStatus.value === "unavailable");
  // The server's access check names the account the selection needs, as AI
  // Accounts names it; the generic text covers a refusal that carried no message.
  const assistantAccountMessage = computed(() => props.agentConnectionError ||
    "The selected AI account or model is unavailable. Check AI Accounts or choose another model.");

  return {
    activeAgentTurn,
    agentActive,
    agentNativeTurnReady,
    agentObservationLost,
    agentSteerable,
    agentWorking,
    assistantAccountMessage,
    assistantAccountUnavailable,
    assistantConnectionReady,
    composerConnectionStatus,
    reasoningActive
  };
}

export { useVibe64AgentTurnState };
