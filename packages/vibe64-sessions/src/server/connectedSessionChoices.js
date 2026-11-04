import crypto from "node:crypto";
import {
  serializeSessionConnectedSources,
  sessionConnectedContribution,
  sessionConnectedSources
} from "@local/vibe64-core/server/projectRepository";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { assertProjectEffectAdmission } from "@local/vibe64-core/server/projectRequestContext";
import { ACTION_BIND_CONNECTED_SESSION, ACTION_INSPECT_CONNECTED_SESSIONS } from "./connectedContributionActions.js";
import { sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * A person's choice of connected sessions: which connected projects of a
 * session need one, and saving what they chose. Each receiving project answers
 * which of its sessions are free (receivingContributions.js).
 * @param {object} dependencies
 * @param {(projectSlug: string, actionId: string, input: object, requestContext?: object) => Promise<object>} dependencies.executeConnectedAction
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 */
function createConnectedSessionChoices({ executeConnectedAction, project, terminals }) {
  /**
   * The receiving project's answer about one connected project of this
   * session: its saved link, and the free sessions when that link does not hold.
   * @param {object} session
   * @param {{ fullName: string, projectSlug: string }} target
   * @param {object} requestContext
   */
  async function connectedSessionChoice(session, target, requestContext) {
    const binding = sessionConnectedSources(session).find(item => item.contribution.repository === target.fullName);
    const originIsContribution = Boolean(sessionConnectedContribution(session));
    const choice = await executeConnectedAction(target.projectSlug, ACTION_INSPECT_CONNECTED_SESSIONS, {
      ...(binding ? { contribution: binding.contribution } : {}),
      originIsContribution
    }, requestContext);
    return { binding, choice, originIsContribution };
  }

  /**
   * The connected projects that need a person to choose a session, with the
   * sessions free for each. An unfinished replacement also offers its review,
   * so the person can finish what they confirmed.
   * @param {string} sessionId
   * @param {object} input
   * @param {object} requestContext
   */
  async function inspectConnectedChoices(sessionId, input, requestContext) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
      const choices = [];
      for (const target of targets) {
        const { binding, choice } = await connectedSessionChoice(session, target, requestContext);
        if (choice?.ok !== true) return choice;
        if (choice.linked) continue;
        choices.push({
          name: target.repository.split("/").pop(),
          projectSlug: target.projectSlug,
          reason: choice.reason,
          repository: target.fullName,
          sessions: choice.sessions.map(({ sessionId: id, sessionName }) => ({ sessionId: id, sessionName })),
          ...(choice.unfinishedReplacement ? {
            replacementReview: {
              repository: binding.contribution.repository,
              targetBranch: binding.contribution.integrationBranch,
              targetHead: choice.source.baseCommit,
              id: binding.contribution.replaces,
              activeHead: "",
              discardedHead: binding.contribution.baseCommit
            }
          } : {})
        });
      }
      return { ok: true, choices };
    });
  }

  /**
   * Links a person's chosen session to this one. The server decides again
   * here: the project must still need a choice and the session must still be
   * free. The binding is reserved before the session takes it, as a lost
   * response or crash then leaves a link Prepare asks about, never a session
   * bound to a contribution nothing uses.
   * @param {string} sessionId
   * @param {{ repository: string, connectedSessionId: string }} input
   * @param {object} requestContext
   */
  async function linkConnectedSession(sessionId, input, requestContext) {
    return sessionResult(() => terminals.runConnectedSourcePreparation(sessionId, input, async ({ runtime, session }) => {
      assertProjectEffectAdmission();
      const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
      const target = targets.find(item => item.fullName === input.repository);
      if (!target) {
        throw vibe64Error("This session no longer connects to that project. Refresh and try again.", "vibe64_connected_session_not_free");
      }
      const { choice, originIsContribution } = await connectedSessionChoice(session, target, requestContext);
      if (choice?.ok !== true) return choice;
      if (choice.linked) {
        throw vibe64Error(`${target.fullName} is already linked. Keep working with its session.`, "vibe64_connected_already_linked");
      }
      const chosen = choice.sessions.find(item => item.sessionId === input.connectedSessionId);
      if (!chosen) throw vibe64Error("That session is no longer free. Choose again.", "vibe64_connected_session_not_free");
      const binding = {
        projectSlug: target.projectSlug,
        contribution: {
          schemaVersion: 1,
          id: crypto.randomUUID(),
          sessionId: chosen.sessionId,
          repository: choice.source.repository,
          integrationBranch: choice.source.integrationBranch,
          baseCommit: chosen.baseCommit
        }
      };
      const sources = sessionConnectedSources(session);
      const writeSources = value =>
        runtime.store.writeMetadataValue(sessionId, "connected_sources", serializeSessionConnectedSources(value));
      await writeSources([...sources.filter(item => item.contribution.repository !== input.repository), binding]);
      let bound;
      try {
        bound = await executeConnectedAction(target.projectSlug, ACTION_BIND_CONNECTED_SESSION, {
          contribution: binding.contribution,
          originIsContribution
        }, requestContext);
      } finally {
        if (bound?.ok !== true) await writeSources(sources);
      }
      if (bound.ok !== true) return bound;
      return { ok: true, repository: target.fullName, sessionId: chosen.sessionId };
    }));
  }

  return Object.freeze({
    inspectConnectedChoices,
    linkConnectedSession
  });
}

export { createConnectedSessionChoices };
