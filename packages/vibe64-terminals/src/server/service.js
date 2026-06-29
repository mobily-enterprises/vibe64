import { createCodexTerminalController } from "./codexTerminal.js";
import process from "node:process";
import {
  createCommandTerminalController,
  createProjectToolTerminalController
} from "./commandTerminal.js";
import { createAgentPreviewCommandService } from "./agentPreviewCommand.js";
import { createCodexGitCommandService } from "./codexGitCommand.js";
import { createLaunchTargetTerminalController } from "./launchTargetTerminal.js";
import { createShellTerminalController } from "./shellTerminal.js";
import {
  recordSessionGitCommandActor as writeSessionGitCommandActor
} from "./sessionGitCommandActor.js";
import {
  projectToolFailureFixPrompt,
  sessionTerminalFailureFixPrompt
} from "@local/vibe64-runtime/server/terminalFailureFixRequest";
import {
  directoryExists,
  ensureTerminalSessionSourceGitSelfContained,
  terminalTargetRoot,
  terminalWorktreePath,
  terminalProjectScopeKey
} from "./terminalShared.js";
import {
  closeTerminalSessionsForCwdRoot,
  closeTerminalSessionsForNamespace,
  listTerminalSessions
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  clearProjectRuntimeOpenState,
  readProjectRuntimeOpenState,
  writeProjectRuntimeOpenState
} from "@local/vibe64-core/server/projectRuntimeOpenState";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  codexProviderContext
} from "@local/studio-terminal-core/server/providerHomes";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  vibe64AgentRunStateIsActive
} from "@local/vibe64-runtime/server/sessionStore";

const CODEX_AFTER_COMMAND_THREAD_PREP_ENABLED = false;
const PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS = 30 * 60 * 1000;
const PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const PROJECT_RUNTIME_IDLE_TIMEOUT_REASON = "idle-timeout";
const PROJECT_RUNTIME_MARKER_MISSING_REASON = "project-runtime-marker-missing";

function truthyEnvFlag(value = "") {
  return /^(1|true|yes|on)$/iu.test(String(value || "").trim());
}

function recordValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeAgentProviderId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function terminalNamespaceMatchesProjectScope(namespace = "", projectScope = "") {
  const normalizedNamespace = String(namespace || "").trim();
  const normalizedScope = String(projectScope || "").trim();
  if (!normalizedNamespace || !normalizedScope) {
    return false;
  }
  const marker = `:${normalizedScope}`;
  return normalizedNamespace.endsWith(marker) || normalizedNamespace.includes(`${marker}:`);
}

function projectScopedTerminalNamespaces(projectScope = "") {
  const namespaces = new Set();
  for (const entry of listTerminalSessions({})) {
    const namespace = String(entry?.namespace || "").trim();
    if (terminalNamespaceMatchesProjectScope(namespace, projectScope)) {
      namespaces.add(namespace);
    }
  }
  return [...namespaces].sort();
}

