import { captureProjectRequestContext, currentProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rm
} from "node:fs/promises";
import path from "node:path";
import { manageWorkPlan } from "./assistantWorkPlan.js";
import { planCommandSource } from "./agentPlanCommand.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { WORKSPACE_SETUP_METADATA_NAME, workspaceSetupStateFromMetadata } from "@local/vibe64-runtime/server/workspaceSetupState";

import {
  normalizeText,
  pathInsideOrEqual,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  runVibe64Command,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";
import {
  genesisParserEnvironment,
  genesisProjectContractNeedsAttention,
  inspectVibe64WorkspaceSetup,
  withGenesisCommandShim
} from "@local/vibe64-genesis/server";
import { createAgentCommandProjectBinding } from "./agentCommandProjectBinding.js";
import {
  createSessionCommandServers,
  shortCommandHash,
  unixCommandSocketPath
} from "./unixJsonCommand.js";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";

const AGENT_SESSION_COMMAND_NAME = "vibe64-session-command";
const AGENT_SESSION_COMMAND_RUNNER_NAME = "vibe64-session-command-runner";
const AGENT_SESSION_COMMAND_SOCKET_NAME = "session-command.sock";
const AGENT_SESSION_COMMAND_RUNS_DIR_NAME = "session-command-runs";
const AGENT_SESSION_COMMAND_CONTRACT_VERSION = "1";
const AGENT_SESSION_COMMAND_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
const AGENT_SESSION_COMMAND_OUTPUT_MAX_BYTES = 20 * 1024 * 1024;
const AGENT_SESSION_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const AGENT_SESSION_COMMAND_POLL_MS = 25;
const VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV = "VIBE64_AGENT_SESSION_COMMAND_GENERATION";
const VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_SESSION_COMMAND_SESSION_ID";
const VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV = "VIBE64_AGENT_SESSION_COMMAND_SOCKET";
const VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV = "VIBE64_AGENT_SESSION_COMMAND_TOKEN";
const VIBE64_WRAPPER_ENV = "VIBE64_WRAPPER";
const VIBE64_AGENT_SESSION_RUN_COMMAND_ENV = "VIBE64_AGENT_SESSION_RUN_COMMAND_BASE64";
const VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV = "VIBE64_AGENT_SESSION_RUN_OUTPUT_PATH";
const VIBE64_AGENT_SESSION_RUN_RESULT_ENV = "VIBE64_AGENT_SESSION_RUN_RESULT_PATH";
// This capability permits session status, rename, project messages and role-checked plan commands. It
// does not expose the shell-execution token stripped from managed child commands.
const SESSION_RENAME_CONTROL_ENV = "VIBE64_SESSION_RENAME_CONTROL";

const AGENT_SESSION_CONTROL_ENV_NAMES = new Set([
  VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV,
  VIBE64_WRAPPER_ENV,
  "VIBE64_EXECUTION_ID"
]);
const AGENT_SESSION_DESKTOP_BUS_ENV_NAMES = new Set([
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_STARTER_ADDRESS",
  "DBUS_STARTER_BUS_TYPE"
]);

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_NAME);
}

function runnerHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_RUNNER_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return unixCommandSocketPath(path.join(wrapperHostDir, AGENT_SESSION_COMMAND_SOCKET_NAME));
}

function commandRunsHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_RUNS_DIR_NAME);
}

function responseError(message = "", code = "vibe64_agent_session_command_failed", extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    exitCode: Number.isInteger(extra.exitCode) ? extra.exitCode : 1,
    ok: false,
    stderr: extra.stderr || `${message}\n`
  };
}

function commandWrapperSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const expectedName = ${JSON.stringify(AGENT_SESSION_COMMAND_NAME)};
const expectedVersion = ${JSON.stringify(AGENT_SESSION_COMMAND_CONTRACT_VERSION)};
const socketPath = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV} || "").trim();
const sessionId = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV} || "").trim();
const token = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV} || "").trim();
const generationId = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV} || "").trim();
const version = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV} || "").trim();
const command = String(process.argv[2] || "");

