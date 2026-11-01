import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "@local/vibe64-core/server/previewAuth";
import { vibe64StatusCode } from "@local/vibe64-core/server/serverResponses";
import {
  readSessionUiSyncStateForSession
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  agentPlaywrightCommandSource,
  agentPreviewBrowserWorkerSource,
  agentPreviewWrapperSource,
  runVibe64Command,
  runtimePackBinPaths,
  runtimePackRoot,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  vibe64ManagedExecutionProvider
} from "@local/vibe64-execution/server";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import { createSessionCommandServers, unixCommandSocketPath } from "./unixJsonCommand.js";
import { trimmedText as normalizeText } from "./trimmedText.js";
import { isRecord } from "./isRecord.js";
import { createAgentPreviewCommandState } from "./agentPreviewCommandState.js";
import { createAgentPreviewWorkerRegistry } from "./agentPreviewWorkerRegistry.js";
import { createAgentPreviewBrowserTests } from "./agentPreviewBrowserTests.js";
import { createAgentPreviewCommandLine } from "./agentPreviewCommandLine.js";
import {
  responseError,
  streamPlaywrightRun
} from "./agentPreviewBrowserWorker.js";

/** @typedef {import("./types.js").OutputTargetTerminalController} OutputTargetTerminalController */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */

const AGENT_PREVIEW_COMMAND_NAME = "vibe64-preview";
const AGENT_PLAYWRIGHT_COMMAND_NAME = "vibe64-playwright";
const AGENT_PREVIEW_BROWSER_WORKER_NAME = "vibe64-preview-browser-worker";
const AGENT_PREVIEW_BROWSER_SOCKET_NAME = "preview-browser.sock";
const AGENT_PREVIEW_BROWSER_METADATA_NAME = "preview-browser.json";
const AGENT_PREVIEW_COMMAND_SOCKET_NAME = "preview-command.sock";
const AGENT_PREVIEW_COMMAND_CONTRACT_VERSION = "11";
const AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;
const DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PREVIEW_BROWSER_SUSPEND_AFTER_MS = 30 * 1000;
const VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID";
const VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SOCKET";
const VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_TOKEN";
const VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_GENERATION";
const VIBE64_PREVIEW_BROWSER_WORKER_TOKEN_ENV = "VIBE64_PREVIEW_BROWSER_WORKER_TOKEN";

const commandServers = createSessionCommandServers({
  routePrefix: "/agent-preview-command",
  routes: {
    "/agent-preview-command/identity": {
      handle: ({ commandService, input, sessionId }) => commandService.authorizeBrowserIdentity(sessionId, input.identity),
      status: vibe64StatusCode
    },
    "/agent-preview-command/playwright-status": {
      handle: ({ commandService, sessionId }) => commandService.playwrightStatus(sessionId)
    },
    "/agent-preview-command/playwright-cancel": {
      handle: ({ commandService, input, sessionId }) => commandService.cancelPlaywrightRun(sessionId, normalizeText(input.runId)),
      status: vibe64StatusCode
    },
    "/agent-preview-command/browser-start": {
      handle: ({ commandService, input, sessionId }) => commandService.browserStart(sessionId, input),
      status: vibe64StatusCode
    },
    "/agent-preview-command/browser-stop": {
      handle: ({ commandService, input, sessionId }) => commandService.browserStop(sessionId, input),
      status: vibe64StatusCode
    },
    "/agent-preview-command/playwright-run": { handle: streamPlaywrightRun },
    "/agent-preview-command/run": { handle: ({ commandService, input }) => commandService.run(input) }
  },
  label: "preview",
  maxBytes: AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES,
  invalidJsonError: { code: "vibe64_agent_preview_command_invalid_json", message: "Vibe64 preview command input must be valid JSON." },
  tooLargeError: { code: "vibe64_agent_preview_command_input_too_large", message: "Vibe64 preview command input is too large." },
  notFound: responseError("Unknown Vibe64 preview command route.", "vibe64_agent_preview_command_route_not_found"),
  rejection: {
    statusCode: 409,
    payload: responseError("Managed preview control generation is no longer current. Reconnect the assistant.", "vibe64_agent_control_unavailable")
  },
  requestFailure: {
    fallbackCode: "vibe64_agent_preview_command_request_failed",
    fallbackMessage: "Vibe64 preview command request failed."
  }
});

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_COMMAND_NAME);
}

function agentPlaywrightHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PLAYWRIGHT_COMMAND_NAME);
}

function browserWorkerHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_WORKER_NAME);
}

function browserMetadataHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_METADATA_NAME);
}

async function writeWrapper({
  agentPlaywrightSource = "",
  browserWorkerSource = "",
  previewWrapperSource = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!normalizedWrapperHostDir) {
    return false;
  }
  await mkdir(normalizedWrapperHostDir, {
    recursive: true
  });
  await Promise.all([
    writeExecutableFileIfChanged(
      wrapperHostPath(normalizedWrapperHostDir),
      previewWrapperSource
    ),
    writeExecutableFileIfChanged(
      browserWorkerHostPath(normalizedWrapperHostDir),
      browserWorkerSource
    ),
    writeExecutableFileIfChanged(
      agentPlaywrightHostPath(normalizedWrapperHostDir),
      agentPlaywrightSource
    )
  ]);
  return true;
}

/**
 * The `vibe64-preview` command service. Its state, browser worker registry,
 * browser tests and command line are each built once, and the service offers
 * their functions by name.
 * @param {object} dependencies
 * @param {OutputTargetTerminalController} dependencies.launchTarget
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.projectService
 * @param {typeof readSessionUiSyncStateForSession} [dependencies.readSessionUiState]
 * @param {typeof runVibe64Command} [dependencies.runManagedCommand]
 * @param {typeof stopVibe64Execution} [dependencies.stopManagedExecution]
 * @param {typeof stopVibe64OwnedExecutions} [dependencies.stopOwnedExecutions]
 * @param {typeof vibe64ManagedExecutionProvider} [dependencies.resourceProvider]
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 */
function createAgentPreviewCommandService({
  launchTarget,
  logger,
  projectService,
  readSessionUiState = readSessionUiSyncStateForSession,
  runManagedCommand = runVibe64Command,
  stopManagedExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions,
  resourceProvider = vibe64ManagedExecutionProvider,
  publishSessionChanged
}) {
  const state = createAgentPreviewCommandState();
  const workerRegistry = createAgentPreviewWorkerRegistry({
    state,
    commandServers,
    projectService,
    runManagedCommand,
    stopManagedExecution,
    stopOwnedExecutions
  });
  const browserTests = createAgentPreviewBrowserTests({
    state,
    workerRegistry,
    launchTarget,
    publishSessionChanged,
    resourceProvider,
    stopManagedExecution
  });
  const commandLine = createAgentPreviewCommandLine({
    workerRegistry,
    launchTarget,
    logger,
    projectService,
    readSessionUiState
  });

  return Object.freeze({
    logger,
    authorizeBrowserIdentity: commandLine.authorizeBrowserIdentity,
    testApprovalStatus: browserTests.testApprovalStatus,
    resumeTestApproval: browserTests.resumeTestApproval,
    cancelTestApproval: browserTests.cancelTestApproval,
    browserStart: workerRegistry.browserStart,
    browserStop: workerRegistry.browserStop,
    stopBrowsersForSession: workerRegistry.stopBrowsersForSession,
    closeAllForSession: workerRegistry.closeAllForSession,
    playwrightStatus: browserTests.playwrightStatus,
    cancelPlaywrightRun: browserTests.cancelPlaywrightRun,
    playwrightRun: browserTests.playwrightRun,
    registerBrowserWorker: workerRegistry.registerBrowserWorker,
    releaseControlForSession: workerRegistry.releaseControlForSession,
    run: commandLine.run
  });
}

function browserWorkerToken({
  commandToken = "",
  generationId = "",
  sessionId = ""
} = {}) {
  return crypto
    .createHash("sha256")
    .update([
      "vibe64-preview-browser",
      normalizeText(sessionId),
      normalizeText(generationId),
      normalizeText(commandToken)
    ].join("\n"))
    .digest("hex");
}

/**
 * @param {object} options
 * @param {number} [options.browserIdleTimeoutMs]
 * @param {number} [options.browserSuspendAfterMs]
 * @param {number} [options.browserControlHealthFailureLimit]
 * @param {number} [options.browserControlHealthIntervalMs]
 * @param {ReturnType<typeof createAgentPreviewCommandService>} options.commandService
 * @param {RuntimeEnv} [options.env]
 * @param {object} [options.project]
 * @param {string} [options.sessionId]
 * @param {string} [options.worktreePath]
 * @param {string} [options.wrapperHostDir]
 */
