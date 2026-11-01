import crypto from "node:crypto";
import { sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { normalizeRepositoryUpdateCheck, REPOSITORY_UPDATE_RELATIONSHIPS } from "@local/vibe64-core/shared";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { record } from "./record.js";
import { sessionHasActiveAgentRun } from "./sessionRenewalRules.js";
import { readSessionRenewalState, SESSION_RENEWAL_STATUS } from "./sessionRenewalState.js";
import { sessionResult } from "./sessionResults.js";
import { text } from "./trimmedText.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").SessionWorkOperations} SessionWorkOperations */

const REPOSITORY_UPDATE_CHECK_METADATA = "repository_update_check";
const REPOSITORY_UPDATE_CHECK_CACHE_MS = 25_000;

function repositoryUpdateCheckIsFresh(value = {}, now = Date.now()) {
  const checkedAt = Date.parse(text(value?.checkedAt));
  return Number.isFinite(checkedAt) && now - checkedAt >= 0 &&
    now - checkedAt < REPOSITORY_UPDATE_CHECK_CACHE_MS;
}

function cachedRepositoryUpdateCheck(session = {}) {
  const raw = text(session?.metadata?.[REPOSITORY_UPDATE_CHECK_METADATA]);
  if (!raw) {
    return null;
  }
  try {
    const parsed = record(JSON.parse(raw));
    const checkedAt = text(parsed.checkedAt);
    const relationship = text(parsed.relationship);
    if (
      !checkedAt ||
      !Number.isFinite(Date.parse(checkedAt)) ||
      !REPOSITORY_UPDATE_RELATIONSHIPS.has(relationship) ||
      (Number(parsed.behind || 0) > 0 && !Array.isArray(parsed.incomingVersions)) ||
      (
        text(session?.metadata?.canonical_commit) &&
        text(parsed.canonicalCommit) !== text(session.metadata.canonical_commit)
      )
    ) {
      return null;
    }
    const normalized = normalizeRepositoryUpdateCheck(parsed, checkedAt);
    return normalized.relationship === relationship ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {object} [result]
 */
async function persistRepositoryUpdateCheck(runtime, sessionId, result = {}) {
  const status = normalizeRepositoryUpdateCheck(result);
  await runtime.store.writeMetadataValue(
    sessionId,
    REPOSITORY_UPDATE_CHECK_METADATA,
    JSON.stringify(status)
  );
  return status;
}

/**
 * Whether a session's saved project version moved: the short-lived cached
 * check, the forced check against its authority, the project's periodic probe,
 * and the canonical change announced to the sessions that share a destination.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWorkOperations} dependencies.workOperations
 */
function createSessionRepositoryUpdates({ project, publishSessionChanged, terminals, workOperations }) {
  const activeRepositoryUpdateChecks = new Map();

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sourceSessionId
   * @param {string} canonicalCommit
   * @param {object} [options]
   * @param {string} [options.originId]
   */
  async function publishCanonicalChanged(runtime, sourceSessionId, canonicalCommit, {
    originId = ""
  } = {}) {
    const sessions = await runtime.listSessionSummaries({ statusGroup: "open" });
    const source = await runtime.getSession(sourceSessionId, { inspectSource: false });
    const currentProject = await project.readCurrentProject();
    const authorityKey = (session) => {
      const { mode, repository, branch } = sessionRepositoryDestination(currentProject, session);
      return JSON.stringify([mode, repository, branch]);
    };
    const sourceAuthority = authorityKey(source);
    const deliveries = await Promise.allSettled(sessions.map(async (candidate) => {
      const candidateId = text(candidate?.sessionId);
      if (!candidateId || candidateId === sourceSessionId) {
        return;
      }
      if (authorityKey(candidate) !== sourceAuthority) return;
      await runtime.store.writeMetadataValue(
        candidateId,
        "canonical_commit",
        canonicalCommit
      );
      await publishSessionChanged(candidateId, {
        operation: "updated",
        originId: text(originId),
        payload: {
          canonicalCommit,
          sourceSessionId
        },
        reason: "repository-canonical-changed",
        session: candidate
      });
    }));
    deliveries.forEach((delivery, index) => {
      if (delivery.status === "rejected") {
        vibe64SessionDebugLog("server.sessions.repositoryCanonicalChanged.publish.error", {
          error: vibe64SessionDebugError(delivery.reason),
          sessionId: text(sessions[index]?.sessionId),
          sourceSessionId
        });
      }
    });
  }

  const updates = Object.freeze({
    publishCanonicalChanged,
    async checkSessionUpdates(sessionId, input = {}) {
      return sessionResult(async () => {
        const normalizedSessionId = text(sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const activeCheck = activeRepositoryUpdateChecks.get(normalizedSessionId);
        if (activeCheck) {
          return activeCheck;
        }
        const cached = cachedRepositoryUpdateCheck(session);
        if (input.force !== true && cached && repositoryUpdateCheckIsFresh(cached)) {
          return {
            ...cached,
            cached: true,
            ok: true
          };
        }
        const check = (async () => {
          const previousCanonicalCommit = text(
            session?.metadata?.canonical_commit || session?.metadata?.base_commit
          );
          const result = await terminals.checkSessionUpdates(sessionId, {
            ...input,
            operationId: crypto.randomUUID(),
            runtime,
            session
          });
          await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.canonicalCommit);
          if (result.reconciled === true) {
            await runtime.store.writeMetadataValue(sessionId, "base_commit", result.canonicalCommit);
          }
          const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, result);
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-repository-checked",
            payload: { repositoryUpdateCheck: updateCheck },
            session: await runtime.getSession(sessionId, { inspectSource: false })
          });
          if (previousCanonicalCommit && previousCanonicalCommit !== result.canonicalCommit) {
            await publishCanonicalChanged(runtime, sessionId, result.canonicalCommit, {
              originId: input.originId
            });
          }
          return {
            ...result,
            ...updateCheck
          };
        })();
        activeRepositoryUpdateChecks.set(normalizedSessionId, check);
        try {
          return await check;
        } finally {
          if (activeRepositoryUpdateChecks.get(normalizedSessionId) === check) {
            activeRepositoryUpdateChecks.delete(normalizedSessionId);
          }
        }
      }, "Vibe64 could not check this session for updates.");
    },

    // One tick of a project's update probe (repositoryUpdateProbe.js). It reads
    // every open session's authority head with one `ls-remote` per authority
    // repository, then runs the ordinary forced check above (its fetch, under
    // the project source lock) only for a session whose head moved. `memory`
    // holds, per session, a connected contribution's authority heads and the
    // last failure published. A project nobody watches and no agent turn uses
    // is not read at all.
    async probeRepositoryUpdates(slug, { memory = new Map(), watched = false } = {}) {
      return project.runInProjectContext(slug, async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const open = await runtime.listSessions({ statusGroup: "open" });
        if (!watched && !open.some(sessionHasActiveAgentRun)) {
          return { failed: false, inUse: false };
        }
        // A running Save or Update publishes its own result.
        const sessions = open.filter((session) => session.status === "active" &&
          !workOperations.isRunning(session.sessionId));
        for (const sessionId of memory.keys()) {
          if (!sessions.some((session) => session.sessionId === sessionId)) memory.delete(sessionId);
        }
        const reads = await terminals.readRepositoryAuthorityHeads({ sessions });
        let failed = false;
        for (const listed of sessions) {
          const sessionId = listed.sessionId;
          const read = reads.get(sessionId);
          if (!read) continue;
          const remembered = memory.get(sessionId) || {};
          let failure = read.error ? { code: read.code, message: read.error } : null;
          try {
            // A session whose last check failed is checked again until it succeeds.
            let moved = Boolean(remembered.error) || (read.head
              ? cachedRepositoryUpdateCheck(listed)?.canonicalCommit !== read.head
              : remembered.authority !== read.authority);
            if (!failure && moved && read.head && !remembered.error) {
              // An earlier session's check or a browser's may have caught up.
              const session = await runtime.getSession(sessionId, { inspectSource: false });
              moved = cachedRepositoryUpdateCheck(session)?.canonicalCommit !== read.head;
            }
            const renewal = !failure && moved ? await readSessionRenewalState(runtime, sessionId) : null;
            const renewing = [SESSION_RENEWAL_STATUS.RUNNING, SESSION_RENEWAL_STATUS.COMPLETED].includes(renewal?.status) ||
              renewal?.stage === "failure_restoring";
            if (!failure && moved && !renewing) {
              const check = await updates.checkSessionUpdates(sessionId, { force: true });
              if (check?.ok === false) {
                failure = { code: text(check.code), message: text(check.error) || "The project's repository could not be checked for updates." };
              }
            }
            if (!failure && renewing) continue;
          } catch (error) {
            failure = { code: text(error?.code), message: text(error?.message) || "The project's repository could not be checked for updates." };
          }
          if (!failure) {
            if (read.authority) memory.set(sessionId, { authority: read.authority });
            else memory.delete(sessionId);
            continue;
          }
          failed = true;
          memory.set(sessionId, { ...remembered, error: failure.message });
          if (remembered.error === failure.message) continue;
          await publishSessionChanged(sessionId, {
            operation: "updated",
            reason: "session-repository-check-failed",
            payload: { repositoryUpdateCheckError: { ...failure, checkedAt: new Date().toISOString() } },
            session: listed
          });
        }
        return { failed, inUse: true };
      });
    }
  });
  return updates;
}

export { cachedRepositoryUpdateCheck, createSessionRepositoryUpdates, persistRepositoryUpdateCheck };