function fail(message, code = 1) {
  process.stderr.write(String(message || "Vibe64 session command failed.") + "\\n");
  process.exit(code);
}

function requestSocket(body) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/agent-session-command/run",
      socketPath,
      timeout: ${AGENT_SESSION_COMMAND_TIMEOUT_MS + 30_000}
    }, (response) => {
      let responseText = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseText += chunk; });
      response.once("end", () => resolve(responseText));
    });
    request.once("error", reject);
    request.once("timeout", () => {
      const error = new Error("Vibe64 session command timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.end(requestBody);
  });
}

if (path.basename(process.argv[1] || "") !== expectedName) fail("Unsupported Vibe64 session command wrapper.");
if (!socketPath || !sessionId || !token || !generationId) fail("vibe64_agent_control_unavailable: Session command control is unavailable. Reconnect the assistant.");
if (version !== expectedVersion) fail("vibe64_agent_control_unavailable: Session command control is outdated. Reconnect the assistant.");
if (!command || process.argv.length !== 3) fail("Vibe64 session command input is invalid.", 2);

const responseText = await requestSocket({
  commandBase64: Buffer.from(command, "utf8").toString("base64url"),
  cwd: process.cwd(),
  env: process.env,
  generationId,
  sessionId,
  token
}).catch((error) => fail(error?.message || error));

let payload;
try {
  payload = JSON.parse(responseText || "{}");
} catch {
  fail("Vibe64 session command returned invalid JSON.");
}
if (payload.stdout) process.stdout.write(String(payload.stdout));
if (payload.stderr) process.stderr.write(String(payload.stderr));
else if (payload.ok === false && payload.error) process.stderr.write(String(payload.error) + "\\n");
process.exit(Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0));
`;
}

function sessionRenameCommandSource() {
  return `#!/usr/bin/env node
import http from "node:http";

const args = process.argv.slice(2);
const usage = 'Usage: vibe64-helper session status [--json] | rename "Name" | message-project <project> [--session <session-id>] <message> [message-id] | project-preview <project> [--session <session-id>]';
if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(usage);
  process.exit(0);
}
const status = args[0] === "status" && (args.length === 1 || args.length === 2 && args[1] === "--json");
const explicitSession = ["message-project", "project-preview"].includes(args[0]) && args[2] === "--session";
const messageIndex = explicitSession ? 4 : 2;
const messageProject = args[0] === "message-project" &&
  [messageIndex + 1, messageIndex + 2].includes(args.length) &&
  args[1]?.trim() && args[messageIndex]?.trim() && (!explicitSession || args[3]?.trim());
const projectPreview = args[0] === "project-preview" && args.length === (explicitSession ? 4 : 2) &&
  args[1]?.trim() && (!explicitSession || args[3]?.trim());