async function prepareAgentPreviewCommand({
  browserIdleTimeoutMs = DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS,
  browserSuspendAfterMs = DEFAULT_PREVIEW_BROWSER_SUSPEND_AFTER_MS,
  browserControlHealthFailureLimit = 4,
  browserControlHealthIntervalMs = 15_000,
  commandService,
  env = process.env,
  project = {},
  sessionId = "",
  worktreePath = "",
  wrapperHostDir = ""
}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!normalizedSessionId || !normalizedWrapperHostDir) {
    return {
      env: {},
      ok: false
    };
  }
  const packRoot = runtimePackRoot();
  // Without runtime packs, the browser runs on this server's Node.js and the
  // project's own Playwright.
  const [nodeBinDir] = packRoot
    ? runtimePackBinPaths("node26")
    : [path.dirname(process.execPath)];
  const managedNodePath = packRoot ? path.join(nodeBinDir, "node") : process.execPath;
  const managedNpmPath = path.join(nodeBinDir, "npm");
  const normalizedWorktreePath = path.resolve(normalizeText(worktreePath) || process.cwd());
  const workerScriptPath = browserWorkerHostPath(normalizedWrapperHostDir);
  const playwrightModulePath = packRoot
    ? path.join(packRoot, "playwright", "runtime", "lib", "node_modules", "playwright")
    : "";
  const browserSocketPath = unixCommandSocketPath(
    path.join(normalizedWrapperHostDir, AGENT_PREVIEW_BROWSER_SOCKET_NAME), { env }
  );
  const controlSocketPath = unixCommandSocketPath(
    path.join(normalizedWrapperHostDir, AGENT_PREVIEW_COMMAND_SOCKET_NAME), { env }
  );
  await writeWrapper({
    agentPlaywrightSource: agentPlaywrightCommandSource({
      managedNodePath,
      managedPreviewPath: wrapperHostPath(normalizedWrapperHostDir),
      runtimeRoot: packRoot
    }),
    browserWorkerSource: agentPreviewBrowserWorkerSource({
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      controlHealthFailureLimit: browserControlHealthFailureLimit,
      controlHealthIntervalMs: browserControlHealthIntervalMs,
      identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
      idleTimeoutMs: browserIdleTimeoutMs,
      playwrightModulePath,
      playwrightProjectRoot: normalizedWorktreePath,
      suspendAfterMs: browserSuspendAfterMs
    }),
    previewWrapperSource: agentPreviewWrapperSource({
      browserSocketPath,
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      managedNodePath,
      workerScriptPath
    }),
    wrapperHostDir: normalizedWrapperHostDir
  });
  const server = await commandServers.ensure({
    commandService,
    sessionId: normalizedSessionId,
    socketPath: controlSocketPath
  });
  const token = browserWorkerToken({
    commandToken: server.token,
    generationId: server.generationId,
    sessionId: normalizedSessionId
  });
  const workerDescriptor = {
    contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
    controlGenerationId: server.generationId,
    controlSocketPath,
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: controlSocketPath,
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token,
      [VIBE64_PREVIEW_BROWSER_WORKER_TOKEN_ENV]: token
    },
    managedNodePath,
    managedNpmPath,
    playwrightWrapperPath: agentPlaywrightHostPath(normalizedWrapperHostDir),
    metadataPath: browserMetadataHostPath(normalizedWrapperHostDir),
    project: isRecord(project) ? project : {},
    runtimeRoot: packRoot,
    socketPath: browserSocketPath,
    token,
    workerScriptPath,
    worktreePath: normalizedWorktreePath
  };
  commandService.registerBrowserWorker(normalizedSessionId, workerDescriptor);
  return {
    controlGenerationId: server.generationId,
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: controlSocketPath,
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token
    },
    hostBrowserMetadataPath: workerDescriptor.metadataPath,
    hostBrowserSocketPath: workerDescriptor.socketPath,
    hostBrowserWorkerPath: workerScriptPath,
    hostPlaywrightWrapperPath: agentPlaywrightHostPath(normalizedWrapperHostDir),
    hostSocketPath: controlSocketPath,
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_PLAYWRIGHT_COMMAND_NAME,
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
};
