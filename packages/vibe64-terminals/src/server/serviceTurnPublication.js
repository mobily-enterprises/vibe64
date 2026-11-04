import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { AGENT_WRITE_WAIT_MS } from "./serviceSessionAccess.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").ProviderUsage} ProviderUsage */
/** @typedef {import("./types.js").ServiceGoals} ServiceGoals */
/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceWorkspacePreparation} ServiceWorkspacePreparation */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */
/** @typedef {import("./types.js").ConversationTurnPublishers} ConversationTurnPublishers */

const MAIN_TURN_IDLE_REASONS = Object.freeze([
  "claude-stream-turn-idle",
  "codex-app-server-turn-idle",
  "opencode-server-turn-idle"
]);

/**
 * An agent session's change publication and the work that follows a turn: the plan usage it reports, a temporary
 * chat's review, and after a Main turn the routing review, the goal's main AI check and the workspace setup.
 * @param {object} dependencies
 * @param {SessionConversations["afterTemporaryTurn"]} dependencies.afterTemporaryTurn
 * @param {AssistantRouting["afterTurn"]} dependencies.afterRoutedTurn
 * @param {ServiceGoals["cancelGoalIfMainAiChanged"]} dependencies.cancelGoalIfMainAiChanged
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProviderUsage} dependencies.providerUsage
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 * @param {ServiceState} dependencies.state
 * @param {ServiceWorkspacePreparation} dependencies.workspacePreparation
 * @param {ConversationTurnPublishers} dependencies.conversationTurns
 */
function createServiceTurnPublication({
  afterTemporaryTurn,
  afterRoutedTurn,
  cancelGoalIfMainAiChanged,
  logger,
  providerUsage,
  publishSessionChanged,
  state,
  workspacePreparation,
  conversationTurns
}) {
  /**
   * Keeps a turn's follow-up work in flight until it settles, so shutdown can wait for it.
   * @param {Promise<unknown>} completion
   */
  function trackCompletion(completion) {
    state.turnCompletions.add(completion);
    void completion.finally(() => state.turnCompletions.delete(completion));
  }

  /**
   * The follow-up work after a Main turn; each part logs its own failure.
   * @param {string} sessionId
   * @param {object} payload
   */
  function followMainTurn(sessionId, payload) {
    return Promise.all([
      afterRoutedTurn(sessionId, payload, {}).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.assistant_routing",
          event: "vibe64.assistant_routing.review_deferred",
          sessionId,
          code: error.code
        }, "Automatic review needs attention.");
      }),
      // A goal's automatic continuation follows each of its turns.
      cancelGoalIfMainAiChanged(sessionId, null, { activeOnly: true }).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.agent_goal",
          event: "vibe64.agent_goal.main_ai_cancel_failed",
          sessionId,
          code: error.code
        }, "A goal on the previous main AI could not be cancelled.");
      }),
      workspacePreparation.prepareWorkspaceSetup(sessionId, {
        publish: true,
        waitMs: AGENT_WRITE_WAIT_MS
      }).catch((error) => {
        vibe64SessionDebugLog("server.terminals.workspaceSetup.afterTurn.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      })
    ]);
  }

  /**
   * Publishes an agent session change, then starts what follows a finished turn.
   * @param {string} sessionId
   * @param {object} [payload]
   */
  async function publishAgentSessionChanged(sessionId, payload = {}) {
    if (!state.lifecycle.closing) {
      providerUsage.observe(currentProjectScopeKey(), sessionId, payload, () => {
        if (!state.lifecycle.closing) return publishSessionChanged.agentTerminal(sessionId, { reason: "agent-plan-usage" });
      });
    }
    await publishSessionChanged.agentTerminal(sessionId, payload);
    if (state.lifecycle.closing) return;
    if (payload.reason === "temporary-agent-turn-idle") {
      trackCompletion(afterTemporaryTurn(sessionId, payload.payload).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.assistant_routing",
          event: "vibe64.assistant_routing.temporary_review_deferred",
          sessionId,
          code: error.code
        }, "AI task chat review needs attention.");
      }));
      return;
    }
    if (!MAIN_TURN_IDLE_REASONS.includes(String(payload.reason || "").trim())) {
      return;
    }
    trackCompletion(followMainTurn(sessionId, payload).then(() => conversationTurns.settled(sessionId, "")).catch((error) => {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.conversation",
        event: "vibe64.conversation.turn_settled_failed",
        sessionId,
        code: error.code
      }, "A finished Main turn could not be announced.");
    }));
  }

  return Object.freeze({
    publishAgentSessionChanged
  });
}

export {
  createServiceTurnPublication
};
