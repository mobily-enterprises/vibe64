import { requireCompletedNativeConversationReplacement } from "./assistantChangeover.js";
import { projectServiceNamespaceRoot } from "@local/vibe64-core/server/projectServiceSelection";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { readProjectRuntimeOpenState } from "@local/vibe64-core/server/projectRuntimeOpenState";
import {
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

const AGENT_WRITE_WAIT_MS = 60_000;

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} [sessionId]
 */
function renewalSession(runtime, sessionId) {
  return runtime.getSessionForRenewalWithoutSource(sessionId);
}

async function runSessionRenewalOperation(
  input,
  options,
  context,
  operation,
  readSession
) {
  // readable-check: allow method-probe - input validation: a caller's optional step before the turn starts
  const beforeStart = typeof options.beforeStart === "function"
    ? await options.beforeStart({
      ...context,
      input
    })
    : null;
  if (beforeStart?.ok === false) {
    return beforeStart;
  }
  const nextInput = isRecord(beforeStart?.input)
    ? {
        ...input,
        ...beforeStart.input
      }
    : input;
  // beforeStart is deliberately inside the agent-write lock and may
  // persist the exact basis used by orchestration. Rehydrate before the
  // provider operation so it observes that durable state.
  // readable-check: allow method-probe - input validation: a caller's optional step before the turn starts
  const session = typeof options.beforeStart === "function"
    ? await readSession()
    : context.session;
  return operation(nextInput, {
    ...context,
    session
  });
}

function openProjectRuntimeRecords(listed = {}) {
  const entries = [
    ...(Array.isArray(listed.projects) ? listed.projects : []),
    listed.currentProject
  ].filter((project) => project?.runtime?.open === true);
  const seenSlugs = new Set();
  return entries.filter((project) => {
    const slug = project?.slug;
    if (!slug || seenSlugs.has(slug)) {
      return false;
    }
    seenSlugs.add(slug);
    return true;
  });
}

/**
 * How the service's parts reach a session: its runtime context, the main agent write lock, the open
 * project runtime, terminal session publication, and the hidden renewal write.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 */
function createServiceSessionAccess({
  logger,
  project,
  publishSessionChanged
}) {
  async function runMainAgentWrite(sessionId, options, operation, lockOptions = {}) {
    const runtime = options.runtime || await project.createRuntimeWithoutSource();
    const lockStartedAt = performance.now();
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      async () => {
        if (options.deliveryMessageId) {
          const durationMs = performance.now() - lockStartedAt;
          logOperationalEvent(logger, durationMs >= 1000 ? "warn" : "info", {
            event: "vibe64.agent_message.lock_acquired",
            component: "vibe64.agent_message",
            sessionId,
            messageId: options.deliveryMessageId,
            operation: lockOptions.operation,
            durationMs
          }, "Assistant message acquired its application write lock.");
        }
        const session = await runtime.getSessionWithoutSource(sessionId);
        if (lockOptions.operation !== "replace-agent-conversation") requireCompletedNativeConversationReplacement(session);
        return operation({
          ...options,
          runtime,
          session
        });
      },
      lockOptions
    );
    return exclusive.value;
  }

  /**
   * The project runtime and session a call works on: the caller's runtime and
   * session when given (the session only when it is this one), else fresh reads.
   */
  async function sessionContext(sessionId = "", input = {}) {
    const runtime = input.runtime || await project.createRuntimeWithoutSource();
    const session = input.session?.sessionId === sessionId
      ? input.session
      : await runtime.getSessionWithoutSource(sessionId);
    return { runtime, session };
  }

  async function readAssistantSession(sessionId = "", options = {}) {
    return { ...options, ...await sessionContext(sessionId, options) };
  }

  async function runHiddenSessionRenewalAgentWrite(
    sessionId,
    input,
    options,
    operation
  ) {
    const runtime = options.runtime || await project.createRuntimeWithoutSource();
    const exclusive = await runVibe64RenewalAgentWriteExclusive(
      runtime,
      sessionId,
      async () => {
        const readSession = () => renewalSession(runtime, sessionId);
        const session = await readSession();
        return runSessionRenewalOperation(
          input,
          options,
          {
            ...options,
            runtime,
            session
          },
          operation,
          readSession
        );
      },
      { operation: "seed-renewal-handover" }
    );
    return exclusive.value;
  }

  /**
   * Publishes one kind of terminal session change, for a session that has an id.
   * @param {keyof TerminalSessionChangedPublishers} kind
   * @param {string} sessionId
   * @param {string} reason
   * @param {object} [payload]
   */
  async function publishTerminalSessionChanged(kind, sessionId, reason, payload = {}) {
    if (!String(sessionId || "").trim()) {
      return null;
    }
    return publishSessionChanged[kind](sessionId, {
      ...payload,
      reason
    });
  }

  function projectRuntimeContext() {
    const requestContext = currentProjectRequestContext();
    const projectContextRoot = requestContext?.targetRoot ||
      projectServiceNamespaceRoot(project) ||
      "";
    const projectRuntimeRoot = requestContext?.projectRuntimeRoot || project.currentProjectRuntimeRoot();
    // "global" names the runtime used when no project request context is set.
    const projectSlug = String(requestContext?.slug || "").trim() || "global";
    return {
      projectContextRoot,
      projectRuntimeRoot,
      projectSlug
    };
  }

  async function currentProjectRuntimeOpenState() {
    const context = projectRuntimeContext();
    const runtime = await readProjectRuntimeOpenState({
      projectRuntimeRoot: context.projectRuntimeRoot
    });
    return {
      context,
      runtime
    };
  }

  async function listOpenProjectRuntimeSessions() {
    const runtime = await project.createRuntimeWithoutSource();
    const listOptions = {
      statusGroup: "open"
    };
    return runtime.listSessions(listOptions);
  }

  return Object.freeze({
    currentProjectRuntimeOpenState,
    listOpenProjectRuntimeSessions,
    projectRuntimeContext,
    publishTerminalSessionChanged,
    readAssistantSession,
    runHiddenSessionRenewalAgentWrite,
    runMainAgentWrite,
    sessionContext
  });
}

export {
  createServiceSessionAccess,
  AGENT_WRITE_WAIT_MS,
  openProjectRuntimeRecords,
  renewalSession,
  runSessionRenewalOperation
};
