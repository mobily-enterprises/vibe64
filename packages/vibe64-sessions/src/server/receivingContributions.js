import { isDeepStrictEqual } from "node:util";
import {
  CONNECTED_LINK_REQUIRED,
  contributionSessionId,
  parseSessionConnectedContribution,
  sessionConnectedContribution,
  sessionConnectedSources
} from "@local/vibe64-core/server/projectRepository";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { assertProjectEffectAdmission, currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { VIBE64_SESSION_STATUS, vibe64SessionStatusIsOpen } from "@local/vibe64-runtime/server/sessionStore";
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

/** A session as people know it: its name, or its identity when it has none. */
function connectedSessionLabel(session) {
  return normalizeText(session.sessionName) || session.sessionId;
}

/**
 * A session, or null when it no longer exists.
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 */
async function sessionIfPresent(runtime, sessionId) {
  try {
    return await runtime.getSessionWithoutSource(sessionId);
  } catch (error) {
    if (error.code !== "vibe64_session_not_found") throw error;
    return null;
  }
}

/**
 * The refusal that sends a person to choose a session for this project.
 * `reason` is the part a choice shows beside this project's name.
 * @param {string} reason
 * @param {{ unfinishedReplacement?: boolean }} [options]
 */
function connectedLinkRequired(reason, { unfinishedReplacement = false } = {}) {
  return vibe64Error(`${reason} Run Prepare workspace and choose a session for it.`, CONNECTED_LINK_REQUIRED, {
    details: { reason, unfinishedReplacement }
  });
}

/**
 * Why a session cannot take a contribution, or "" when it is free: an active
 * session with its source, on this project's own branch, and bound to no
 * contribution.
 *
 * Save waits for a session's connected sessions, so links must never form a
 * cycle. Nothing links to a session unbound before now, so only a contribution
 * can close one, and it can only do that through a session that uses others.
 * @param {object} session
 * @param {boolean} originIsContribution whether the asking session is itself a contribution
 */
function linkRefusal(session, originIsContribution) {
  const metadata = session.metadata || {};
  if (session.status !== VIBE64_SESSION_STATUS.ACTIVE || metadata.renewed_to) return "That session is no longer open.";
  if (!session.sourceReady || !metadata.base_commit) return "That session's source is not ready.";
  if (metadata.connected_contribution !== undefined) return "That session is already linked to another contribution.";
  if (metadata.github_pull_request || metadata.repository_branch) return "That session works on its own branch or pull request.";
  if (originIsContribution && sessionConnectedSources(session).length) return "That session uses connected sessions of its own.";
  return "";
}

/**
 * The receiving side of connected contributions: the session that holds an
 * originating project's contribution in this project, chosen, linked,
 * inspected, saved, checked and updated for that project through this
 * project's own internal actions.
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
      const saved = sessionConnectedContribution(session);
      if (!saved) throw connectedLinkRequired(`The link to ${connectedSessionLabel(session)} in ${contribution.repository} was not finished.`);
      if (!isDeepStrictEqual(saved, contribution)) {
        throw vibe64Error(
          "The receiving source binding changed. Preserve its checkout and review the connection.",
          "vibe64_contribution_authority_changed",
          { details: { sessionId: session.sessionId }, messageCode: "vibe64_connected_receiving_binding_changed" }
        );
      }
      const successorId = normalizeText(session.metadata?.renewed_to);
      if (vibe64SessionStatusIsOpen(session.status) && !successorId) return session;
      if (session.status === VIBE64_SESSION_STATUS.ARCHIVED && !successorId) {
        const archivedOn = normalizeText(session.archivedAt).slice(0, 10);
        throw connectedLinkRequired(`Its connected session ${connectedSessionLabel(session)} in ${contribution.repository} ` +
          `was archived${archivedOn ? ` on ${archivedOn}` : ""}.`);
      }
      if (session.status !== VIBE64_SESSION_STATUS.ARCHIVED) break;
      const state = await readSessionRenewalState(runtime, session.sessionId);
      if (state?.status !== SESSION_RENEWAL_STATUS.COMPLETED || !state.predecessorArchivedAt ||
          !state.successor?.availableAt || state.successor.sessionId !== successorId ||
          state.commit?.successorSessionId !== successorId ||
          state.renewalId !== session.metadata.renewal_id) break;
      const successor = await sessionIfPresent(runtime, successorId);
      if (!successor) throw connectedLinkRequired(`The connected session in ${contribution.repository} no longer exists.`);
      if (successor.metadata?.renewed_from !== session.sessionId) break;
      session = successor;
    }
    throw vibe64Error(
      "This contribution's current session is unavailable. Complete its renewal or recover its source in the receiving project.",
      "vibe64_connected_source_unavailable",
      {
        details: { sessionId: session?.sessionId || contribution.id },
        messageCode: "vibe64_connected_receiving_session_unavailable"
      }
    );
  }

  /**
   * The session a contribution's binding points at. A binding whose session is
   * gone needs a person's choice, never a quiet replacement.
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} contribution
   */
  async function linkedSession(runtime, contribution) {
    const session = await sessionIfPresent(runtime, contributionSessionId(contribution));
    if (session) return session;
    if (contribution.replaces) {
      throw connectedLinkRequired(`The replacement contribution for ${contribution.repository} was confirmed but not created.`, {
        unfinishedReplacement: true
      });
    }
    throw connectedLinkRequired(`The connected session in ${contribution.repository} no longer exists.`);
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
    const runtime = await project.createRuntimeWithoutSource();
    if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch) {
      throw vibe64Error(
        "The receiving source binding changed. Preserve its checkout and review the connection.",
        "vibe64_contribution_authority_changed",
        { messageCode: "vibe64_connected_receiving_binding_changed" }
      );
    }
    const session = await resolveConnectedSession(runtime, contribution, await linkedSession(runtime, contribution));
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
      throw vibe64Error(
        result.operation.error || "Whether the connected Save was pushed is still unknown. Inspect work before retrying.",
        "vibe64_session_save_publication_unknown",
        { details: { sessionId: session.sessionId } }
      );
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

  /**
   * A working session's contribution, admitted and checked against this
   * project's current repository and integration target.
   * @param {{ contribution: object }} input
   */
  async function admittedContribution(input) {
    assertProjectEffectAdmission();
    if (currentProjectRequestContext()?.learningScope) throw new TypeError("Learning cannot use working contribution sources.");
    const contribution = parseSessionConnectedContribution(input.contribution);
    if (!contribution) throw new TypeError("A connected source requires an exact saved binding.");
    const source = await project.connectedContributionSource(input);
    if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch) {
      throw vibe64Error(
        "The receiving repository or integration target changed. Review the source binding.",
        "vibe64_contribution_authority_changed",
        { messageCode: "vibe64_connected_receiving_target_changed" }
      );
    }
    return { contribution, runtime: await project.createRuntimeWithoutSource() };
  }

  /**
   * A receiving session carries the name of the session it serves when it has
   * none of its own; its identity means nothing to people. It follows that
   * name on later preparations until someone renames the receiving session.
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} session
   * @param {string} [servedName]
   */
  async function withServedName(runtime, session, servedName) {
    const sessionId = session?.sessionId;
    if (!servedName || !sessionId || session.sessionName === servedName) return session;
    try {
      const assigned = await runtime.store.readMetadataValue(sessionId, CONNECTED_SESSION_NAME_METADATA);
      if (session.sessionName && session.sessionName !== assigned) return session;
      const sessionName = await runtime.store.writeSessionLabel(sessionId, servedName);
      await runtime.store.writeMetadataValue(sessionId, CONNECTED_SESSION_NAME_METADATA, sessionName);
      await publishSessionChanged(sessionId, { reason: "session-renamed", payload: { clientRefresh: { includeList: true } } });
      return { ...session, sessionName };
    } catch (error) {
      vibe64SessionDebugLog("server.sessions.connected.name.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
      return session;
    }
  }

  /**
   * The session a contribution is linked to, for workspace preparation.
   * Preparation never creates one: a missing or archived link is a person's choice.
   * @param {{ contribution: object, sessionName?: string }} input
   */
  async function resolveConnectedSource(input) {
    return sessionResult(async () => {
      const { contribution, runtime } = await admittedContribution(input);
      const session = await resolveConnectedSession(runtime, contribution, await linkedSession(runtime, contribution));
      return withServedName(runtime, publicSession(session), input.sessionName);
    });
  }

  /**
   * The new session of a replacement the person reviewed and confirmed, the
   * only contribution session this project ever creates. A retry finds the
   * session its reserved identity already made.
   * @param {{ contribution: object, sessionName?: string }} input
   */
  async function createConnectedReplacement(input) {
    return sessionResult(async () => {
      const { contribution, runtime } = await admittedContribution(input);
      if (!contribution.replaces) throw new TypeError("Only a confirmed replacement creates a contribution session.");
      const original = await runtime.getSessionWithoutSource(contribution.replacesSessionId || contribution.replaces);
      const saved = sessionConnectedContribution(original);
      if (!saved || saved.repository !== contribution.repository || saved.integrationBranch !== contribution.integrationBranch) {
        throw vibe64Error(
          "The replacement's original source binding changed. Preserve both sources and review the connection.",
          "vibe64_contribution_authority_changed",
          { messageCode: "vibe64_connected_replacement_binding_changed" }
        );
      }
      const existing = await sessionIfPresent(runtime, contribution.id);
      if (existing) {
        return withServedName(runtime, publicSession(await resolveConnectedSession(runtime, contribution, existing)), input.sessionName);
      }
      const predecessor = await resolveConnectedSession(runtime, saved, original);
      const incoming = await repositoryReads.inspectIncomingContributions(predecessor.sessionId, { id: contribution.replaces });
      const entry = incoming.contributions?.find(item => item.id === contribution.replaces);
      if (incoming.ok !== true || entry?.activeHead || entry?.discardedHead !== contribution.baseCommit) {
        throw vibe64Error(
          "The discarded source changed before replacement creation. Preserve the reserved binding and inspect its original branch.",
          "vibe64_connected_replacement_changed",
          { messageCode: "vibe64_connected_replacement_source_changed" }
        );
      }
      return withServedName(runtime, await creation.createSession({ vibe64User: trustedAssistantUser(input) }, {
        sessionId: contribution.id,
        expectedCommit: contribution.baseCommit,
        connectedContribution: contribution
      }), input.sessionName);
    });
  }

  /**
   * What a person needs to choose a session here: whether the saved link still
   * holds and, when it does not, why, and this project's free sessions.
   * @param {{ contribution?: object, originIsContribution: boolean }} input
   */
  async function inspectConnectedSessions(input) {
    return sessionResult(async () => {
      let reason = "";
      let unfinishedReplacement = false;
      if (input.contribution) {
        try {
          await contributionSession(input);
          return { ok: true, linked: true, reason, sessions: [], unfinishedReplacement };
        } catch (error) {
          if (error.code !== CONNECTED_LINK_REQUIRED) throw error;
          ({ reason, unfinishedReplacement } = error.details);
        }
      }
      const source = await project.connectedContributionSource(input);
      const runtime = await project.createRuntimeWithoutSource();
      const open = await runtime.listSessionSummaries({ statusGroup: "open" });
      return {
        ok: true,
        linked: false,
        reason,
        sessions: open.filter(session => !linkRefusal(session, input.originIsContribution)).map(session => ({
          sessionId: session.sessionId,
          sessionName: connectedSessionLabel(session),
          baseCommit: session.metadata.base_commit
        })),
        source,
        unfinishedReplacement
      };
    });
  }

  /**
   * Why preparation may not take this session by itself, or "" when it is
   * untouched: no commits beyond the main it started from, no unsaved work
   * beyond what its setup generates, and nothing running in it. Linking cannot
   * be undone and changes where the session saves, so anything less than a
   * clear answer, a check that cannot finish included, is left to a person.
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} session
   */
  async function automaticLinkRefusal(runtime, session) {
    const { sessionId } = session;
    if (session.pinnedSessionId === sessionId) return "it is pinned.";
    if (sessionIsClosing(session)) return "it is closing.";
    if (workOperations.isRunning(sessionId)) return "a Save or Update is running in it.";
    try {
      if (await terminals.sessionAiWorkRunning(sessionId, { runtime, session })) return "AI work is running in it.";
      const work = await terminals.inspectSessionWork(sessionId, { runtime, session });
      if (work?.ok !== true) return "its work could not be checked.";
      if (work.sessionHead !== session.metadata.base_commit) return "it has commits of its own.";
      return work.unsaved === false ? "" : "it has unsaved changes.";
    } catch (error) {
      vibe64SessionDebugLog("server.sessions.connected.untouchedCheck.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
      return "its work could not be checked.";
    }
  }

  /**
   * Binds a chosen session to a contribution. The session's write lease makes
   * this the one point that decides who gets it, so its freedom is checked
   * again here rather than trusted from the list that offered it. Preparation's
   * own link also asks for an untouched session; this is the latest moment that
   * check can run, so work started just before it is seen.
   *
   * From here the session follows its contribution: its canonical source is
   * the contribution's base until the contribution is pushed, so a canonical
   * commit recorded from the integration branch no longer applies.
   * @param {{
   *   contribution: object,
   *   onlyIfUntouched: boolean,
   *   originIsContribution: boolean,
   *   vibe64User?: object | null
   * }} input
   */
  async function bindConnectedSession(input) {
    return sessionResult(async () => {
      const { contribution } = await admittedContribution(input);
      const sessionId = contributionSessionId(contribution);
      return terminals.runConnectedSourcePreparation(sessionId, input, async ({ runtime, session }) => {
        if (isDeepStrictEqual(sessionConnectedContribution(session), contribution)) return publicSession(session);
        const refusal = linkRefusal(session, input.originIsContribution);
        if (refusal) throw vibe64Error(`${refusal} Choose again.`, "vibe64_connected_session_not_free");
        if (session.metadata.base_commit !== contribution.baseCommit) {
          throw vibe64Error("That session moved to another commit. Choose again.", "vibe64_connected_session_not_free");
        }
        const inUse = input.onlyIfUntouched ? await automaticLinkRefusal(runtime, session) : "";
        if (inUse) throw vibe64Error(inUse, "vibe64_connected_session_in_use");
        const recorded = await terminals.recordSessionGitCommandActor(sessionId, {
          reason: "connected-contribution-session",
          runtime,
          vibe64User: trustedAssistantUser(input)
        });
        if (recorded?.ok === false) throw Object.assign(new Error(recorded.error), { code: recorded.code });
        await runtime.store.writeMetadataValue(sessionId, "canonical_commit", contribution.baseCommit);
        await runtime.store.writeMetadataValue(sessionId, "connected_contribution", JSON.stringify(contribution));
        const linked = await runtime.getSessionWithoutSource(sessionId);
        await publishSessionChanged(sessionId, { operation: "updated", reason: "session-connected-linked", session: linked });
        return publicSession(linked);
      });
    });
  }

  return Object.freeze({
    bindConnectedSession,
    checkContributionUpdates,
    createConnectedReplacement,
    inspectConnectedContributionSource,
    inspectConnectedSessions,
    inspectContributionIncoming,
    inspectContributionInputs,
    inspectContributionWork,
    resolveConnectedSource,
    saveContributionWork,
    updateContributionWork
  });
}

export { createReceivingContributions };