function normalizePositiveDurationMs(value, fallback) {
  const normalized = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function timestampMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampIso(ms = 0) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

function agentRunIsActive(run = {}) {
  if (run?.active === true) {
    return true;
  }
  try {
    return vibe64AgentRunStateIsActive(run?.state);
  } catch {
    return false;
  }
}

function sessionHasActiveAgentRun(session = {}) {
  return (Array.isArray(session?.agentRuns) ? session.agentRuns : []).some(agentRunIsActive);
}

function sessionRecordId(session = {}) {
  return String(session?.sessionId || session?.id || "").trim();
}

function sessionActivityTimestamps(session = {}) {
  const manifest = session?.manifest && typeof session.manifest === "object" && !Array.isArray(session.manifest)
    ? session.manifest
    : {};
  return [
    timestampMs(session.updatedAt),
    timestampMs(manifest.updatedAt),
    ...(Array.isArray(session?.agentRuns) ? session.agentRuns.map((run) => timestampMs(run?.updatedAt)) : []),
    ...(Array.isArray(session?.backgroundTasks) ? session.backgroundTasks.map((task) => timestampMs(task?.updatedAt)) : []),
    ...(Array.isArray(session?.commandLifecycles) ? session.commandLifecycles.map((entry) => timestampMs(entry?.updatedAt)) : [])
  ].filter((value) => value > 0);
}

function projectRuntimeDormancyState({
  idleAfterMs = PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS,
  nowMs = Date.now(),
  runtime = {},
  sessions = []
} = {}) {
  const normalizedIdleAfterMs = normalizePositiveDurationMs(idleAfterMs, PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS);
  const normalizedNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const sessionRecords = Array.isArray(sessions) ? sessions : [];
  const activeAgentSessionIds = sessionRecords
    .filter(sessionHasActiveAgentRun)
    .map((session) => String(session?.sessionId || session?.id || "").trim())
    .filter(Boolean)
    .sort();
  const activityMs = [
    timestampMs(runtime.updatedAt),
    timestampMs(runtime.openedAt),
    ...sessionRecords.flatMap(sessionActivityTimestamps)
  ].filter((value) => value > 0);
  const lastActivityMs = activityMs.length ? Math.max(...activityMs) : 0;
  const idleMs = lastActivityMs > 0 ? Math.max(0, normalizedNowMs - lastActivityMs) : 0;
  const open = runtime?.open === true;
  return {
    activeAgentSessionIds,
    dormant: open && activeAgentSessionIds.length === 0 && lastActivityMs > 0 && idleMs >= normalizedIdleAfterMs,
    idleAfterMs: normalizedIdleAfterMs,
    idleMs,
    lastActivityAt: timestampIso(lastActivityMs),
    now: timestampIso(normalizedNowMs),
    open,
    sessionCount: sessionRecords.length
  };
}

function selfTargetCodexAppServerProviderOptions({
  codexTerminalController = {},
  env = process.env
} = {}) {
  const existing = {
    ...(codexTerminalController.codexAppServerProviderOptions || {})
  };
  existing.env = {
    ...recordValue(process.env),
    ...recordValue(env),
    ...recordValue(existing.env)
  };
  if (
    truthyEnvFlag(env[VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV]) &&
    existing.useDocker === undefined
  ) {
    existing.useDocker = false;
  }
  return existing;
}

function codexToolHomeSourceFromEnv(env = process.env) {
  const context = codexProviderContext({
    providerHomesRoot: String(env[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "")
  });
  return context?.ok === true ? context.toolHomeSource : "";
}

async function closeTerminalControllerForSession({
  controller,
  eventPrefix = "server.terminals.closeSessionTerminals",
  label = "",
  sessionId = ""
} = {}) {
  if (typeof controller?.closeAllForSession !== "function") {
    return {
      closed: 0,
      ok: true
    };
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog(`${eventPrefix}.controller.start`, {
    controller: label,
    sessionId
  });
  try {
    const result = await controller.closeAllForSession(sessionId);
    vibe64SessionDebugLog(`${eventPrefix}.controller.done`, {
      closed: Number(result?.closed || 0),
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      ok: result?.ok !== false,
      sessionId
    });
    return result;
  } catch (error) {
    vibe64SessionDebugLog(`${eventPrefix}.controller.error`, {
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      sessionId
    });
    throw error;
  }
}

async function closeTerminalControllersForSession(sessionId = "", controllers = [], {
  eventPrefix = "server.terminals.closeSessionTerminals"
} = {}) {
  let closed = 0;
  for (const entry of controllers) {
    const result = await closeTerminalControllerForSession({
      ...entry,
      eventPrefix,
      sessionId
    });
    closed += Number(result?.closed || 0);
  }
  return {
    closed,
    ok: true
  };
}

function createService({
  authorizeCodexGitActorAccess = null,
  codexTerminalController = {},
  env = process.env,
  logger = null,
  projectService,
  publishProjectChanged = null,
  publishSessionChanged = {}
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }

  const codexGitCommand = createCodexGitCommandService({
    authorizeActorAccess: authorizeCodexGitActorAccess,
    env,
    logger,
    projectService
  });
  const launchTarget = createLaunchTargetTerminalController({
    projectService,
    publishSessionChanged: publishSessionChanged.launchTarget
  });
  const agentPreviewCommand = createAgentPreviewCommandService({
    launchTarget,
    logger
  });
  const codex = createCodexTerminalController({
    ...codexTerminalController,
    agentPreviewCommand,
    codexAppServerProviderOptions: selfTargetCodexAppServerProviderOptions({
      codexTerminalController,
      env
    }),
    codexToolHomeRequired: codexTerminalController.codexToolHomeRequired ?? true,
    codexToolHomeSource: codexTerminalController.codexToolHomeSource || codexToolHomeSourceFromEnv(env),
    codexGitCommand,
    env,
    projectService,
    publishPromptInjected: publishSessionChanged.codexPrompt,
    publishSessionChanged: publishSessionChanged.codexTerminal
  });
  const command = createCommandTerminalController({
    afterSuccessfulCommand: async ({ metadata = {}, session = {} } = {}) => {
      const commandSourcePath = sessionSourcePath({
        ...session,
        metadata: {
          ...(session.metadata || {}),
          ...(metadata || {})
        }
      });
      if (
        commandSourcePath &&
        typeof projectService.materializeRuntimeConfig === "function"
      ) {
        await projectService.materializeRuntimeConfig({
          targetRoot: terminalTargetRoot(session, projectService),
          sourcePath: commandSourcePath
        });
      }
      if (!CODEX_AFTER_COMMAND_THREAD_PREP_ENABLED) {
        return;
      }
      if (!commandSourcePath) {
        return;
      }
      const result = await codex.ensureThread(session.sessionId);
      if (result?.ok === false) {
        throw new Error(result.error || "Vibe64 Codex terminal could not be prepared.");
      }
    },
    env,
    logger,
    projectService,
    publishSessionChanged: publishSessionChanged.commandTerminal
  });
  const projectTool = createProjectToolTerminalController({
    env,
    logger,
    projectService
  });
  const shell = createShellTerminalController({
    env,
    logger,
    projectService
  });
  const agentRuntimeControllers = new Map([
    ["codex", codex]
  ]);

  async function publishTerminalSessionChanged(kind = "", sessionId = "", reason = "") {
    const publisher = publishSessionChanged?.[kind];
    if (typeof publisher !== "function" || !String(sessionId || "").trim()) {
      return null;
    }
    return publisher(sessionId, {
      reason
    });
  }

  async function publishProjectRuntimeChanged({
    action = "updated",
    payload = null,
    reason = ""
  } = {}) {
    if (typeof publishProjectChanged !== "function") {
      return null;
    }
    const context = projectRuntimeContext();
    return publishProjectChanged("updated", context.projectSlug, {
      action,
      payload: {
        projectSlug: context.projectSlug,
        ...(context.targetRoot ? {
          projectRoot: context.targetRoot,
          targetRoot: context.targetRoot
        } : {}),
        ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {})
      },
      reason
    });
  }

	  function projectRuntimeContext() {
	    const requestContext = currentProjectRequestContext();
	    const targetRoot = requestContext?.targetRoot ||
	      projectServiceTargetRoot(projectService) ||
	      projectService.targetRoot ||
	      "";
	    const projectRuntimeRoot = requestContext?.projectRuntimeRoot ||
	      requestContext?.projectLocalRoot ||
	      (typeof projectService.currentProjectRuntimeRoot === "function"
	        ? projectService.currentProjectRuntimeRoot()
	        : "") ||
	      (typeof projectService.currentProjectLocalRoot === "function"
	        ? projectService.currentProjectLocalRoot()
	        : "");
	    const projectSlug = String(requestContext?.slug || "").trim() ||
	      String(terminalProjectScopeKey()).replace(/^project:/u, "").trim();
	    return {
	      projectLocalRoot: projectRuntimeRoot,
	      projectRuntimeRoot,
	      projectSlug,
	      targetRoot
	    };
  }

  async function currentProjectRuntimeOpenState() {
    const context = projectRuntimeContext();
    const runtime = await readProjectRuntimeOpenState({
      projectLocalRoot: context.projectLocalRoot
    });
    return {
      context,
      runtime
    };
  }

  let knownCodexThreadReset = null;

  async function resetKnownCodexThreadsOnce() {
    if (typeof codex?.unsubscribeKnownAppServerThreads !== "function") {
      return {
        ok: true,
        skipped: true
      };
    }
    if (!knownCodexThreadReset) {
      knownCodexThreadReset = (async () => {
        const runtime = await projectService.createRuntime();
        const listOptions = {
          statusGroup: "all"
        };
        const sessions = typeof runtime?.listSessionSummaries === "function"
          ? await runtime.listSessionSummaries(listOptions)
          : typeof runtime?.listSessions === "function"
            ? await runtime.listSessions(listOptions)
            : [];
        return codex.unsubscribeKnownAppServerThreads(sessions);
      })();
    }
    return knownCodexThreadReset;
  }

  async function resetKnownCodexThreadsBeforeReconcile() {
    const startedAtMs = Date.now();
    try {
      const result = await resetKnownCodexThreadsOnce();
      vibe64SessionDebugLog("server.terminals.codexAppServerThread.resetKnown.done", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        failedCount: Array.isArray(result?.failed) ? result.failed.length : 0,
        ok: result?.ok !== false,
        sessionCount: Number(result?.sessionCount || 0),
        skipped: result?.skipped === true
      });
      return result;
    } catch (error) {
      knownCodexThreadReset = null;
      vibe64SessionDebugLog("server.terminals.codexAppServerThread.resetKnown.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error)
      });
      return {
        error: error instanceof Error ? error.message : String(error || "Vibe64 Codex app-server thread reset failed."),
        ok: false
      };
    }
  }

  async function sessionForSourceRepair(session = {}) {
    if (terminalWorktreePath(session)) {
      return session;
    }
    const sessionId = sessionRecordId(session);
    if (!sessionId || typeof projectService.createRuntime !== "function") {
      return session;
    }
    const runtime = await projectService.createRuntime({
      input: {
        sessionId
      }
    });
    if (typeof runtime?.getSession !== "function") {
      return session;
    }
    return runtime.getSession(sessionId);
  }

  async function ensureReconciledSessionSourcesSelfContained(sessions = []) {
    const failed = [];
    for (const sessionEntry of Array.isArray(sessions) ? sessions : []) {
      const sessionId = sessionRecordId(sessionEntry);
      try {
        const session = await sessionForSourceRepair(sessionEntry);
        const workdir = terminalWorktreePath(session);
        if (!workdir || !await directoryExists(workdir)) {
          continue;
        }
        const result = await ensureTerminalSessionSourceGitSelfContained({
          session,
          workdir
        });
        if (result.repaired === true) {
          vibe64SessionDebugLog("server.terminals.codexAppServerThread.sourceGit.repaired", {
            sessionId: sessionRecordId(session) || sessionId,
            sourceRoot: result.sourceRoot
          });
        }
      } catch (error) {
        failed.push({
          code: error?.code || "vibe64_session_source_git_repair_failed",
          error: error instanceof Error ? error.message : String(error || "Session source Git repair failed."),
          sessionId
        });
        vibe64SessionDebugLog("server.terminals.codexAppServerThread.sourceGit.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      }
    }
    return failed;
  }

  function reconcileResultWithSourceFailures(result = {}, sourceFailures = []) {
    if (!sourceFailures.length) {
      return result;
    }
    return {
      ...(result || {}),
      failed: [
        ...(Array.isArray(result?.failed) ? result.failed : []),
        ...sourceFailures
      ],
      ok: false
    };
  }

  async function reconcileCodexThreads(sessions = [], options = {}) {
    const sourceFailures = await ensureReconciledSessionSourcesSelfContained(sessions);
    await resetKnownCodexThreadsBeforeReconcile();
    const result = await codex.reconcileThreads(sessions, options);
    return reconcileResultWithSourceFailures(result, sourceFailures);
  }

  async function closeProjectScopedTerminalNamespaces({
    eventPrefix = "server.terminals.closeProjectRuntime",
    projectScope = terminalProjectScopeKey()
  } = {}) {
    const namespaces = projectScopedTerminalNamespaces(projectScope);
    let closed = 0;
    for (const namespace of namespaces) {
      const result = await closeTerminalSessionsForNamespace(namespace);
      closed += Number(result?.closed || 0);
      vibe64SessionDebugLog(`${eventPrefix}.namespace.done`, {
        closed: Number(result?.closed || 0),
        namespace,
        ok: result?.ok !== false,
        projectScope
      });
    }
    return {
      closed,
      namespaceCount: namespaces.length,
      namespaces,
      ok: true,
      projectScope
    };
  }

  function closeAllSessionTerminals(sessionId) {
    return closeTerminalControllersForSession(sessionId, [
      { controller: launchTarget, label: "launchTarget" },
      { controller: codex, label: "codex" },
      { controller: command, label: "command" },
      { controller: shell, label: "shell" }
    ]);
  }

  async function closeProjectRuntimeIfOpenMarkerMissing(eventName = "server.terminals.projectRuntime.markerMissing") {
    const { context, runtime } = await currentProjectRuntimeOpenState();
    if (runtime.open === true) {
      return null;
    }
    const reason = PROJECT_RUNTIME_MARKER_MISSING_REASON;
    vibe64SessionDebugLog(eventName, {
      projectSlug: context.projectSlug,
      reason,
      targetRoot: context.targetRoot
    });
    const closeResult = await service.closeProjectRuntime({
      reason
    });
    return {
      closeResult,
      context,
      reason,
      runtime: closeResult?.runtime || runtime
    };
  }

  function closedProjectLaunchTargetStatus({
    closeResult = null,
    reason = PROJECT_RUNTIME_MARKER_MISSING_REASON,
    runtime = null
  } = {}) {
    return {
      activeTerminal: null,
      closeResult,
      launchTargets: [],
      lastLaunchTarget: null,
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

  async function listOpenProjectRuntimeSessions() {
    const runtime = await projectService.createRuntime();
    const listOptions = {
      statusGroup: "open"
    };
    if (typeof runtime?.listSessions === "function") {
      return runtime.listSessions(listOptions);
    }
    if (typeof runtime?.listSessionSummaries === "function") {
      return runtime.listSessionSummaries(listOptions);
    }
    return [];
  }

  async function closeDormantCurrentProjectRuntime(input = {}) {
    const { context, runtime } = await currentProjectRuntimeOpenState();
    if (runtime.open !== true) {
      return {
        dormant: false,
        ok: true,
        projectSlug: context.projectSlug,
        reason: PROJECT_RUNTIME_MARKER_MISSING_REASON,
        runtime,
        skipped: true,
        targetRoot: context.targetRoot
      };
    }
    const sessions = await listOpenProjectRuntimeSessions();
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
        targetRoot: context.targetRoot
      };
    }
    vibe64SessionDebugLog("server.terminals.projectRuntime.dormantClose.start", {
      idleMs: dormancy.idleMs,
      lastActivityAt: dormancy.lastActivityAt,
      projectSlug: context.projectSlug,
      targetRoot: context.targetRoot
    });
    const closeResult = await service.closeProjectRuntime({
      reason: PROJECT_RUNTIME_IDLE_TIMEOUT_REASON
    });
    return {
      closeResult,
      dormancy,
      dormant: true,
      ok: closeResult?.ok !== false,
      projectSlug: context.projectSlug,
      reason: PROJECT_RUNTIME_IDLE_TIMEOUT_REASON,
      runtime: closeResult?.runtime || runtime,
      skipped: false,
      targetRoot: context.targetRoot
    };
  }

  function projectRecordTargetRoot(project = {}) {
    return String(project?.projectRoot || project?.path || project?.runtime?.targetRoot || "").trim();
  }

	  function projectRequestContextForProjectRecord(project = {}, {
	    projectsRoot = ""
	  } = {}) {
	    const projectRuntimeRoot = String(project?.projectRuntimeRoot || project?.projectLocalRoot || "").trim();
	    return {
	      onlineProjectRecordPath: String(project?.onlineProjectRecordPath || "").trim(),
	      projectLocalRoot: projectRuntimeRoot,
	      projectRuntimeRoot,
	      projectsRoot: String(projectsRoot || project?.projectsRoot || "").trim(),
	      slug: String(project?.slug || project?.name || "").trim(),
	      sourceConfigRoot: String(project?.sourceConfigRoot || "").trim(),
	      sourceRoot: String(project?.sourceRoot || "").trim(),
	      targetRoot: projectRecordTargetRoot(project)
	    };
	  }

  function openProjectRuntimeRecords(listed = {}) {
    const entries = [
      ...(Array.isArray(listed?.projects) ? listed.projects : []),
      listed?.currentProject
    ].filter((project) => project?.runtime?.open === true);
    const seen = new Set();
    return entries.filter((project) => {
      const key = [
        String(project?.slug || project?.name || "").trim(),
        projectRecordTargetRoot(project)
      ].join("\n");
      if (!key.trim() || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async function closeDormantListedProjectRuntime(project = {}, listed = {}, input = {}) {
    const context = projectRequestContextForProjectRecord(project, {
      projectsRoot: listed?.projectsRoot
    });
    if (!context.targetRoot) {
      return {
        error: "Project target root is missing.",
        ok: false,
        projectSlug: context.slug,
        reason: "missing-target-root",
        skipped: true
      };
    }
    return runWithProjectRequestContext(context, () => closeDormantCurrentProjectRuntime(input));
  }

	const service = {
    async openProjectRuntime(input = {}) {
      const context = projectRuntimeContext();
      const reason = String(input?.reason || "project-open").trim() || "project-open";
      const runtime = await writeProjectRuntimeOpenState({
        projectLocalRoot: context.projectLocalRoot,
        projectSlug: context.projectSlug,
        reason,
        targetRoot: context.targetRoot
      });
      await publishProjectRuntimeChanged({
        action: "runtime-opened",
        payload: {
          runtime
        },
        reason
      });
      return {
        ok: true,
        runtime,
        targetRoot: context.targetRoot
      };
    },

    closeDormantProjectRuntime(input = {}) {
      return closeDormantCurrentProjectRuntime(input);
    },

    async closeDormantProjectRuntimes(input = {}) {
      if (typeof projectService.listProjects !== "function") {
        const result = await closeDormantCurrentProjectRuntime(input);
        return {
          closedCount: result.dormant ? 1 : 0,
          failed: result.ok === false ? [result] : [],
          ok: result.ok !== false,
          projectCount: 1,
          results: [result]
        };
      }
      const listed = await projectService.listProjects();
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
      const results = [];
      for (const project of projects) {
        try {
          results.push(await closeDormantListedProjectRuntime(project, listed, input));
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
            ok: false,
            projectSlug: String(project?.slug || project?.name || "").trim(),
            targetRoot: projectRecordTargetRoot(project)
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
    },

    async closeSessionTerminals(sessionId) {
      return closeAllSessionTerminals(sessionId);
    },

    async closeSessionNonCodexTerminals(sessionId) {
      return closeTerminalControllersForSession(sessionId, [
        { controller: launchTarget, label: "launchTarget" },
        { controller: command, label: "command" },
        { controller: shell, label: "shell" }
      ], {
        eventPrefix: "server.terminals.closeSessionNonCodexTerminals"
      });
    },

    async recordSessionGitCommandActor(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      if (!normalizedSessionId) {
        return {
          ok: false,
          error: "Session id is required to record the Git command actor."
        };
      }
      const runtime = await projectService.createRuntime({
        input: {
          sessionId: normalizedSessionId
        }
      });
      const session = await runtime.getSession(normalizedSessionId);
      const targetRoot = terminalTargetRoot(session, projectService);
      if (!targetRoot) {
        return {
          code: "vibe64_session_git_command_actor_target_root_missing",
          error: "Vibe64 session target root is not available for Git command actor tracking.",
          ok: false
        };
      }
      const workdir = terminalWorktreePath(session) || targetRoot;
      return writeSessionGitCommandActor({
        env,
        reason: input.reason || "session-interaction",
        runtime,
        session,
        targetRoot,
        threadId: session.metadata?.codex_thread_id || session.metadata?.agent_identity_conversation_id || "",
        vibe64User: input.vibe64User || null,
        workdir
      });
    },

    async closeProjectRuntime(input = {}) {
      const startedAtMs = Date.now();
      const context = projectRuntimeContext();
      const projectScope = context.projectSlug ? `project:${context.projectSlug}` : terminalProjectScopeKey();
      const targetRoot = context.targetRoot;
      const reason = String(input?.reason || "project-close").trim() || "project-close";
      const failed = [];
      let codexAppServerStopped = 0;
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
        let sessionIds = [];
        try {
          const runtime = await projectService.createRuntime();
          const sessions = await runtime.listSessionSummaries({
            archive: ""
          });
          sessionIds = (Array.isArray(sessions) ? sessions : [])
            .map((session) => String(session?.sessionId || session?.id || "").trim())
            .filter(Boolean);
          sessionCount = sessionIds.length;
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
        for (const sessionId of sessionIds) {
          try {
            const result = await closeAllSessionTerminals(sessionId);
            sessionTerminalClosed += Number(result?.closed || 0);
          } catch (error) {
            failed.push({
              error: error instanceof Error ? error.message : String(error || "Session runtime close failed."),
              sessionId
            });
          }
        }

        if (typeof codex.closeAllForProject === "function") {
          const codexResult = await codex.closeAllForProject({
            reason,
            targetRoot
          });
          codexAppServerStopped = Number(codexResult?.stopped || 0);
          for (const error of Array.isArray(codexResult?.failed) ? codexResult.failed : []) {
            failed.push({
              ...error,
              controller: "codex-app-server"
            });
          }
        }

        const namespaceResult = await closeProjectScopedTerminalNamespaces({
          projectScope
        });
        projectNamespaceCount = Number(namespaceResult.namespaceCount || 0);
        projectTerminalClosed = Number(namespaceResult.closed || 0);
        const cwdResult = await closeTerminalSessionsForCwdRoot(
          targetRoot
        );
        projectCwdTerminalClosed = Number(cwdResult.closed || 0);
        projectCwdNamespaceCount = Number(cwdResult.namespaceCount || 0);
        const result = {
          codexAppServerStopped,
          failed,
          ok: failed.length === 0,
          projectCwdNamespaceCount,
          projectCwdTerminalClosed,
          projectNamespaceCount,
          projectScope,
          projectTerminalClosed,
          reason,
          sessionCount,
          sessionTerminalClosed,
          targetRoot
        };
        if (result.ok === true) {
          const runtime = await clearProjectRuntimeOpenState({
            projectLocalRoot: context.projectLocalRoot
          });
          result.runtime = runtime;
          await publishProjectRuntimeChanged({
            action: "runtime-closed",
            payload: {
              message: "Project is closed.",
              runtime
            },
            reason
          });
        }
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
    },

    async closeCodexTerminal(sessionId, terminalSessionId) {
      const result = await codex.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("codexTerminalClosed", sessionId, "codex-terminal-closed");
      return result;
    },

    closeGlobalCodexTerminal(terminalSessionId) {
      return codex.closeGlobalTerminal(terminalSessionId);
    },

    closeFixCodexTerminal(jobId, terminalSessionId) {
      return codex.closeFixTerminal(jobId, terminalSessionId);
    },

    async closeCommandTerminal(sessionId, terminalSessionId, input = {}) {
      const result = await command.closeTerminal(sessionId, terminalSessionId, input);
      await publishTerminalSessionChanged("commandTerminalClosed", sessionId, "command-terminal-closed");
      return result;
    },

    closeProjectToolTerminal(toolId, terminalSessionId, input = {}) {
      return projectTool.closeTerminal(toolId, terminalSessionId, input);
    },

    async closeLaunchTargetTerminal(sessionId, terminalSessionId) {
      const result = await launchTarget.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("launchTargetClosed", sessionId, "launch-target-closed");
      return result;
    },

    async closeShellTerminal(sessionId, terminalSessionId, input = {}) {
      const result = await shell.closeTerminal(sessionId, terminalSessionId, input);
      await publishTerminalSessionChanged("shellTerminalClosed", sessionId, "shell-terminal-closed");
      return result;
    },

    injectCodexPrompt(sessionId, handoff = {}, options = {}) {
      return codex.injectCodexPrompt(sessionId, handoff, options);
    },

    interruptCodexTurn(sessionId, input = {}) {
      return codex.interruptTurn(sessionId, input);
    },

    steerCodexTurn(sessionId, input = {}) {
      return codex.steerTurn(sessionId, input);
    },

    injectGlobalCodexPrompt(handoff = {}) {
      return codex.injectGlobalCodexPrompt(handoff);
    },

    ensureCodexThread(sessionId) {
      return codex.ensureThread(sessionId);
    },

    invalidateAgentRuntimes(input = {}) {
      const provider = normalizeAgentProviderId(input.provider);
      const controller = agentRuntimeControllers.get(provider);
      if (typeof controller?.invalidateAppServerRuntimes !== "function") {
        return {
          code: "unknown_agent_provider",
          error: `Unknown agent provider: ${provider || "(missing)"}`,
          ok: false,
          provider
        };
      }
      return controller.invalidateAppServerRuntimes(input);
    },

    reconcileCodexThreads,

    async reconcileOpenCodexThreads(options = {}) {
      const closedRuntime = await closeProjectRuntimeIfOpenMarkerMissing(
        "server.terminals.reconcileOpenCodexThreads.closedProject"
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
      const runtime = await projectService.createRuntime();
      const sessions = await runtime.listSessionSummaries({
        archive: ""
      });
      const openSessions = sessions.filter((session) => String(session.status || "") === "active");
      return reconcileCodexThreads(openSessions, options);
    },

    codexTerminalState(sessionId) {
      return codex.terminalState(sessionId);
    },

    globalCodexTerminalState() {
      return codex.globalTerminalState();
    },

    readGlobalCodexTerminal(terminalSessionId) {
      return codex.readGlobalTerminal(terminalSessionId);
    },

    readFixCodexTerminal(jobId, terminalSessionId) {
      return codex.readFixTerminal(jobId, terminalSessionId);
    },

    readCodexTerminal(sessionId, terminalSessionId) {
      return codex.readTerminal(sessionId, terminalSessionId);
    },

    readCommandTerminal(sessionId, terminalSessionId, input = {}) {
      return command.readTerminal(sessionId, terminalSessionId, input);
    },

    readProjectToolTerminal(toolId, terminalSessionId, input = {}) {
      return projectTool.readTerminal(toolId, terminalSessionId, input);
    },

    readLaunchTargetTerminal(sessionId, terminalSessionId) {
      return launchTarget.readTerminal(sessionId, terminalSessionId);
    },

    readShellTerminal(sessionId, terminalSessionId, input = {}) {
      return shell.readTerminal(sessionId, terminalSessionId, input);
    },

    async launchTargetStatus(sessionId, options = {}) {
      const closedRuntime = await closeProjectRuntimeIfOpenMarkerMissing(
        "server.terminals.launchTargetStatus.closedProject"
      );
      if (closedRuntime) {
        return closedProjectLaunchTargetStatus(closedRuntime);
      }
      return launchTarget.launchStatus(sessionId, options);
    },

    openLaunchTarget(sessionId) {
      return launchTarget.openLaunchTarget(sessionId);
    },

    startCodexTerminal(sessionId, input = {}) {
      return codex.startTerminal(sessionId, input);
    },

    startGlobalCodexTerminal() {
      return codex.startGlobalTerminal();
    },

    async startProjectToolFixJob(toolId, input = {}) {
      const targetRoot = terminalTargetRoot({}, projectService);
      return codex.startFixJob({
        prompt: projectToolFailureFixPrompt({
          ...input,
          targetRoot,
          toolId: input.toolId || toolId,
          toolLabel: input.toolLabel || input.actionLabel
        }),
        scope: "project",
        subject: input.toolLabel || input.actionLabel || toolId,
        targetRoot
      });
    },

    async startSessionTerminalFixJob(sessionId, input = {}) {
      const runtime = await projectService.createRuntime({
        input: {
          sessionId
        }
      });
      const session = await runtime.getSession(sessionId);
      const targetRoot = terminalTargetRoot(session, projectService);
      const worktreePath = terminalWorktreePath(session);
      return codex.startFixJob({
        prompt: sessionTerminalFailureFixPrompt({
          ...input,
          currentStep: input.currentStep || session.currentStep || "",
          sessionId: input.sessionId || sessionId,
          stepStatus: input.stepStatus || session.stepMachine?.status || "",
          targetRoot,
          worktreePath
        }),
        scope: "session",
        sessionRoot: session.sessionRoot || "",
        subject: input.actionLabel || input.launchTargetLabel || input.actionId || input.launchTargetId || sessionId,
        targetRoot,
        workdir: worktreePath || targetRoot
      });
    },

    reportFixCodexJob(jobId, input = {}) {
      return codex.reportFixJob(jobId, input);
    },

    startCommandTerminal(sessionId, input = {}) {
      return command.startTerminal(sessionId, input);
    },

    async runProjectTool(toolId, input = {}) {
      const run = await projectService.prepareProjectToolRun(toolId, input);
      if (run?.ok === false) {
        return run;
      }
      if (run.type === "prompt") {
        return codex.injectGlobalCodexPrompt({
          prompt: run.prompt
        });
      }
      return projectTool.startPreparedRun(toolId, run, input);
    },

    startLaunchTargetTerminal(sessionId, input = {}) {
      return launchTarget.startTerminal(sessionId, input);
    },

    async stopLaunchTargetTerminal(sessionId, terminalSessionId) {
      const result = await launchTarget.stopTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("launchTargetStopped", sessionId, "launch-target-stopped");
      return result;
    },

    startShellTerminal(sessionId, input = {}) {
      return shell.startTerminal(sessionId, input);
    },

    listShellTerminals(sessionId) {
      return shell.listTerminals(sessionId);
    },

    subscribeCodexTerminal(sessionId, terminalSessionId, subscriber) {
      return codex.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    subscribeGlobalCodexTerminal(terminalSessionId, subscriber) {
      return codex.subscribeGlobalTerminal(terminalSessionId, subscriber);
    },

    subscribeFixCodexTerminal(jobId, terminalSessionId, subscriber) {
      return codex.subscribeFixTerminal(jobId, terminalSessionId, subscriber);
    },

    subscribeCommandTerminal(sessionId, terminalSessionId, subscriber, input = {}) {
      return command.subscribeTerminal(sessionId, terminalSessionId, subscriber, input);
    },

    subscribeProjectToolTerminal(toolId, terminalSessionId, subscriber, input = {}) {
      return projectTool.subscribeTerminal(toolId, terminalSessionId, subscriber, input);
    },

    subscribeLaunchTargetTerminal(sessionId, terminalSessionId, subscriber) {
      return launchTarget.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    subscribeShellTerminal(sessionId, terminalSessionId, subscriber, input = {}) {
      return shell.subscribeTerminal(sessionId, terminalSessionId, subscriber, input);
    },

    uploadCodexAttachment(sessionId, input = {}) {
      return codex.uploadAttachment(sessionId, input);
    },

    writeCodexTerminal(sessionId, terminalSessionId, data, input = {}) {
      return codex.writeTerminal(sessionId, terminalSessionId, data, input);
    },

    writeGlobalCodexTerminal(terminalSessionId, data) {
      return codex.writeGlobalTerminal(terminalSessionId, data);
    },

    writeFixCodexTerminal(jobId, terminalSessionId, data) {
      return codex.writeFixTerminal(jobId, terminalSessionId, data);
    },

    resizeCodexTerminal(sessionId, terminalSessionId, size) {
      return codex.resizeTerminal(sessionId, terminalSessionId, size);
    },

    resizeGlobalCodexTerminal(terminalSessionId, size) {
      return codex.resizeGlobalTerminal(terminalSessionId, size);
    },

    resizeFixCodexTerminal(jobId, terminalSessionId, size) {
      return codex.resizeFixTerminal(jobId, terminalSessionId, size);
    },

    writeCommandTerminal(sessionId, terminalSessionId, data, input = {}) {
      return command.writeTerminal(sessionId, terminalSessionId, data, input);
    },

    writeProjectToolTerminal(toolId, terminalSessionId, data, input = {}) {
      return projectTool.writeTerminal(toolId, terminalSessionId, data, input);
    },

    resizeCommandTerminal(sessionId, terminalSessionId, size, input = {}) {
      return command.resizeTerminal(sessionId, terminalSessionId, size, input);
    },

    resizeProjectToolTerminal(toolId, terminalSessionId, size, input = {}) {
      return projectTool.resizeTerminal(toolId, terminalSessionId, size, input);
    },

    writeLaunchTargetTerminal(sessionId, terminalSessionId, data) {
      return launchTarget.writeTerminal(sessionId, terminalSessionId, data);
    },

    resizeLaunchTargetTerminal(sessionId, terminalSessionId, size) {
      return launchTarget.resizeTerminal(sessionId, terminalSessionId, size);
    },

    writeShellTerminal(sessionId, terminalSessionId, data, input = {}) {
      return shell.writeTerminal(sessionId, terminalSessionId, data, input);
    },

    resizeShellTerminal(sessionId, terminalSessionId, size, input = {}) {
      return shell.resizeTerminal(sessionId, terminalSessionId, size, input);
    }
  };

  return Object.freeze(service);
}

function startProjectRuntimeDormancyCleanupSchedule({
  clearIntervalImpl = clearInterval,
  idleAfterMs = PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS,
  intervalMs = PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS,
  logger = null,
  serviceFactory = null,
  setIntervalImpl = setInterval
} = {}) {
  if (typeof serviceFactory !== "function") {
    throw new TypeError("startProjectRuntimeDormancyCleanupSchedule requires serviceFactory().");
  }
  const normalizedIdleAfterMs = normalizePositiveDurationMs(idleAfterMs, PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS);
  const normalizedIntervalMs = normalizePositiveDurationMs(intervalMs, PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS);
  let running = false;
  let stopped = false;

  async function runNow() {
    if (running || stopped) {
      return null;
    }
    running = true;
    try {
      const service = serviceFactory();
      if (typeof service?.closeDormantProjectRuntimes !== "function") {
        return null;
      }
      const result = await service.closeDormantProjectRuntimes({
        idleAfterMs: normalizedIdleAfterMs
      });
      vibe64SessionDebugLog("server.terminals.projectRuntime.dormantCleanup.done", {
        closedCount: Number(result?.closedCount || 0),
        failedCount: Array.isArray(result?.failed) ? result.failed.length : 0,
        idleAfterMs: normalizedIdleAfterMs,
        ok: result?.ok !== false,
        projectCount: Number(result?.projectCount || 0)
      });
      return result;
    } catch (error) {
      logger?.warn?.({
        component: "vibe64-project-runtime-cleanup",
        error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
        event: "vibe64.project_runtime.dormant_cleanup_failed"
      }, "Scheduled dormant Vibe64 project runtime cleanup failed.");
      vibe64SessionDebugLog("server.terminals.projectRuntime.dormantCleanup.error", {
        error: vibe64SessionDebugError(error),
        idleAfterMs: normalizedIdleAfterMs
      });
      return {
        error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
        ok: false
      };
    } finally {
      running = false;
    }
  }

  const interval = setIntervalImpl(() => {
    void runNow();
  }, normalizedIntervalMs);
  interval?.unref?.();

  return {
    idleAfterMs: normalizedIdleAfterMs,
    intervalMs: normalizedIntervalMs,
    runNow,
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearIntervalImpl(interval);
    }
  };
}

export {
  createService,
  projectRuntimeDormancyState,
  startProjectRuntimeDormancyCleanupSchedule,
  terminalNamespaceMatchesProjectScope
};
