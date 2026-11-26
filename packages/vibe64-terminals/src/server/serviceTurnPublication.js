import { currentProjectScopeKey, runWithoutActionRequest } from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { AGENT_WRITE_WAIT_MS } from "./serviceSessionAccess.js";
import { recordSessionTurnChange } from "./sessionTurnTimeline.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").ProviderUsage} ProviderUsage */
/** @typedef {import("./types.js").ServiceGoals} ServiceGoals */
/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceWorkspacePreparation} ServiceWorkspacePreparation */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */
/** @typedef {import("./types.js").ConversationTurnPublishers} ConversationTurnPublishers */

// The engine whose Main turn each idle reason ends.
const MAIN_TURN_IDLE_ENGINES = new Map([
  ["claude-stream-turn-idle", "claude"],
  ["codex-app-server-turn-idle", "codex"],
  ["opencode-server-turn-idle", "opencode"]
]);

/**
 * An agent session's change publication and the work that follows a turn: the plan usage it reports, a temporary
 * chat's review, and after a Main turn the routing review, the goal's main AI check, the Resume the person asked for in
 * that turn or else its continuation once a usage limit resets, the workspace setup and the interrupted Closes its
 * engine can now finish.
 * @param {object} dependencies
 * @param {SessionConversations["afterTemporaryTurn"]} dependencies.afterTemporaryTurn
 * @param {SessionConversations["finishInterruptedCloses"]} dependencies.finishInterruptedCloses
 * @param {AssistantRouting["afterTurn"]} dependencies.afterRoutedTurn
 * @param {ServiceGoals["cancelGoalIfMainAiChanged"]} dependencies.cancelGoalIfMainAiChanged
 * @param {ServiceGoals["continueGoalWhenLimitResets"]} dependencies.continueGoalWhenLimitResets
 * @param {ServiceGoals["resumeGoalAfterTurn"]} dependencies.resumeGoalAfterTurn
 * @param {(sessionId: string) => Promise<unknown> | null} dependencies.restorePreviewAfterTurn restores the Preview a
 *   finished browser test left to the agent's turn end
 * @param {(sessionId: string) => Promise<unknown> | null} dependencies.summarizeTurnCommands shows the person the
 *   ended Main turn's repeated commands, when it crossed the line (agentCommandRepeats.js)
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProviderUsage} dependencies.providerUsage
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 * @param {ServiceState} dependencies.state
 * @param {ServiceWorkspacePreparation} dependencies.workspacePreparation
 * @param {ConversationTurnPublishers} dependencies.conversationTurns
 */
function createServiceTurnPublication({
  afterTemporaryTurn,
  finishInterruptedCloses,
  afterRoutedTurn,
  cancelGoalIfMainAiChanged,
  continueGoalWhenLimitResets,
  resumeGoalAfterTurn,
  restorePreviewAfterTurn,
  summarizeTurnCommands,
  logger,
  providerUsage,
  publishSessionChanged,
  state,
  workspacePreparation,
  conversationTurns
}) {
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
      // A goal's automatic continuation follows each of its turns: the person asked in that turn to resume it, or it
      // ended at its AI account's usage limit and continues once the limit resets.
      cancelGoalIfMainAiChanged(sessionId, null, { activeOnly: true }).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.agent_goal",
          event: "vibe64.agent_goal.main_ai_cancel_failed",
          sessionId,
          code: error.code
        }, "A goal on the previous main AI could not be cancelled.");
      }).then(async cancelled => {
        if (cancelled === true || await resumeGoalAfterTurn(sessionId)) return;
        await continueGoalWhenLimitResets(sessionId);
      }),
      // A prepared session, or one whose preparation runs, needs nothing from the turn's end.
      workspacePreparation.ensureWorkspacePrepared(sessionId, {}, { waitMs: AGENT_WRITE_WAIT_MS }).catch((error) => {
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
    recordSessionTurnChange(sessionId, payload);
    await publishSessionChanged.agentTerminal(sessionId, payload);
    if (state.lifecycle.closing) return;
    // What follows a turn is Vibe64's own work: it runs without the request the engine's events last ran in, which
    // for a running engine is whichever request last read or used the session (a page's poll, say), never one that
    // asked for it.
    const reason = String(payload.reason || "").trim();
    if (reason === "temporary-agent-turn-idle" || MAIN_TURN_IDLE_ENGINES.has(reason)) {
      // A restore that cannot start the app shows on the Preview as one that needs recovery.
      state.trackShutdownWork(runWithoutActionRequest(async () => restorePreviewAfterTurn(sessionId)).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.preview_tests",
          event: "vibe64.preview_tests.restore_after_turn_failed",
          sessionId,
          code: error.code
        }, "The Preview a browser test left could not be restored after the turn.");
      }));
    }
    if (reason === "temporary-agent-turn-idle") {
      state.trackShutdownWork(runWithoutActionRequest(() => afterTemporaryTurn(sessionId, payload.payload)).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.assistant_routing",
          event: "vibe64.assistant_routing.temporary_review_deferred",
          sessionId,
          code: error.code
        }, "Temporary chat review needs attention.");
      }));
      return;
    }
    const engineId = MAIN_TURN_IDLE_ENGINES.get(reason);
    if (!engineId) {
      return;
    }
    // The ended turn's repeated commands: their summary, when the turn crossed the line, and the count's end.
    state.trackShutdownWork(runWithoutActionRequest(async () => summarizeTurnCommands(sessionId)).catch((error) => {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.agent_session_command",
        event: "vibe64.agent_session_command.repeats_summary_failed",
        sessionId,
        code: error.code
      }, "The ended turn's repeated commands could not be summarized.");
    }));
    state.trackShutdownWork(runWithoutActionRequest(() => followMainTurn(sessionId, payload).then(() => conversationTurns.settled(sessionId, "")).catch((error) => {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.conversation",
        event: "vibe64.conversation.turn_settled_failed",
        sessionId,
        code: error.code
      }, "A finished Main turn could not be announced.");
    }).then(() => state.lifecycle.closing ? null : finishInterruptedCloses(sessionId, engineId))));
  }

  return Object.freeze({
    publishAgentSessionChanged
  });
}

export {
  createServiceTurnPublication
};
