import crypto from "node:crypto";
import { recordSessionConnectedCopyCommits, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import {
  normalizeRepositoryUpdateCheck,
  REPOSITORY_UPDATE_CHECK_METADATA,
  REPOSITORY_UPDATE_RELATIONSHIPS
} from "@local/vibe64-core/shared";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { sessionHasActiveAgentRun } from "./sessionRenewalRules.js";
import { readSessionRenewalState, SESSION_RENEWAL_STATUS } from "./sessionRenewalState.js";
import { sessionResult } from "./sessionResults.js";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").SessionWorkOperations} SessionWorkOperations */

const REPOSITORY_UPDATE_CHECK_CACHE_MS = 25_000;

/**
 * Whether a probe's head read differs from the session's last check: its own
 * head, or any connected copy's main head.
 * @param {object | null} cached
 * @param {{ head?: string, connected?: Record<string, string> }} read
 */
function headsMoved(cached, read) {
  if (cached?.canonicalCommit !== read.head) return true;
  return Object.entries(read.connected || {}).some(([name, head]) => (
    cached.connected?.find(copy => copy.name === name)?.canonicalCommit !== head
  ));
}

function repositoryUpdateCheckIsFresh(value, now = Date.now()) {
  const checkedAt = Date.parse(normalizeText(value?.checkedAt));
  return Number.isFinite(checkedAt) && now - checkedAt >= 0 &&
    now - checkedAt < REPOSITORY_UPDATE_CHECK_CACHE_MS;
}

function cachedRepositoryUpdateCheck(session) {
  const raw = normalizeText(session?.metadata?.[REPOSITORY_UPDATE_CHECK_METADATA]);
  if (!raw) {
    return null;
  }
  try {
    const parsed = normalizeObject(JSON.parse(raw));
    const checkedAt = normalizeText(parsed.checkedAt);
    const relationship = normalizeText(parsed.relationship);
    if (
      !checkedAt ||
      !Number.isFinite(Date.parse(checkedAt)) ||
      !REPOSITORY_UPDATE_RELATIONSHIPS.has(relationship) ||
      (Number(parsed.behind || 0) > 0 && !Array.isArray(parsed.incomingVersions)) ||
      (
        normalizeText(session.metadata?.canonical_commit) &&
        normalizeText(parsed.canonicalCommit) !== normalizeText(session.metadata.canonical_commit)
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
function createSessionRepositoryUpdates({
  project,
  publishSessionChanged,
  terminals,
  workOperations
}) {
  const activeRepositoryUpdateChecks = new Map();

  /**
   * Records a canonical commit read earlier, and each connected copy's main
   * commit from the same check; a check that also found a repository's work
   * in its saved version moves its base there too.
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {{ canonicalCommit: string, reconciled?: boolean, connected?: object[] }} check
   */
  function recordObservedCanonical(runtime, sessionId, { canonicalCommit, connected = [], reconciled = false }) {
    return project.runProjectSourceExclusive(async () => {
      await runtime.store.writeMetadataValue(sessionId, "canonical_commit", canonicalCommit);
      if (reconciled) await runtime.store.writeMetadataValue(sessionId, "base_commit", canonicalCommit);
      if (connected.length) {
        await recordSessionConnectedCopyCommits(runtime.store, sessionId, Object.fromEntries(connected.map(copy => [
          copy.name,
          { canonicalCommit: copy.canonicalCommit, ...(copy.reconciled ? { baseCommit: copy.canonicalCommit } : {}) }
        ])));
      }
    });
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sourceSessionId
   * @param {string} canonicalCommit
   * @param {object} [options]
   * @param {string} [options.originId]
   */
  async function publishCanonicalChanged(runtime, sourceSessionId, canonicalCommit, options = {}) {
    const {
      originId = ""
    } = options;
    const sessions = await runtime.listSessionSummaries({ statusGroup: "open" });
    const source = await runtime.getSessionWithoutSource(sourceSessionId);
    const currentProject = await project.readCurrentProject();
    const authorityKey = (session) => {
      const { mode, repository, branch } = sessionRepositoryDestination(currentProject, session);
      return JSON.stringify([mode, repository, branch]);
    };
    const sourceAuthority = authorityKey(source);
    const deliveries = await Promise.allSettled(sessions.map(async (candidate) => {
      const candidateId = normalizeText(candidate?.sessionId);
      if (!candidateId || candidateId === sourceSessionId) {
        return;
      }
      if (authorityKey(candidate) !== sourceAuthority) return;
      await recordObservedCanonical(runtime, candidateId, { canonicalCommit });
      await publishSessionChanged(candidateId, {
        operation: "updated",
        originId: normalizeText(originId),
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
          sessionId: normalizeText(sessions[index]?.sessionId),
          sourceSessionId
        });
      }
    });
  }

  async function checkSessionUpdates(sessionId, input) {
    return sessionResult(async () => {
      const normalizedSessionId = normalizeText(sessionId);
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
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
        const previousCanonicalCommit = normalizeText(
          session?.metadata?.canonical_commit || session?.metadata?.base_commit
        );
        const result = await terminals.checkSessionUpdates(sessionId, {
          ...input,
          operationId: crypto.randomUUID(),
          runtime,
          session
        });
        await recordObservedCanonical(runtime, sessionId, {
          canonicalCommit: result.canonicalCommit,
          connected: result.connected || [],
          reconciled: result.reconciled === true
        });
        const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, result);
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-repository-checked",
          payload: { repositoryUpdateCheck: updateCheck },
          session: await runtime.getSessionWithoutSource(sessionId)
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
  }

  /**
   * One tick of a project's update probe (repositoryUpdateProbe.js). It reads
   * every open session's authority head, and each connected copy's main head,
   * with one `ls-remote` per repository, then runs the ordinary forced check
   * above (its fetch, under the project source lock) only for a session whose
   * own or copy's head moved. `memory` holds, per session, the last failure
   * published. A project nobody watches and no agent turn uses is not read at
   * all.
   * @param {string} slug
   * @param {{ memory: Map<string, object>, watched: boolean }} state
   */
  async function probeRepositoryUpdates(slug, state) {
    const { memory, watched } = state;
    return project.runInProjectContext(slug, async () => {
      const runtime = await project.createRuntimeWithoutSource();
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
          let moved = Boolean(remembered.error) || headsMoved(cachedRepositoryUpdateCheck(listed), read);
          if (!failure && moved && read.head && !remembered.error) {
            // An earlier session's check or a browser's may have caught up.
            const session = await runtime.getSessionWithoutSource(sessionId);
            moved = headsMoved(cachedRepositoryUpdateCheck(session), read);
          }
          const renewal = !failure && moved ? await readSessionRenewalState(runtime, sessionId) : null;
          const renewing = [SESSION_RENEWAL_STATUS.RUNNING, SESSION_RENEWAL_STATUS.COMPLETED].includes(renewal?.status) ||
            renewal?.stage === "failure_restoring";
          if (!failure && moved && !renewing) {
            const check = await checkSessionUpdates(sessionId, { force: true });
            if (check?.ok === false) {
              failure = {
                code: normalizeText(check.code),
                message: normalizeText(check.error) || "The project's repository could not be checked for updates."
              };
            }
          }
          if (!failure && renewing) continue;
        } catch (error) {
          failure = {
            code: normalizeText(error?.code),
            message: normalizeText(error?.message) || "The project's repository could not be checked for updates."
          };
        }
        if (!failure) {
          memory.delete(sessionId);
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

  return Object.freeze({
    checkSessionUpdates,
    probeRepositoryUpdates,
    publishCanonicalChanged
  });
}

export { cachedRepositoryUpdateCheck, createSessionRepositoryUpdates, persistRepositoryUpdateCheck };
