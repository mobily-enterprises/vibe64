import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rm
} from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
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
import { withGenesisCommandShim } from "@local/vibe64-genesis/server";
import {
  pathInsideOrEqual
} from "./terminalShared.js";
import {
  closeUnixJsonCommandServersForSession,
  listenUnixJsonCommandServer,
  readJsonCommandRequest,
  removeDeadUnixJsonCommandSocket,
  sendJsonCommandResponse,
  shortCommandHash,
  unixJsonCommandServerIsHealthy
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

const commandServers = new Map();
const commandServerPrepares = new Map();

function normalizedProjectContextRoot(project = {}) {
  const root = normalizeText(project?.projectRoot || project?.path);
  return root ? path.resolve(root) : "";
}

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_NAME);
}

function runnerHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_RUNNER_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_SOCKET_NAME);
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

function commandServerIdentity({ sessionId = "", socketPath = "", wrapperHostDir = "" } = {}) {
  return shortCommandHash([
    AGENT_SESSION_COMMAND_CONTRACT_VERSION,
    normalizeText(sessionId),
    normalizeText(socketPath),
    normalizeText(wrapperHostDir)
  ].join("\n"));
}

async function closeAgentSessionCommandServersForSession(sessionId = "") {
  return closeUnixJsonCommandServersForSession(commandServers, sessionId);
}

