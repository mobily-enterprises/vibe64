import { closeTerminalSessionsForCwdRoot } from "@local/vibe64-execution/server/terminalSessions";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import {
  clearProjectRuntimeOpenState,
  readProjectRuntimeOpenState,
  touchProjectRuntimeOpenState,
  writeProjectRuntimeOpenState
} from "@local/vibe64-core/server/projectRuntimeOpenState";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import { createKeyedQueue } from "@local/vibe64-core/server/keyedOperations";
import { PROJECT_RUNTIME_IDLE_TIMEOUT_REASON, projectRuntimeDormancyState } from "./projectRuntimeDormancy.js";
import { openProjectRuntimeRecords } from "./serviceSessionAccess.js";
import { sessionRecordId } from "./serviceSessionRecords.js";
import { closeProjectScopedTerminalNamespaces } from "./serviceSessionTerminals.js";
import { sessionHasActiveAiTask } from "./temporaryConversationRules.js";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {ReturnType<typeof import("./serviceSessionTerminals.js").createServiceSessionTerminals>} ServiceSessionTerminals */
/** @typedef {import("./types.js").ServiceGoals} ServiceGoals */
/** @typedef {ReturnType<typeof import("./serviceAgentReconcile.js").createServiceAgentReconcile>} ServiceAgentReconcile */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProjectRuntimeChangedPublisher} ProjectRuntimeChangedPublisher */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("./types.js").OutputTargetTerminalController} OutputTargetTerminalController */

const PROJECT_RUNTIME_MARKER_MISSING_REASON = "project-runtime-marker-missing";

function closedProjectOutputTargetStatus({
  closeResult = null,
  reason = PROJECT_RUNTIME_MARKER_MISSING_REASON,
  runtime = null
} = {}) {
  return {
    activeTerminal: null,
    closeResult,
    outputTargets: [],
    lastOutputTarget: null,
    ok: closeResult?.ok !== false,
    openTarget: {
      available: false,
      disabledReason: "Project is closed.",
      href: "",
      kind: "url",
      label: "Open browser"
    },
    preview: {
      canRestart: false,
      canShowLog: false,
      canStart: false,
      href: "",
      message: "Project is closed.",
      reason: reason || PROJECT_RUNTIME_MARKER_MISSING_REASON,
      recovery: null,
      state: "project_closed",
      targetHref: "",
      terminalId: ""
    },
    previewTarget: {
      available: false,
      disabledReason: "Project is closed.",
      href: "",
      kind: "url",
      label: "Preview",
      targetHref: ""
    },
    reason,
    runtime
  };
}

/**
 * A project's runtime: opening it, closing it with every session's terminals, closing it when dormant
 * or when its open marker is gone, reconciling its open sessions, and the output target's status.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceSessionTerminals} dependencies.terminals
 * @param {ServiceGoals} dependencies.goals
 * @param {ServiceAgentReconcile} dependencies.reconcile
 * @param {AgentPreviewCommandService} dependencies.agentPreviewCommand
 * @param {OutputTargetTerminalController} dependencies.outputTarget
 * @param {ProjectService} dependencies.project
 * @param {ProjectServices} dependencies.projectServices
 * @param {ProjectRuntimeChangedPublisher} dependencies.publishProjectRuntimeChanged
 * @param {SessionAgentManager} dependencies.sessionAgent
 */
