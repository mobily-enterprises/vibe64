import { randomUUID } from "node:crypto";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { closeTerminalSessionsForNamespace, terminalNamespaceAdmissionFailure } from "@local/vibe64-execution/server/terminalSessions";
import { requireOpenCodeConnection } from "./opencodeServerProcess.js";
import { upstreamMessageId } from "./openCodeConversationStorage.js";
import { OPENCODE_AGENT_RUN_ID } from "./openCodeConversationPresentation.js";
import { openCodeError, openCodeRuntimeFailure as runtimeFailure,
  openCodeSessionId as safeSessionId, opencodeTerminalNamespace } from "./terminalShared.js";

// Authorized application facts and awaited product cleanup. The supplied native
// owner retains process/turn state, readiness, stopping and retry coordination.
function createOpenCodeLifecyclePreparation({
  projectService, getAssistantManager, sharedRuntime, hostPreparation,
  mainMessagePreparation, events, presentation, resolveConnection
}) {
  const { temporaryConversations } = sharedRuntime;
  const { prepareProcess, storedUpstreamSessionId, upstreamSessionOptions,
    sessionEnvironments, writeSessionEnvironmentRegistry } = hostPreparation;
  const { contextFor } = mainMessagePreparation;
  const { writeRun, messageMonitorProjection } = events;
  const { cleanupReasoningSummary, disposeReasoningSummary } = presentation;

  const processRelease = {
    async beforeRelease(target) {
      await closeTerminalSessionsForNamespace(
        opencodeTerminalNamespace(target.sessionId)
      );
      for (const entry of temporaryConversations.values()) {
        if (entry.reasoningSummary && entry.target?.abortController === target.abortController) {
          await disposeReasoningSummary(entry);
        }
      }
    },
    async onRemoved(target) {
      sessionEnvironments.delete(target.key);
      await writeSessionEnvironmentRegistry();
    },
    failure: runtimeFailure
  };

  function prepareSessionCleanup(sessionId = "", options = {}) {
    const id = safeSessionId(sessionId);
    return {
      sessionId: id,
      // Helpers retain the original warm shared-service policy.
      options: { get retainSharedProcess() { return Boolean(options.assistantScope); } },
      application: {
        ...processRelease,
        closeTerminals: () => closeTerminalSessionsForNamespace(opencodeTerminalNamespace(id)),
        async afterRelease() {
          if (getAssistantManager() && !options.assistantScope) {
            const runtime = options.runtime || await projectService.createRuntime({ inspectSource: false });
            await cleanupReasoningSummary({ sessionId: id, runtime, vibe64User: options.vibe64User || null });
          }
        }
      }
    };
  }

  async function prepareInterruption(sessionId, options = {}) {
    const context = await contextFor(sessionId, options);
    return { key: context.key,
      get threadId() { return storedUpstreamSessionId(context); },
      writeRun: (turn, state, error) => writeRun(context, turn, state, error),
      failure: runtimeFailure
    };
  }

  async function prepareSessionReadiness(sessionId, options = {}) {
    let context = await contextFor(sessionId, { ...options, session: null });
    const admissionFailure = terminalNamespaceAdmissionFailure(opencodeTerminalNamespace(sessionId));
    if (admissionFailure) return { value: admissionFailure };
    const changed = () => openCodeError("vibe64_agent_session_changed",
      "The assistant session changed while its connection was being checked.", {}, 409);
    return {
      get key() { return context.key; },
      get selection() { return context.selection; },
      get workdir() { return context.workdir; },
      async connection() {
        return requireOpenCodeConnection(await resolveConnection({
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          modelProviderId: context.selection.modelProviderId,
          sessionId,
          vibe64User: options.vibe64User || null
        }), context.selection.modelProviderId);
      },
      changed,
      async refresh() {
        context = await contextFor(sessionId, { ...options, session: null });
        if (sharedRuntime.closed || sessionIsClosing(context.session) || context.session.status === "archived") throw changed();
        return context;
      },
      prepare(operation) {
        return runVibe64AgentWriteExclusive(context.runtime, sessionId, async () => {
          context = await contextFor(sessionId, { ...options, session: null });
          const failure = terminalNamespaceAdmissionFailure(opencodeTerminalNamespace(sessionId));
          if (failure) return failure;
          if (sharedRuntime.closed || sessionIsClosing(context.session) || context.session.status === "archived") {
            throw openCodeError("vibe64_session_closing", "This session cannot prepare its assistant now.", {}, 409);
          }
          return operation({
            get key() { return context.key; },
            configuration() {
              const current = context;
              return { process: () => prepareProcess(current, options),
                get session() { return upstreamSessionOptions(current); } };
            }
          }).catch(runtimeFailure);
        }, { operation: "prepare-agent-session", waitMs: 10_000 });
      },
      observation: {
        get run() { return (context.session.agentRuns || []).find(run => run.id === OPENCODE_AGENT_RUN_ID); },
        write(operation) {
          return runVibe64AgentWriteExclusive(context.runtime, sessionId, async () => {
            context = await contextFor(sessionId, { ...options, session: null });
            const run = (context.session.agentRuns || []).find(run => run.id === OPENCODE_AGENT_RUN_ID);
            await operation(run, async commit => {
              await context.runtime.store.mutateSession(sessionId, async () => {
                const latest = await context.runtime.getSession(sessionId, { inspectSource: false });
                const currentRun = (latest.agentRuns || []).find(value => value.id === OPENCODE_AGENT_RUN_ID);
                if (JSON.stringify(currentRun) !== JSON.stringify(run)) return;
                await commit((turn, state, error) => writeRun(context, turn, state, error));
              });
            });
          }, { operation: "recover-opencode-observation", waitMs: 10_000 });
        }
      }
    };
  }

  async function prepareSessionReconciliation(sessionId, session, options) {
    const context = await contextFor(sessionId, { ...options, session });
    const activeRun = (Array.isArray(session?.agentRuns) ? session.agentRuns : [])
      .find((run) => run?.id === OPENCODE_AGENT_RUN_ID && run.active === true);
    return {
      activeRun,
      get key() { return context.key; },
      process: () => prepareProcess(context, options),
      session: () => upstreamSessionOptions(context),
      get observation() { return {
        writeRun: (turn, state, error) => writeRun(context, turn, state, error),
        monitor: messageMonitorProjection(context),
        get fallbackTurnId() { return upstreamMessageId(randomUUID()); }
      }; },
      failure: runtimeFailure
    };
  }

  return { processRelease, prepareSessionCleanup, prepareInterruption, prepareSessionReadiness, prepareSessionReconciliation };
}

export { createOpenCodeLifecyclePreparation };
