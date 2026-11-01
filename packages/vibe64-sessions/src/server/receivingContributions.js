import { isDeepStrictEqual } from "node:util";
import {
  parseSessionConnectedContribution,
  sessionConnectedContribution
} from "@local/vibe64-core/server/projectRepository";
import { assertProjectEffectAdmission, currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { vibe64SessionStatusIsOpen } from "@local/vibe64-runtime/server/sessionStore";
import { readSessionRenewalState, SESSION_RENEWAL_STATUS } from "./sessionRenewalState.js";
import { publicSession, sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").SessionCreation} SessionCreation */
/** @typedef {import("./types.js").SessionRepositoryReads} SessionRepositoryReads */
/** @typedef {import("./types.js").SessionUpdateChecks} SessionUpdateChecks */
/** @typedef {import("./types.js").SessionWork} SessionWork */
/** @typedef {import("./types.js").SessionWorkOperations} SessionWorkOperations */

const CONNECTED_SESSION_NAME_METADATA = "connected_session_name";

/**
 * The receiving side of connected contributions: the session that holds an
 * originating project's contribution in this project, allocated, inspected,
 * saved, checked and updated for that project through this project's own
 * internal actions.
 * @param {object} dependencies
 * @param {SessionCreation} dependencies.creation
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {SessionRepositoryReads} dependencies.repositoryReads
 * @param {SessionUpdateChecks} dependencies.repositoryUpdates
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWork} dependencies.work
 * @param {SessionWorkOperations} dependencies.workOperations
 */
function createReceivingContributions({
  creation,
  project,
  publishSessionChanged,
  repositoryReads,
  repositoryUpdates,
  terminals,
  work,
  workOperations
}) {
  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} contribution
   * @param {object} session
   */
  async function resolveConnectedSession(runtime, contribution, session) {
    const visited = new Set();
    while (session) {
      if (visited.has(session.sessionId)) break;
      visited.add(session.sessionId);
      if (!isDeepStrictEqual(sessionConnectedContribution(session), contribution)) {
        throw Object.assign(new Error("The receiving source binding changed. Preserve its checkout and review the connection."), {
          code: "vibe64_contribution_authority_changed",
          details: { sessionId: session.sessionId }
        });
      }
      const successorId = normalizeText(session.metadata?.renewed_to);
      if (vibe64SessionStatusIsOpen(session.status) && !successorId) return session;
      if (session.status !== "archived" || !successorId) break;
      const state = await readSessionRenewalState(runtime, session.sessionId);
      if (state?.status !== SESSION_RENEWAL_STATUS.COMPLETED || !state.predecessorArchivedAt ||
          !state.successor?.availableAt || state.successor.sessionId !== successorId ||
          state.commit?.successorSessionId !== successorId ||
          state.renewalId !== session.metadata.renewal_id) break;
      const successor = await runtime.getSession(successorId, { inspectSource: false });
      if (successor?.metadata?.renewed_from !== session.sessionId) break;
      session = successor;
    }
    throw Object.assign(new Error(
      "This contribution's current session is unavailable. Complete its renewal or recover its source in the receiving project."
    ), {
      code: "vibe64_connected_source_unavailable",
      details: { sessionId: session?.sessionId || contribution.id }
    });
  }

  /**
   * The receiving session a contribution's exact saved binding names, once
   * this project's repository and integration target still match it.
   * @param {{ contribution: object }} input
   */
  async function contributionSession(input) {
    const contribution = parseSessionConnectedContribution(input.contribution);
    if (!contribution) throw new TypeError("Connected work requires its exact saved contribution binding.");
    const source = await project.connectedContributionSource(input);
    const runtime = await project.createRuntime({ inspectSource: false });
    if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch) {
      throw Object.assign(new Error("The receiving source binding changed. Preserve its checkout and review the connection."), {
        code: "vibe64_contribution_authority_changed"
      });
    }
    const session = await resolveConnectedSession(runtime, contribution,
      await runtime.getSession(contribution.id, { inspectSource: false }));
    return { contribution, runtime, session };
  }

  /**
   * A receiving session's work as the originating session reads it. A Save
   * whose push is still unknown is refused until its work is inspected again.
   * @param {object} result
   * @param {{ sessionId: string }} session
   */
  function contributionWorkResult(result, session) {
    if (result.ok === false) return { ...result, details: { ...result.details, sessionId: session.sessionId } };
    if (result.operation?.status === "failed" && result.operation.code === "vibe64_session_save_publication_unknown") {
      throw Object.assign(new Error(
        result.operation.error || "Whether the connected Save was pushed is still unknown. Inspect work before retrying."
      ), {
        code: result.operation.code,
        details: { sessionId: session.sessionId }
      });
    }
    return { ...result, sessionId: session.sessionId };
  }

  /**
   * Brings a receiving checkout up to its integration branch through the normal
   * Update, carrying its edits onto the new commit. It leaves the checkout as it
   * is while its agent or a Save/Update is working, while a published
   * contribution awaits acceptance, and when the Update would conflict.
   */
  async function refreshConnectedContribution(runtime, session, branch) {
    const sessionId = session.sessionId;
    const skipped = reason => ({ ok: true, sessionId, status: "skipped", reason });
    if (workOperations.isRunning(sessionId)) {
      return skipped("A Save or Update is already running in it.");
    }
    const agent = await terminals.agentSessionState(sessionId, { runtime, session });
    if (agent?.turn?.active) return skipped("Its agent is working. Update it once the agent finishes.");
    const check = await repositoryUpdates.checkSessionUpdates(sessionId, { force: true });
    if (check?.ok === false) return skipped(normalizeText(check.error) || `It could not be checked against ${branch}.`);
    if (!(check.behind > 0)) return { ok: true, sessionId, status: "current", commit: normalizeText(check.canonicalCommit) };
    const contributed = await work.inspectContributedWork(sessionId, "");
    if (contributed?.ok === false) return skipped(normalizeText(contributed.error) || "Its work could not be inspected.");
    if (contributed.publishedCommit && contributed.publishedCommit !== contributed.baseCommit && contributed.ahead > 0) {
      return skipped(`Its pushed contribution is not on ${branch} yet. Merge it through Incoming changes, then update again.`);
    }
    const updated = await work.refreshContributedWork(sessionId);
    if (updated?.ok === false) {
      if (updated.code === "vibe64_session_update_conflict") {
        const paths = updated.details?.conflictRecovery?.conflictPaths || [];
        return skipped(`Updating it to ${branch} conflicts with its changes${paths.length ? ` in ${paths.join(", ")}` : ""}. ` +
          "Open its session to review the conflict.");
      }
      return skipped(normalizeText(updated.error) || `It could not be updated to ${branch}.`);
    }
    return {
      ok: true,
      sessionId,
      status: updated.status === "already_current" ? "current" : "updated",
      commit: normalizeText(updated.operation?.canonicalCommit || updated.canonicalCommit)
    };
  }

  /**
   * @param {{ contribution: object, submittedCommit?: string }} input
   */
  async function inspectContributionWork(input) {
    return sessionResult(async () => {
      const { session } = await contributionSession(input);
      return contributionWorkResult(
        await work.inspectContributedWork(session.sessionId, normalizeText(input.submittedCommit)),
        session
      );
    });
  }

  /**
   * The receiving session itself, as the originating session's development
   * inputs.
   * @param {{ contribution: object }} input
   */
  async function inspectContributionInputs(input) {
    return sessionResult(async () => (await contributionSession(input)).session);
  }

  /**
   * @param {{ contribution: object }} input
   */
  async function inspectContributionIncoming(input) {
    return sessionResult(async () => {
      const { contribution, session } = await contributionSession(input);
      return contributionWorkResult(
        await repositoryReads.inspectIncomingContributions(session.sessionId, { id: contribution.id }),
        session
      );
    });
  }

  /**
   * @param {{ contribution: object, destinationReview: object }} input
   * @param {object} requestContext
   */
  async function saveContributionWork(input, requestContext) {
    return sessionResult(async () => {
      const { session } = await contributionSession(input);
      return contributionWorkResult(await work.saveSessionWork(session.sessionId, input, requestContext), session);
    });
  }

  /**
   * @param {{ contribution: object }} input
   */
  async function updateContributionWork(input) {
    return sessionResult(async () => {
      const { contribution, runtime, session } = await contributionSession(input);
      return refreshConnectedContribution(runtime, session, contribution.integrationBranch);
    });
  }

  /**
   * @param {{ contribution: object }} input
   */
  async function checkContributionUpdates(input) {
    return sessionResult(async () => {
      const { session } = await contributionSession(input);
      return {
        ...await repositoryUpdates.checkSessionUpdates(session.sessionId, { force: true }),
        sessionId: session.sessionId
      };
    });
  }

  /**
   * This project's repository and integration target for a contribution.
   * @param {object} input
   */
  function inspectConnectedContributionSource(input) {
    return project.connectedContributionSource(input);
  }

  async function allocateConnectedSource(input) {
    return sessionResult(async () => {
      assertProjectEffectAdmission();
      if (currentProjectRequestContext()?.learningScope) throw new TypeError("Learning cannot allocate working contribution sources.");
      const contribution = parseSessionConnectedContribution(input.contribution);
      if (!contribution) throw new TypeError("Contribution allocation requires an exact saved binding.");
      const source = await project.connectedContributionSource(input);
      if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch) {
        throw Object.assign(new Error("The receiving repository or integration target changed. Review the source binding."), {
          code: "vibe64_contribution_authority_changed"
        });
      }
      const runtime = await project.createRuntime({ inspectSource: false });
      let predecessor;
      if (contribution.replaces) {
        predecessor = await runtime.getSession(contribution.replaces, { inspectSource: false });
        const saved = sessionConnectedContribution(predecessor);
        if (!saved || saved.repository !== contribution.repository || saved.integrationBranch !== contribution.integrationBranch) {
          throw Object.assign(new Error(
            "The replacement's original source binding changed. Preserve both sources and review the connection."
          ), {
            code: "vibe64_contribution_authority_changed"
          });
        }
      }
      /**
       * A receiving session carries the name of the session it serves; its
       * random identity means nothing to people. It follows that name on later
       * preparations until someone renames the receiving session itself.
       */
      const named = async (allocated) => {
        const sessionId = allocated?.sessionId;
        if (!input.sessionName || !sessionId || allocated.sessionName === input.sessionName) return allocated;
        try {
          const assigned = await runtime.store.readMetadataValue(sessionId, CONNECTED_SESSION_NAME_METADATA);
          if (allocated.sessionName && allocated.sessionName !== assigned) return allocated;
          const sessionName = await runtime.store.writeSessionLabel(sessionId, input.sessionName);
          await runtime.store.writeMetadataValue(sessionId, CONNECTED_SESSION_NAME_METADATA, sessionName);
          await publishSessionChanged(sessionId, { reason: "session-renamed", payload: { clientRefresh: { includeList: true } } });
          return { ...allocated, sessionName };
        } catch (error) {
          vibe64SessionDebugLog("server.sessions.connected.name.error", {
            error: vibe64SessionDebugError(error),
            sessionId: allocated.sessionId
          });
          return allocated;
        }
      };
      let existing;
      try { existing = await runtime.getSession(contribution.id, { inspectSource: false }); }
      catch (error) { if (error.code !== "vibe64_session_not_found") throw error; }
      if (existing) {
        return named(publicSession(await resolveConnectedSession(runtime, contribution, existing)));
      }
      if (contribution.replaces) {
        predecessor = await resolveConnectedSession(runtime, sessionConnectedContribution(predecessor), predecessor);
        const incoming = await repositoryReads.inspectIncomingContributions(predecessor.sessionId, { id: contribution.replaces });
        const entry = incoming.contributions?.find(item => item.id === contribution.replaces);
        if (incoming.ok !== true || entry?.activeHead || entry?.discardedHead !== contribution.baseCommit) {
          throw Object.assign(new Error(
            "The discarded source changed before replacement creation. Preserve the reserved binding and inspect its original branch."
          ), {
            code: "vibe64_connected_replacement_changed"
          });
        }
      }
      return named(await creation.createSession({ vibe64User: trustedAssistantUser(input) }, {
        sessionId: contribution.id,
        expectedCommit: contribution.baseCommit,
        connectedContribution: contribution
      }));
    });
  }

  return Object.freeze({
    allocateConnectedSource,
    checkContributionUpdates,
    inspectConnectedContributionSource,
    inspectContributionIncoming,
    inspectContributionInputs,
    inspectContributionWork,
    saveContributionWork,
    updateContributionWork
  });
}

export { createReceivingContributions };