if (!status && !messageProject && !projectPreview && (args[0] !== "rename" || args.length !== 2 || !args[1].trim())) {
  console.error(usage);
  process.exit(2);
}
try {
  const control = JSON.parse(process.env.${SESSION_RENAME_CONTROL_ENV} || "null");
  if (!control?.socketPath || !control.token || !control.sessionId || !control.generationId) {
    throw new Error("Session control is unavailable. Reconnect the assistant.");
  }
  const body = JSON.stringify({
    name: args[1], projectSlug: args[1], message: args[messageIndex], messageId: args[messageIndex + 1],
    ...(explicitSession ? { destinationSessionId: args[3] } : {}),
    token: control.token, sessionId: control.sessionId, generationId: control.generationId
  });
  const result = await new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: control.socketPath, method: "POST", path: messageProject ? "/agent-session-command/message-project" : projectPreview ? "/agent-session-command/project-preview" : status ? "/agent-session-command/status" : "/agent-session-command/rename", timeout: 15000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("error", reject);
      response.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Session control timed out.")));
    request.end(body);
  });
  if (result.ok !== true) throw new Error(result.error || "The session command failed.");
  console.log(projectPreview ? result.url : JSON.stringify(status || messageProject ? result : { sessionName: result.sessionName }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`;
}

function commandRunnerSource() {
  return `#!/usr/bin/env bash
set +e

command_base64="\${${VIBE64_AGENT_SESSION_RUN_COMMAND_ENV}:-}"
output_path="\${${VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV}:-}"
result_path="\${${VIBE64_AGENT_SESSION_RUN_RESULT_ENV}:-}"

if [ -z "$command_base64" ] || [ -z "$output_path" ] || [ -z "$result_path" ]; then
  exit 125
fi

unset ${VIBE64_AGENT_SESSION_RUN_COMMAND_ENV}
unset ${VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV}
unset ${VIBE64_AGENT_SESSION_RUN_RESULT_ENV}

exec >>"$output_path" 2>&1

finish() {
  status=$?
  printf '%s\\n' "$status" >"$result_path.tmp"
  mv -f "$result_path.tmp" "$result_path"
}
trap finish EXIT

command_text="$(printf '%s' "$command_base64" | base64 --decode)" || exit 125
eval "$command_text"
`;
}

function sanitizedCommandEnvironment(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => (
      name &&
      !AGENT_SESSION_CONTROL_ENV_NAMES.has(name) &&
      !AGENT_SESSION_DESKTOP_BUS_ENV_NAMES.has(name) &&
      !name.startsWith("VIBE64_CODEX_APP_SERVER_") &&
      name !== "VIBE64_OPENCODE_SESSION_ENV_REGISTRY" &&
      ![
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_DB",
        "OPENCODE_SERVER_PASSWORD",
        "OPENCODE_SERVER_USERNAME"
      ].includes(name)
    ))
    .map(([name, item]) => [name, String(item ?? "")]));
}

function decodedCommand(value = "") {
  const normalized = normalizeText(value);
  if (!normalized || !/^[A-Za-z0-9_-]+$/u.test(normalized)) {
    return "";
  }
  try {
    return Buffer.from(normalized, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function validateCommandCwd(cwd = "", sourceRoot = "") {
  const resolvedCwd = path.resolve(normalizeText(cwd) || sourceRoot);
  if (!sourceRoot || !pathInsideOrEqual(sourceRoot, resolvedCwd)) {
    return responseError(
      "Agent commands must run inside the active session source.",
      "vibe64_agent_session_command_cwd_invalid",
      {
        cwd: resolvedCwd,
        sourceRoot
      }
    );
  }
  return {
    cwd: resolvedCwd,
    ok: true
  };
}

async function readBoundedFile(filePath = "", maxBytes = AGENT_SESSION_COMMAND_OUTPUT_MAX_BYTES) {
  const handle = await open(filePath, "r");
  try {
    const fileSize = Number((await handle.stat()).size || 0);
    const readSize = Math.min(Math.max(0, fileSize), maxBytes);
    if (readSize === 0) {
      return "";
    }
    const buffer = Buffer.allocUnsafe(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function waitForCommandResult(resultPath = "", {
  signal = null,
  timeoutMs = AGENT_SESSION_COMMAND_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      const error = new Error("Vibe64 session command was cancelled.");
      error.code = "vibe64_agent_session_command_cancelled";
      throw error;
    }
    try {
      return normalizeText(await readFile(resultPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, AGENT_SESSION_COMMAND_POLL_MS));
  }
  const error = new Error("Vibe64 session command timed out.");
  error.code = "vibe64_agent_session_command_timeout";
  throw error;
}

// Every route but run is authorized by the control token rather than the
// shell-execution token.
const commandServers = createSessionCommandServers({
  routePrefix: "/agent-session-command",
  routes: {
    "/agent-session-command/message-project": {
      handle: ({ commandService, input, sessionId }) => commandService.messageProject(sessionId, input),
      status: vibe64StatusCode, token: "controlToken"
    },
    "/agent-session-command/project-preview": {
      handle: ({ commandService, input, sessionId }) => commandService.projectPreview(sessionId, input),
      status: vibe64StatusCode, token: "controlToken"
    },
    "/agent-session-command/rename": {
      handle: ({ commandService, input, sessionId }) => commandService.renameSession(sessionId, input.name),
      status: vibe64StatusCode, token: "controlToken"
    },
    "/agent-session-command/status": {
      handle: ({ commandService, sessionId }) => commandService.sessionStatus(sessionId),
      status: vibe64StatusCode, token: "controlToken"
    },
    "/agent-session-command/plan": {
      handle: ({ commandService, input, sessionId }) => commandService.managePlan(sessionId, input),
      status: vibe64StatusCode, token: "controlToken"
    },
    "/agent-session-command/run": {
      handle({ commandService, input, request, response }) {
        const abortController = new AbortController();
        request.once("aborted", () => abortController.abort());
        response.once("close", () => {
          if (!response.writableEnded) abortController.abort();
        });
        return commandService.run({ ...input, signal: abortController.signal });
      },
      status: vibe64StatusCode
    }
  },
  extraTokens: ["controlToken"],
  label: "session",
  maxBytes: AGENT_SESSION_COMMAND_REQUEST_MAX_BYTES,
  invalidJsonError: { code: "vibe64_agent_session_command_invalid_json", message: "Vibe64 session command input must be valid JSON." },
  tooLargeError: { code: "vibe64_agent_session_command_input_too_large", message: "Vibe64 session command input is too large." },
  notFound: responseError("Unknown Vibe64 session command route.", "vibe64_agent_session_command_route_not_found"),
  rejection: {
    statusCode: 403,
    payload: responseError("Vibe64 session command identity is invalid. Reconnect the affected assistant before retrying. If only a child agent is affected, ask its parent to replace that child and preserve its work.", "vibe64_agent_session_command_identity_invalid")
  },
  requestFailure: {
    fallbackCode: "vibe64_agent_session_command_request_failed",
    fallbackMessage: "Vibe64 session command request failed."
  },
  errorBody: (payload) => responseError(payload.error, payload.code),
  directoryMode: 0o700
});

function createAgentSessionCommandService({
  sendProjectMessage = null,
  readProjectPreview = null,
  reportWorkflowOutcome = null,
  logger = null,
  projectService,
  publishSessionChanged = () => {},
  runCommand = runVibe64Command,
  stopExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions
} = {}) {
  if (
    !projectService ||
    typeof projectService.createSessionStore !== "function" ||
    typeof projectService.readCurrentProject !== "function" ||
    typeof projectService.runInProjectContext !== "function"
  ) {
    throw new TypeError("createAgentSessionCommandService requires the Vibe64 project and session-store APIs.");
  }
  const projectBinding = createAgentCommandProjectBinding(projectService, {
    sessionRequired: ["Vibe64 session command binding is incomplete.", "vibe64_agent_session_command_binding_required"],
    projectRequired: ["Vibe64 session commands require a project.", "vibe64_agent_session_command_project_required"],
    unbound: ["This shell command is not bound to an active Vibe64 session.", "vibe64_agent_session_command_session_unbound"],
    changed: ["The shell command session no longer matches its bound project.", "vibe64_agent_session_command_project_binding_changed"]
  });
  const sessionExecutions = new Map();
  const sessionRuns = new Map();

  async function bindSession(sessionId = "", { wrapperHostDir = "" } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
    if (!normalizedSessionId || !normalizedWrapperHostDir) {
      throw vibe64Error(
        "Vibe64 session command binding is incomplete.",
        "vibe64_agent_session_command_binding_required"
      );
    }
    const requestContext = currentProjectRequestContext();
    // Practice sessions are ordinary project sessions; no host binds a
    // learning-scoped session command any more, so one is refused.
    if (requestContext?.learningScope) {
      throw vibe64Error("Session commands are unavailable in a Learning-scoped context.", "vibe64_agent_session_command_learning_unavailable");
    }
    const binding = await projectBinding.bind(normalizedSessionId);
    Object.assign(binding, {
      actor: requestContext?.vibe64User || null,
      projectContext: captureProjectRequestContext(),
      wrapperHostDir: path.resolve(normalizedWrapperHostDir)
    });
    return {
      ...binding,
      ok: true,
      sessionId: normalizedSessionId
    };
  }

  async function runInSessionProject(sessionId = "", operation) {
    const normalizedSessionId = normalizeText(sessionId);
    const run = () => projectBinding.run(normalizedSessionId, async (binding, project) => {
      const store = await projectService.createSessionStore({
        sessionId: normalizedSessionId
      });
      if (typeof store?.readSessionSourceDescriptor !== "function") {
        throw new TypeError("Vibe64 session commands require bounded session source reads.");
      }
      const descriptor = await store.readSessionSourceDescriptor(normalizedSessionId);
      const sourceRoot = sessionSourcePath({
        ...descriptor,
        id: normalizedSessionId,
        sessionId: normalizedSessionId
      });
      if (!sourceRoot) {
        throw vibe64Error(
          "The active Vibe64 session source is unavailable.",
          "vibe64_agent_session_command_source_unavailable"
        );
      }
      return operation({
        binding,
        store,
        descriptor,
        project,
        sourceRoot: path.resolve(sourceRoot)
      });
    });
    return runWithProjectRequestContext(projectBinding.get(normalizedSessionId)?.projectContext || {}, run);
  }

  // Cross-project commands act for the person who submitted the current request.
  async function requestActor(store, sessionId, binding) {
    const routing = JSON.parse(await store.readMetadataValue(sessionId, "assistant_routing_request") || "null");
    return routing?.submittedBy || binding.actor;
  }

  async function messageProject(sessionId, input) {
    return runInSessionProject(sessionId, async ({ binding, store }) => {
      if (typeof sendProjectMessage !== "function") {
        throw vibe64Error("Project messaging is unavailable in this session.", "vibe64_project_message_unavailable");
      }
      return sendProjectMessage({
        projectSlug: normalizeText(input.projectSlug), message: normalizeText(input.message),
        ...(input.destinationSessionId !== undefined ? { destinationSessionId: normalizeText(input.destinationSessionId) } : {}),
        messageId: normalizeText(input.messageId) || randomUUID(),
        sourceProject: binding.projectSlug, sourceSession: sessionId,
        actor: await requestActor(store, sessionId, binding)
      });
    });
  }

  async function projectPreview(sessionId, input) {
    return runInSessionProject(sessionId, async ({ binding, store }) => {
      if (typeof readProjectPreview !== "function") {
        throw vibe64Error("Project Previews are unavailable in this session.", "vibe64_project_preview_unavailable");
      }
      return readProjectPreview({
        projectSlug: normalizeText(input.projectSlug),
        ...(input.destinationSessionId !== undefined ? { destinationSessionId: normalizeText(input.destinationSessionId) } : {}),
        sourceProject: binding.projectSlug, sourceSession: sessionId,
        actor: await requestActor(store, sessionId, binding)
      });
    });
  }

  async function renameSession(sessionId, name) {
    return runInSessionProject(sessionId, async ({ store }) => {
      const sessionName = await store.writeSessionLabel(sessionId, name);
      await publishSessionChanged(sessionId, { reason: "session-renamed", payload: { clientRefresh: { includeList: true } } });
      return { ok: true, sessionId, sessionName };
    });
  }

  async function sessionStatus(sessionId) {
    return runInSessionProject(sessionId, async ({ descriptor, sourceRoot, project, store }) => {
      const environment = await projectService.projectEnvironmentStatus({
        sessionId, session: { ...descriptor, sessionId }
      });
      let setup;
      try {
        setup = typeof projectService.inspectWorkspaceSetup === "function"
          ? await projectService.inspectWorkspaceSetup({ projectRoot: sourceRoot,
            session: await (await projectService.createRuntime({ inspectSource: false })).getSession(sessionId, { inspectSource: false }) })
          : await inspectVibe64WorkspaceSetup({ projectRoot: sourceRoot });
      } catch (error) {
        // The agent repairing or deciding a project contract still needs status;
        // report Genesis's actionable message instead of failing the command.
        if (!genesisProjectContractNeedsAttention(error)) throw error;
        setup = { status: "blocked", steps: [], diagnostics: [{ code: error.code, message: normalizeText(error.message) }] };
      }
      const state = workspaceSetupStateFromMetadata({
        [WORKSPACE_SETUP_METADATA_NAME]: await store.readMetadataValue(sessionId, WORKSPACE_SETUP_METADATA_NAME)
      });
      return {
        ok: true,
        sessionId,
        project: normalizeText(project.slug || project.name),
        environment,
        workspaceSetup: {
          status: state.status,
          inspectionStatus: setup.status,
          diagnostic: state.diagnostic,
          steps: setup.steps.map(({ label, argv }) => ({ label, argv })),
          diagnostics: setup.diagnostics
        },
        tools: {
          environment: "vibe64-helper env status development",
          preview: "vibe64-helper preview status",
          browser: "vibe64-helper preview browser eval (Playwright code on stdin)",
          browserTests: "vibe64-helper playwright status",
          browserTestReadiness: "vibe64-helper playwright readiness",
          database: "vibe64-helper database refresh"
        },
        recovery: environment.status === "not-prepared"
          // The assistant reads this mid-turn; starting Preview prepares the
          // workspace, so stale "not prepared" advice must not reach the person.
          ? "Run vibe64-helper preview ensure --wait: starting Preview prepares the workspace and its managed resources. Read this status again before reporting preparation to the person. If preparation fails, fix the cause; the person can use Retry on its card."
          : environment.status === "missing-configuration"
          ? "Supply the missing application resource configuration through Development Env."
          : environment.status === "unavailable"
          ? "Correct the project environment declaration and retry."
          : ""
      };
    });
  }

  async function managePlan(sessionId, input) {
    return runInSessionProject(sessionId, async ({ store }) => {
      const request = JSON.parse(await store.readMetadataValue(sessionId, "assistant_routing_request") || "null");
      if (input.operation === "outcome") {
        if (typeof reportWorkflowOutcome !== "function") throw new Error("Workflow controls are unavailable.");
        return reportWorkflowOutcome(sessionId, input, { vibe64User: request?.submittedBy || null });
      }
      let role = "";
      if (request?.reason !== "conversation" && request?.task !== "deslop" && request?.status === "working" && request.delivery === "accepted") {
        role = request.stage === "review" && request.followup ? "review" : request.resolvedMode;
      }
      const result = await manageWorkPlan({ runtime: { store }, session: { sessionId } }, input, role);
      if (!["read", "history"].includes(input.operation)) {
        await publishSessionChanged(sessionId, { reason: "work-plan-changed", payload: { planNotice: result.notice || "" } });
      }
      return { ok: true, ...result, ...(input.operation === "read" ? { workflow: request?.mode === "auto" && (request.workflow || request.stage === "planning") ? {
        messageId: request.messageId, turnId: request.turnId || "", stage: request.stage, status: request.status
      } : null } : {}) };
    });
  }

  async function execute(input = {}, context = {}) {
    input.signal?.throwIfAborted();
    const command = decodedCommand(input.commandBase64);
    if (!command) {
      return responseError(
        "Vibe64 session command input is invalid.",
        "vibe64_agent_session_command_invalid",
        { exitCode: 2 }
      );
    }
    const cwd = validateCommandCwd(input.cwd, context.sourceRoot);
    if (cwd.ok === false) {
      return cwd;
    }
    const runtimeConfigEnv = await loadProjectExecutionEnv({
      projectService,
      session: { ...context.descriptor, sessionId: normalizeText(input.sessionId) }
    });
    const commandId = randomUUID();
    const runRoot = path.join(
      commandRunsHostPath(context.binding.wrapperHostDir),
      commandId
    );
    const outputPath = path.join(runRoot, "output.log");
    const resultPath = path.join(runRoot, "result.txt");
    await mkdir(runRoot, {
      mode: 0o700,
      recursive: true
    });
    const childEnv = {
      ...sanitizedCommandEnvironment(input.env),
      ...genesisParserEnvironment(),
      [VIBE64_AGENT_SESSION_RUN_COMMAND_ENV]: Buffer.from(command, "utf8").toString("base64"),
      [VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV]: outputPath,
      [VIBE64_AGENT_SESSION_RUN_RESULT_ENV]: resultPath
    };
    const projectSlug = context.binding.projectSlug;
    input.signal?.throwIfAborted();
    const started = await runCommand({
      actor: "app",
      allowedRoots: [context.sourceRoot],
      args: [],
      baseEnv: childEnv,
      command: runnerHostPath(context.binding.wrapperHostDir),
      cwd: cwd.cwd,
      envPolicy: "session",
      execution: {
        kind: "job",
        label: "Agent command",
        lifecycle: "service",
        operationId: `agent-command-${shortCommandHash(commandId)}`,
        ownerId: normalizeText(input.sessionId),
        projectSlug,
        sessionId: normalizeText(input.sessionId)
      },
      inheritProcessEnv: false,
      mode: "detached",
      project: {
        ...context.project,
        runtimeConfigEnv,
        slug: projectSlug
      },
      purpose: "terminal",
      runtimes: VIBE64_INTERACTIVE_RUNTIME_PACKS,
      session: {
        ...context.descriptor,
        sessionId: normalizeText(input.sessionId),
        sourcePath: context.sourceRoot
      },
      shimDirs: withGenesisCommandShim([context.binding.wrapperHostDir]),
      timeout: AGENT_SESSION_COMMAND_TIMEOUT_MS
    });
    const executionId = normalizeText(started?.execution?.id);
    if (started?.ok !== true || !executionId) {
      await rm(runRoot, { force: true, recursive: true }).catch(() => null);
      return responseError(
        normalizeText(started?.error || started?.stderr || started?.output) || "Vibe64 could not start this session command.",
        normalizeText(started?.code) || "vibe64_agent_session_command_start_failed"
      );
    }
    const executions = sessionExecutions.get(normalizeText(input.sessionId)) || new Set();
    executions.add(executionId);
    sessionExecutions.set(normalizeText(input.sessionId), executions);
    try {
      const exitCodeText = await waitForCommandResult(resultPath, {
        signal: input.signal,
        timeoutMs: AGENT_SESSION_COMMAND_TIMEOUT_MS
      });
      const exitCode = Number.parseInt(exitCodeText, 10);
      const output = await readBoundedFile(outputPath).catch((error) => (
        error?.code === "ENOENT" ? "" : Promise.reject(error)
      ));
      const normalizedExitCode = Number.isInteger(exitCode) ? exitCode : 1;
      return {
        execution: started.execution,
        exitCode: normalizedExitCode,
        ok: normalizedExitCode === 0,
        output,
        stderr: normalizedExitCode === 0 ? "" : output,
        stdout: normalizedExitCode === 0 ? output : ""
      };
    } catch (error) {
      await stopExecution(executionId, {
        reason: error?.code || "agent-session-command-failed"
      }).catch(() => null);
      throw error;
    }
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const sessionId = normalizeText(input.sessionId);
    const abortController = new AbortController();
    const runs = sessionRuns.get(sessionId) || new Set();
    runs.add(abortController);
    sessionRuns.set(sessionId, runs);
    const abort = () => abortController.abort(input.signal?.reason);
    input.signal?.addEventListener?.("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    let result;
    try {
      if (!sessionId) {
        throw vibe64Error(
          "Vibe64 session command session id is required.",
          "vibe64_agent_session_command_session_required"
        );
      }
      result = await runInSessionProject(
        sessionId,
        (context) => execute({ ...input, signal: abortController.signal }, context)
      );
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_agent_session_command_failed",
        fallbackMessage: "Vibe64 session command failed."
      });
      result = responseError(payload.error, payload.code);
    } finally {
      input.signal?.removeEventListener?.("abort", abort);
      runs.delete(abortController);
      if (sessionRuns.get(sessionId) === runs && runs.size === 0) {
        sessionRuns.delete(sessionId);
      }
    }
    logOperationalEvent(logger, result?.ok === false ? "warn" : "info", {
      code: normalizeText(result?.code),
      component: "vibe64.agent_session_command",
      durationMs: Date.now() - startedAtMs,
      event: "vibe64.agent_session_command.finished",
      executionId: normalizeText(result?.execution?.id),
      exitCode: Number(result?.exitCode ?? (result?.ok === false ? 1 : 0)),
      ok: result?.ok !== false,
      sessionId
    }, "Vibe64 agent session command finished.");
    return result;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const binding = projectBinding.forget(normalizedSessionId);
    for (const abortController of sessionRuns.get(normalizedSessionId) || []) {
      abortController.abort();
    }
    sessionRuns.delete(normalizedSessionId);
    const executions = [...(sessionExecutions.get(normalizedSessionId) || [])];
    sessionExecutions.delete(normalizedSessionId);
    const owned = await stopOwnedExecutions({
      ownerId: normalizedSessionId,
      sessionId: normalizedSessionId
    }, {
      reason: "session-close"
    }).catch(() => ({ supported: false }));
    const proofs = owned?.supported === true
      ? (Array.isArray(owned.processExitProofs) ? owned.processExitProofs : [owned])
      : await Promise.all(executions.map((executionId) => (
          stopExecution(executionId, {
            reason: "session-close"
          }).catch((error) => ({
            error: error?.message || String(error),
            executionId,
            ok: false
          }))
        )));
    const closed = await commandServers.closeForSession(normalizedSessionId);
    const stoppedExecutionCount = owned?.supported === true
      ? Number(owned.closed || 0)
      : proofs.filter((proof) => proof?.stopped === true).length;
    if (binding?.wrapperHostDir) {
      await rm(commandRunsHostPath(binding.wrapperHostDir), {
        force: true,
        recursive: true
      }).catch(() => null);
    }
    return {
      closed: closed + stoppedExecutionCount,
      ok: proofs.every((proof) => proof?.ok !== false || proof?.code === "vibe64_execution_not_found"),
      processExitProofs: proofs
    };
  }

  return Object.freeze({
    logger,
    bindSession,
    closeAllForSession,
    renameSession,
    messageProject,
    projectPreview,
    sessionStatus,
    managePlan,
    run
  });
}

async function prepareAgentSessionCommand({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!commandService || !normalizedSessionId || !normalizedWrapperHostDir) {
    return {
      env: {},
      ok: false
    };
  }
  await commandService.bindSession(normalizedSessionId, {
    wrapperHostDir: normalizedWrapperHostDir
  });
  await Promise.all([
    writeExecutableFileIfChanged(path.join(normalizedWrapperHostDir, "vibe64-plan"), planCommandSource(SESSION_RENAME_CONTROL_ENV)),
    writeExecutableFileIfChanged(path.join(normalizedWrapperHostDir, "vibe64-session"), sessionRenameCommandSource()),
    writeExecutableFileIfChanged(
      wrapperHostPath(normalizedWrapperHostDir),
      commandWrapperSource()
    ),
    writeExecutableFileIfChanged(
      runnerHostPath(normalizedWrapperHostDir),
      commandRunnerSource()
    )
  ]);
  const server = await commandServers.ensure({
    commandService,
    sessionId: normalizedSessionId,
    socketPath: commandSocketHostPath(normalizedWrapperHostDir)
  });
  return {
    controlGenerationId: server.generationId,
    env: {
      [SESSION_RENAME_CONTROL_ENV]: JSON.stringify({ socketPath: server.socketPath, sessionId: normalizedSessionId,
        generationId: server.generationId, token: server.controlToken }),
      [VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV]: AGENT_SESSION_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV]: server.token,
      [VIBE64_WRAPPER_ENV]: wrapperHostPath(normalizedWrapperHostDir)
    },
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_SESSION_COMMAND_NAME,
  VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV,
  VIBE64_WRAPPER_ENV,
  createAgentSessionCommandService,
  prepareAgentSessionCommand
};