async function ensureAgentSessionCommandServer({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const socketPath = commandSocketHostPath(wrapperHostDir);
  const identity = commandServerIdentity({ sessionId, socketPath, wrapperHostDir });
  const preparation = commandServerPrepares.get(socketPath);
  if (preparation) {
    await preparation.catch(() => null);
  }
  const existing = commandServers.get(socketPath);
  if (
    existing?.commandService === commandService &&
    existing?.identity === identity &&
    await unixJsonCommandServerIsHealthy(existing, {
      healthPath: "/agent-session-command/health",
      sessionId,
      socketPath
    })
  ) {
    return existing;
  }
  const prepare = (async () => {
    if (existing?.server) {
      await new Promise((resolve) => existing.server.close(() => resolve())).catch(() => null);
      commandServers.delete(socketPath);
    }
    await mkdir(path.dirname(socketPath), {
      mode: 0o700,
      recursive: true
    });
    await removeDeadUnixJsonCommandSocket(socketPath, {
      healthPath: "/agent-session-command/health",
      ownerErrorMessage: "The session command socket is owned by an unverified listener."
    });
    const generationId = randomUUID();
    const token = randomUUID();
    const server = http.createServer(async (request, response) => {
      try {
        if (request.method !== "POST") {
          sendJsonCommandResponse(response, 404, responseError("Unknown Vibe64 session command route.", "vibe64_agent_session_command_route_not_found"));
          return;
        }
        const input = await readJsonCommandRequest(request, {
          invalidJsonError: {
            code: "vibe64_agent_session_command_invalid_json",
            message: "Vibe64 session command input must be valid JSON."
          },
          maxBytes: AGENT_SESSION_COMMAND_REQUEST_MAX_BYTES,
          tooLargeError: {
            code: "vibe64_agent_session_command_input_too_large",
            message: "Vibe64 session command input is too large."
          }
        });
        const authorized = normalizeText(input.token) === token &&
          normalizeText(input.generationId) === generationId &&
          normalizeText(input.sessionId) === normalizeText(sessionId);
        if (!authorized) {
          sendJsonCommandResponse(response, 403, responseError("Vibe64 session command identity is invalid.", "vibe64_agent_session_command_identity_invalid"));
          return;
        }
        if (request.url === "/agent-session-command/health") {
          sendJsonCommandResponse(response, 200, {
            generationId,
            ok: true,
            sessionId: normalizeText(sessionId)
          });
          return;
        }
        if (request.url !== "/agent-session-command/run") {
          sendJsonCommandResponse(response, 404, responseError("Unknown Vibe64 session command route.", "vibe64_agent_session_command_route_not_found"));
          return;
        }
        const abortController = new AbortController();
        request.once("aborted", () => abortController.abort());
        response.once("close", () => {
          if (!response.writableEnded) {
            abortController.abort();
          }
        });
        const result = await commandService.run({
          ...input,
          signal: abortController.signal
        });
        if (!response.destroyed) {
          sendJsonCommandResponse(response, vibe64StatusCode(result), result);
        }
      } catch (error) {
        if (response.destroyed) {
          return;
        }
        const payload = vibe64ErrorResponse(error, {
          fallbackCode: "vibe64_agent_session_command_request_failed",
          fallbackMessage: "Vibe64 session command request failed."
        });
        sendJsonCommandResponse(response, vibe64StatusCode(payload), responseError(payload.error, payload.code));
      }
    });
    await listenUnixJsonCommandServer(server, socketPath);
    const stored = {
      commandService,
      generationId,
      identity,
      server,
      sessionId: normalizeText(sessionId),
      socketPath,
      token
    };
    commandServers.set(socketPath, stored);
    return stored;
  })();
  commandServerPrepares.set(socketPath, prepare);
  try {
    return await prepare;
  } finally {
    if (commandServerPrepares.get(socketPath) === prepare) {
      commandServerPrepares.delete(socketPath);
    }
  }
}

function createAgentSessionCommandService({
  logger = null,
  projectService,
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
  const sessionBindings = new Map();
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
    const project = await projectService.readCurrentProject();
    const projectSlug = normalizeText(project?.slug || project?.name);
    if (!projectSlug) {
      throw vibe64Error(
        "Vibe64 session commands require a project.",
        "vibe64_agent_session_command_project_required"
      );
    }
    const binding = {
      projectContextRoot: normalizedProjectContextRoot(project),
      projectSlug,
      wrapperHostDir: path.resolve(normalizedWrapperHostDir)
    };
    sessionBindings.set(normalizedSessionId, binding);
    return {
      ...binding,
      ok: true,
      sessionId: normalizedSessionId
    };
  }

  async function runInSessionProject(sessionId = "", operation) {
    const normalizedSessionId = normalizeText(sessionId);
    const binding = sessionBindings.get(normalizedSessionId);
    if (!binding?.projectSlug) {
      throw vibe64Error(
        "This shell command is not bound to an active Vibe64 session.",
        "vibe64_agent_session_command_session_unbound"
      );
    }
    return projectService.runInProjectContext(binding.projectSlug, async () => {
      const project = await projectService.readCurrentProject();
      const currentSlug = normalizeText(project?.slug || project?.name);
      const currentProjectContextRoot = normalizedProjectContextRoot(project);
      if (
        currentSlug !== binding.projectSlug ||
        binding.projectContextRoot && currentProjectContextRoot !== binding.projectContextRoot
      ) {
        throw vibe64Error(
          "The shell command session no longer matches its bound project.",
          "vibe64_agent_session_command_project_binding_changed"
        );
      }
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
        descriptor,
        project,
        sourceRoot: path.resolve(sourceRoot)
      });
    });
  }

  async function execute(input = {}, context = {}) {
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
      [VIBE64_AGENT_SESSION_RUN_COMMAND_ENV]: Buffer.from(command, "utf8").toString("base64"),
      [VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV]: outputPath,
      [VIBE64_AGENT_SESSION_RUN_RESULT_ENV]: resultPath
    };
    const projectSlug = context.binding.projectSlug;
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
    const abort = () => abortController.abort();
    input.signal?.addEventListener?.("abort", abort, { once: true });
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
        (context) => execute({
          ...input,
          signal: abortController.signal
        }, context)
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
    const binding = sessionBindings.get(normalizedSessionId);
    sessionBindings.delete(normalizedSessionId);
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
    const closed = await closeAgentSessionCommandServersForSession(normalizedSessionId);
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
    bindSession,
    closeAllForSession,
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
    writeExecutableFileIfChanged(
      wrapperHostPath(normalizedWrapperHostDir),
      commandWrapperSource()
    ),
    writeExecutableFileIfChanged(
      runnerHostPath(normalizedWrapperHostDir),
      commandRunnerSource()
    )
  ]);
  const server = await ensureAgentSessionCommandServer({
    commandService,
    sessionId: normalizedSessionId,
    wrapperHostDir: normalizedWrapperHostDir
  });
  return {
    controlGenerationId: server.generationId,
    env: {
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