function createServiceProjectRuntime({
  sessionAccess,
  terminals,
  goals,
  reconcile,
  agentPreviewCommand,
  outputTarget,
  project,
  projectServices,
  publishProjectRuntimeChanged,
  sessionAgent
}) {
  const projectRuntimeOpens = createKeyedQueue();

  async function closeProjectRuntimeIfOpenMarkerMissing(eventName = "server.terminals.projectRuntime.markerMissing") {
    const { context, runtime } = await sessionAccess.currentProjectRuntimeOpenState();
    if (runtime.open === true) {
      return null;
    }
    const reason = PROJECT_RUNTIME_MARKER_MISSING_REASON;
    vibe64SessionDebugLog(eventName, {
      projectContextRoot: context.projectContextRoot,
      projectSlug: context.projectSlug,
      reason
    });
    const closeResult = await closeProjectRuntime({
      reason
    });
    return {
      closeResult,
      context,
      reason,
      runtime: closeResult?.runtime || runtime
    };
  }

  /**
   * Idle cleanup decides and closes in the project's open queue, so an open or
   * recorded activity lands either before the decision, keeping the project
   * open, or after the Close, when an open opens the project again.
   */
  async function closeDormantCurrentProjectRuntime(input = {}) {
    return projectRuntimeOpens.run(
      sessionAccess.projectRuntimeContext().projectRuntimeRoot,
      () => closeCurrentProjectRuntimeIfDormant(input)
    );
  }

  async function closeCurrentProjectRuntimeIfDormant(input = {}) {
    const { context, runtime } = await sessionAccess.currentProjectRuntimeOpenState();
    if (runtime.open !== true) {
      return {
        dormant: false,
        ok: true,
        projectSlug: context.projectSlug,
        reason: PROJECT_RUNTIME_MARKER_MISSING_REASON,
        runtime,
        skipped: true,
        projectContextRoot: context.projectContextRoot
      };
    }
    const sessions = await sessionAccess.listOpenProjectRuntimeSessions();
    // A session whose state cannot be read is named, and the project stays
    // open rather than closing on a guess; the other sessions are still read.
    const unreadable = [];
    const sessionStateFailure = (session, error) => {
      unreadable.push({
        error: error instanceof Error ? error.message : String(error || "Session state is unreadable."),
        sessionId: sessionRecordId(session)
      });
    };
    if (sessions.some((session) => {
      try {
        return goals.readGoalIntent(session)?.active === true;
      } catch (error) {
        sessionStateFailure(session, error);
        return false;
      }
    })) {
      return {
        dormant: false,
        ok: true,
        skipped: true,
        reason: "active-goal-intent",
        runtime,
        projectSlug: context.projectSlug,
        projectContextRoot: context.projectContextRoot
      };
    }
    if (sessions.some((session) => session.pinnedSessionId)) {
      return {
        dormant: false,
        ok: true,
        skipped: true,
        reason: "pinned-session",
        runtime,
        projectSlug: context.projectSlug,
        projectContextRoot: context.projectContextRoot
      };
    }
    const dormancy = projectRuntimeDormancyState({
      idleAfterMs: input.idleAfterMs,
      nowMs: input.nowMs,
      runtime,
      sessions
    });
    if (!dormancy.dormant) {
      return {
        dormancy,
        dormant: false,
        ok: true,
        projectSlug: context.projectSlug,
        reason: dormancy.activeAgentSessionIds.length ? "active-agent-run" : "not-dormant",
        runtime,
        skipped: true,
        projectContextRoot: context.projectContextRoot
      };
    }
    const { store } = await project.createRuntimeWithoutSource();
    for (const session of sessions) {
      // A session whose source was never created has run no assistant.
      if (session.sourceReady === false && session.purpose !== "learning") continue;
      let active;
      try {
        const temporary = await sessionAgent.hasActiveTemporaryConversation(session.sessionId, {}, { session });
        active = temporary.active || await sessionHasActiveAiTask(store, session.sessionId);
      } catch (error) {
        sessionStateFailure(session, error);
        continue;
      }
      if (active) {
        return {
          dormancy,
          dormant: false,
          ok: true,
          skipped: true,
          reason: "active-temporary-conversation",
          runtime,
          projectSlug: context.projectSlug,
          projectContextRoot: context.projectContextRoot
        };
      }
    }
    if (unreadable.length > 0) {
      return {
        dormancy,
        dormant: false,
        error: `Idle close skipped: ${unreadable.length} session${unreadable.length === 1 ? "" : "s"} could not be checked.`,
        failed: unreadable,
        ok: false,
        projectSlug: context.projectSlug,
        reason: "session-state-unreadable",
        runtime,
        skipped: true,
        projectContextRoot: context.projectContextRoot
      };
    }
    vibe64SessionDebugLog("server.terminals.projectRuntime.dormantClose.start", {
      idleMs: dormancy.idleMs,
      lastActivityAt: dormancy.lastActivityAt,
      projectContextRoot: context.projectContextRoot,
      projectSlug: context.projectSlug
    });
    const closeResult = await closeProjectRuntime({
      reason: PROJECT_RUNTIME_IDLE_TIMEOUT_REASON
    }, { dormant: true });
    return {
      closeResult,
      dormancy,
      dormant: true,
      ok: closeResult?.ok !== false,
      projectSlug: context.projectSlug,
      reason: PROJECT_RUNTIME_IDLE_TIMEOUT_REASON,
      runtime: closeResult?.runtime || runtime,
      skipped: false,
      projectContextRoot: context.projectContextRoot
    };
  }

  async function closeDormantListedProjectRuntime(projectRecord = {}, input = {}) {
    return project.runInProjectContext(
      projectRecord.slug,
      () => closeDormantCurrentProjectRuntime(input)
    );
  }

  async function openProjectRuntime(input) {
    const context = sessionAccess.projectRuntimeContext();
    const reason = String(input?.reason || "project-open").trim() || "project-open";
    const key = context.projectRuntimeRoot;
    // Tabs share a runtime. Serialize opens so they observe one transition,
    // while every visit still refreshes the dormant-runtime grace period. An
    // open that arrives during idle cleanup waits for its Close, then reopens.
    return projectRuntimeOpens.run(key, async () => {
      projectServices.opened(context);
      const previousRuntime = await readProjectRuntimeOpenState({ projectRuntimeRoot: key });
      const runtime = await writeProjectRuntimeOpenState({
        projectRuntimeRoot: key,
        projectSlug: context.projectSlug,
        reason
      });
      const result = {
        ok: true,
        projectContextRoot: context.projectContextRoot,
        projectSlug: context.projectSlug,
        reason,
        runtime
      };
      if (!previousRuntime.open) {
        await publishProjectRuntimeChanged(result, { action: "runtime-opened" });
      }
      return result;
    });
  }

  /**
   * Records activity, such as typing, in the current project's open runtime so
   * idle cleanup leaves it open. A closed project stays closed.
   */
  async function noteProjectRuntimeActivity() {
    const key = sessionAccess.projectRuntimeContext().projectRuntimeRoot;
    const runtime = await projectRuntimeOpens.run(
      key,
      () => touchProjectRuntimeOpenState({ projectRuntimeRoot: key })
    );
    return { ok: true, runtime };
  }

  function closeDormantProjectRuntime(input = {}) {
    return closeDormantCurrentProjectRuntime(input);
  }

  async function closeDormantProjectRuntimes(input = {}) {
    const listed = await project.listProjects();
    if (listed?.ok === false) {
      return {
        closedCount: 0,
        error: listed.error || "Vibe64 projects could not be listed for dormant runtime cleanup.",
        failed: [listed],
        ok: false,
        projectCount: 0,
        results: []
      };
    }
    const projects = openProjectRuntimeRecords(listed);
    // Practice projects are outside the catalogue but run Preview and agents
    // like any project; the dormant close reads each one's own open state.
    const results = [];
    const listedSlugs = new Set(projects.map((projectRecord) => projectRecord.slug));
    try {
      for (const slug of await project.listPracticeProjectSlugs()) {
        if (!listedSlugs.has(slug)) projects.push({ slug });
      }
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : String(error || "Practice projects could not be listed."),
        ok: false
      });
    }
    for (const projectRecord of projects) {
      try {
        results.push(await closeDormantListedProjectRuntime(projectRecord, input));
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
          ok: false,
          projectContextRoot: String(projectRecord.projectContextRoot || projectRecord.projectRoot || "").trim(),
          projectSlug: projectRecord.slug
        });
      }
    }
    const failed = results.filter((result) => result?.ok === false);
    return {
      closedCount: results.filter((result) => result?.dormant === true && result?.ok !== false).length,
      failed,
      ok: failed.length === 0,
      projectCount: projects.length,
      results
    };
  }

  async function closeProjectRuntime(input, options = {}) {
    const { dormant = false } = options;
    const startedAtMs = Date.now();
    const context = sessionAccess.projectRuntimeContext();
    const projectScope = currentProjectScopeKey();
    const projectContextRoot = context.projectContextRoot;
    const reason = String(input?.reason || "project-close").trim() || "project-close";
    const pinRuntime = await project.createRuntimeWithoutSource();
    return pinRuntime.store.withUnpinnedProject(async () => {
      projectServices.beginClose(context);
      const failed = [];
      let agentProviderRuntimesStopped = 0;
      let projectCwdTerminalClosed = 0;
      let projectCwdNamespaceCount = 0;
      let projectNamespaceCount = 0;
      let projectTerminalClosed = 0;
      let sessionCount = 0;
      let sessionTerminalClosed = 0;
      vibe64SessionDebugLog("server.terminals.closeProjectRuntime.start", {
        projectScope,
        reason
      });
      try {
        let sessions = [];
        try {
          const listed = await sessionAccess.listOpenProjectRuntimeSessions();
          sessions = (Array.isArray(listed) ? listed : []).filter((session) => sessionRecordId(session));
          sessionCount = sessions.length;
        } catch (error) {
          failed.push({
            controller: "sessions",
            error: error instanceof Error ? error.message : String(error || "Project sessions could not be listed."),
            operation: "list-project-sessions"
          });
          vibe64SessionDebugLog("server.terminals.closeProjectRuntime.sessions.error", {
            error: vibe64SessionDebugError(error),
            projectScope,
            reason
          });
        }
        for (const session of sessions) {
          const sessionId = sessionRecordId(session);
          try {
            // The listed session lets cleanup skip work a session without
            // source never started, as an archive's cleanup does.
            const result = await terminals.closeAllSessionTerminals(sessionId, {
              preserveProcessExitProof: true,
              session
            });
            sessionTerminalClosed += Number(result?.closed || 0);
          } catch (error) {
            failed.push({
              ...(Array.isArray(error?.controllers) ? { controllers: error.controllers } : {}),
              error: error instanceof Error ? error.message : String(error || "Session runtime close failed."),
              sessionId
            });
          }
        }

        try {
          const agentResult = await sessionAgent.closeProject({
            preserveProcessExitProof: true,
            projectContextRoot,
            reason
          });
          agentProviderRuntimesStopped = Number(agentResult?.stopped || 0);
          for (const error of Array.isArray(agentResult?.failed) ? agentResult.failed : []) {
            failed.push({
              ...error,
              controller: "assistant-provider"
            });
          }
        } catch (error) {
          failed.push({
            controller: "assistant-provider",
            error: error instanceof Error ? error.message : String(error || "Assistant runtime cleanup failed.")
          });
        }

        try {
          const namespaceResult = await closeProjectScopedTerminalNamespaces({
            projectScope
          });
          projectNamespaceCount = Number(namespaceResult.namespaceCount || 0);
          projectTerminalClosed = Number(namespaceResult.closed || 0);
        } catch (error) {
          failed.push({
            controller: "project-terminals",
            error: error instanceof Error ? error.message : String(error || "Project terminal cleanup failed.")
          });
        }
        try {
          const cwdResult = await closeTerminalSessionsForCwdRoot(
            projectContextRoot
          );
          projectCwdTerminalClosed = Number(cwdResult.closed || 0);
          projectCwdNamespaceCount = Number(cwdResult.namespaceCount || 0);
        } catch (error) {
          failed.push({
            controller: "project-directory-terminals",
            error: error instanceof Error ? error.message : String(error || "Project directory terminal cleanup failed.")
          });
        }
        let projectServicesClosed = false;
        try {
          await projectServices.close(context);
          projectServicesClosed = true;
        } catch (error) {
          failed.push({ controller: "project-services", error: error.message });
        }
        if (projectServicesClosed && failed.length > 0) {
          // The project remains open when another controller cannot finish.
          // Restore service admission after its own cleanup completed so a
          // failed Close cannot strand Preview in a permanent closing state.
          projectServices.opened(context);
        }
        const result = {
          agentProviderRuntimesStopped,
          failed,
          ok: failed.length === 0,
          projectCwdNamespaceCount,
          projectCwdTerminalClosed,
          projectContextRoot,
          projectNamespaceCount,
          projectSlug: context.projectSlug,
          projectScope,
          projectTerminalClosed,
          reason,
          sessionCount,
          sessionTerminalClosed
        };
        if (result.ok === true) {
          const runtime = await clearProjectRuntimeOpenState({
            projectRuntimeRoot: context.projectRuntimeRoot
          });
          result.runtime = runtime;
        }
        await publishProjectRuntimeChanged(result, {
          action: "runtime-closed",
          dormant
        });
        vibe64SessionDebugLog("server.terminals.closeProjectRuntime.done", {
          ...result,
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          failedCount: failed.length
        });
        return result;
      } catch (error) {
        vibe64SessionDebugLog("server.terminals.closeProjectRuntime.error", {
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          error: vibe64SessionDebugError(error),
          projectScope,
          reason
        });
        throw error;
      }
    });
  }

  async function reconcileOpenAgentSessions(options) {
    const closedRuntime = await closeProjectRuntimeIfOpenMarkerMissing(
      "server.terminals.reconcileOpenAgentSessions.closedProject"
    );
    if (closedRuntime) {
      return {
        closeResult: closedRuntime.closeResult,
        failed: Array.isArray(closedRuntime.closeResult?.failed) ? closedRuntime.closeResult.failed : [],
        ok: closedRuntime.closeResult?.ok !== false,
        reason: closedRuntime.reason,
        results: [],
        runtime: closedRuntime.runtime,
        sessionCount: 0,
        skipped: true
      };
    }
    const sessions = await sessionAccess.listOpenProjectRuntimeSessions();
    return reconcile.reconcileAgentSessions(sessions, options);
  }

  async function outputTargetStatus(sessionId, options = {}) {
    const closedRuntime = await closeProjectRuntimeIfOpenMarkerMissing(
      "server.terminals.outputTargetStatus.closedProject"
    );
    if (closedRuntime) {
      return closedProjectOutputTargetStatus(closedRuntime);
    }
    const result = {
      ...await outputTarget.launchStatus(sessionId, options),
      testApproval: agentPreviewCommand.testApprovalStatus(sessionId)
    };
    if (result.ok !== true) return result;
    if (options.outputTargetId != null || options.targetOffset != null || options.runOffset != null) {
      const targets = (result.outputTargets || []).filter(target => !options.outputTargetId || target.id === options.outputTargetId);
      const targetOffset = options.targetOffset ?? 0;
      const runs = result.outputRuns || [];
      const runOffset = options.runOffset ?? 0;
      return {
        ...result,
        requestedOutputTargetId: options.outputTargetId || "",
        outputTargets: targets.slice(targetOffset, targetOffset + 10),
        outputTargetCount: targets.length,
        targetOffset,
        outputRuns: runs.slice(runOffset, runOffset + 5),
        outputRunCount: runs.length,
        runOffset
      };
    }
    return result;
  }

  return Object.freeze({
    closeDormantProjectRuntime,
    closeDormantProjectRuntimes,
    closeProjectRuntime,
    noteProjectRuntimeActivity,
    openProjectRuntime,
    outputTargetStatus,
    reconcileOpenAgentSessions
  });
}

export {
  createServiceProjectRuntime
};
