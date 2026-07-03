import crypto from "node:crypto";
import http from "node:http";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  codexProviderHome,
  resolveGithubToolHomeForStoredActor
} from "@local/studio-terminal-core/server/providerHomes";
import {
  sessionGitCommandActorFromMetadata
} from "./sessionGitCommandActor.js";
import {
  githubGitNonInteractiveDockerEnvArgs,
  githubGitNonInteractiveEnv,
  githubSshToHttpsGitDockerEnvArgs,
  githubSshToHttpsGitEnv
} from "@local/studio-terminal-core/server/gitGithubTransport";
import {
  gitToolchainMountArgs
} from "@local/studio-terminal-core/server/gitToolchainMounts";
import {
  ensureTargetRuntimeNetwork,
  targetRuntimeNetworkDockerArgs
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  hostUserIdentityEnvArgs,
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  studioDaemonDockerLabels,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioToolHomeDockerArgs,
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  pathInsideOrEqual
} from "./terminalShared.js";

const CODEX_GIT_COMMAND_DIR_NAME = "codex-git-command";
const CODEX_GIT_COMMAND_SOCKET_NAME = "command.sock";
const CODEX_GIT_COMMAND_WRAPPER_NAMES = Object.freeze(["git", "gh"]);
const CODEX_GIT_COMMAND_INPUT_MAX_BYTES = 20 * 1024 * 1024;
const CODEX_GIT_COMMAND_TIMEOUT_MS = 120_000;
const VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV = "VIBE64_CODEX_GIT_COMMAND_SESSION_ID";
const VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV = "VIBE64_CODEX_GIT_COMMAND_SOCKET";
const VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV = "VIBE64_CODEX_GIT_COMMAND_TOKEN";
const VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV = "VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR";

const commandServers = new Map();

function normalizeText(value = "") {
  return String(value || "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableHash(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 16);
}

function attachmentRuntimeKey({
  sessionId = "",
  stateRoot = ""
} = {}) {
  return stableHash([
    normalizeText(stateRoot),
    normalizeText(sessionId)
  ].join("\n"));
}

function commandHostDir({
  env = process.env,
  sessionId = "",
  stateRoot = ""
} = {}) {
  return path.join(
    codexAttachmentHostRoot({
      env
    }),
    CODEX_GIT_COMMAND_DIR_NAME,
    attachmentRuntimeKey({
      sessionId,
      stateRoot
    })
  );
}

function commandContainerDir({
  sessionId = "",
  stateRoot = ""
} = {}) {
  return path.posix.join(
    CODEX_ATTACHMENT_CONTAINER_ROOT,
    CODEX_GIT_COMMAND_DIR_NAME,
    attachmentRuntimeKey({
      sessionId,
      stateRoot
    })
  );
}

function commandSocketHostPath(options = {}) {
  return path.join(commandHostDir(options), CODEX_GIT_COMMAND_SOCKET_NAME);
}

function commandSocketContainerPath(options = {}) {
  return path.posix.join(commandContainerDir(options), CODEX_GIT_COMMAND_SOCKET_NAME);
}

function wrapperHostPath(options = {}, command = "") {
  return path.join(commandHostDir(options), command);
}

function wrapperContainerDir(options = {}) {
  return commandContainerDir(options);
}

function readRequestBuffer(request, {
  maxBytes = CODEX_GIT_COMMAND_INPUT_MAX_BYTES
} = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Codex git command input is too large.");
        error.code = "vibe64_codex_git_command_input_too_large";
        reject(error);
        request.destroy(error);
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function readRequestJson(request) {
  const text = await readRequestBuffer(request);
  try {
    const parsed = JSON.parse(text || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    const error = new Error("Codex git command input must be valid JSON.");
    error.code = "vibe64_codex_git_command_invalid_json";
    throw error;
  }
}

function sendJson(response, statusCode, payload = {}) {
  const text = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(text),
    "Content-Type": "application/json"
  });
  response.end(text);
}

function wrapperScriptSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const allowedCommands = new Set(["git", "gh"]);
const command = path.basename(process.argv[1] || "");

function fail(message, code = 1) {
  process.stderr.write(String(message || "Codex git command failed.") + "\\n");
  process.exit(code);
}

function readStdinBase64() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(Buffer.concat(chunks).toString("base64")));
  });
}

function requestSocket({ body, socketPath }) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/codex-git-command/run",
      socketPath
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.once("end", () => resolve({
        statusCode: response.statusCode,
        text
      }));
    });
    request.once("error", reject);
    request.end(requestBody);
  });
}

if (!allowedCommands.has(command)) {
  fail("Codex git command wrapper was invoked with an unsupported command.");
}

const socketPath = process.env.${VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV} || "";
const sessionId = process.env.${VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV} || "";
const token = process.env.${VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV} || "";

if (!socketPath || !sessionId || !token) {
  fail("Codex git command identity is not available for this session.");
}

const inputBase64 = await readStdinBase64();
const response = await requestSocket({
  socketPath,
  body: {
    args: process.argv.slice(2),
    command,
    cwd: process.cwd(),
    inputBase64,
    sessionId,
    token
  }
}).catch((error) => {
  fail(error?.message || error || "Codex git command request failed.");
});

let payload = {};
try {
  payload = JSON.parse(response.text || "{}");
} catch {
  fail(response.text || "Codex git command returned invalid JSON.");
}

if (payload.stdout) {
  process.stdout.write(String(payload.stdout));
  if (!String(payload.stdout).endsWith("\\n")) {
    process.stdout.write("\\n");
  }
}
if (payload.stderr) {
  process.stderr.write(String(payload.stderr));
  if (!String(payload.stderr).endsWith("\\n")) {
    process.stderr.write("\\n");
  }
}
if (payload.ok === false && !payload.stderr && payload.error) {
  process.stderr.write(String(payload.error) + "\\n");
}

const exitCode = Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0);
process.exit(exitCode);
`;
}

async function writeWrappers(options = {}) {
  const dir = commandHostDir(options);
  await mkdir(dir, {
    recursive: true
  });
  await Promise.all(CODEX_GIT_COMMAND_WRAPPER_NAMES.map(async (command) => {
    const filePath = wrapperHostPath(options, command);
    await writeFile(filePath, wrapperScriptSource(), "utf8");
    await chmod(filePath, 0o755);
  }));
}

function responseError(message = "", code = "vibe64_codex_git_command_failed", extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
  };
}

function gitCommandActorFromSession(session = {}) {
  const actor = sessionGitCommandActorFromMetadata(session);
  if (actor?.ok === false) {
    return actor;
  }
  return {
    ...actor,
    actorSource: "session_git_command_actor",
    ok: true
  };
}

function normalizeContainerCwd(cwd = "", actor = {}) {
  const normalizedCwd = normalizeText(cwd);
  if (!normalizedCwd) {
    return actor.workdir || actor.targetRoot;
  }
  if (normalizedCwd === "/workspace") {
    return actor.targetRoot;
  }
  if (normalizedCwd.startsWith("/workspace/")) {
    return path.join(actor.targetRoot, normalizedCwd.slice("/workspace/".length));
  }
  return normalizedCwd;
}

function validateCommandCwd(cwd = "", actor = {}) {
  const resolvedCwd = path.resolve(normalizeContainerCwd(cwd, actor));
  const targetRoot = path.resolve(actor.targetRoot);
  if (!pathInsideOrEqual(targetRoot, resolvedCwd)) {
    return responseError(
      "Codex git commands must run inside the active project.",
      "vibe64_codex_git_command_cwd_invalid",
      {
        cwd: resolvedCwd,
        targetRoot
      }
    );
  }
  return {
    cwd: resolvedCwd,
    ok: true
  };
}

function githubCommandEnv(toolHomeSource = "") {
  const home = normalizeText(toolHomeSource);
  return {
    ...githubSshToHttpsGitEnv(),
    ...githubGitNonInteractiveEnv(),
    GH_CONFIG_DIR: path.join(home, ".config", "gh"),
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config")
  };
}

function codexGitManagedCommandDockerArgs(command, args = [], {
  cwd = "",
  githubToolHomeSource = "",
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  targetRoot = "",
  toolHomeSource = ""
} = {}) {
  const normalizedCommand = normalizeText(command);
  const normalizedArgs = Array.isArray(args) ? args.map((arg) => String(arg)) : [];
  const normalizedTargetRoot = path.resolve(normalizeText(targetRoot));
  const normalizedCwd = path.resolve(normalizeText(cwd) || normalizedTargetRoot);
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    "-i",
    "--label",
    studioDockerLabel("kind", "codex-git-command"),
    ...studioDaemonDockerLabels().flatMap((label) => ["--label", label]),
    ...studioToolHomeDockerArgs({
      githubToolHomeSource,
      source: toolHomeSource
    }),
    ...hostUserIdentityEnvArgs(),
    ...githubSshToHttpsGitDockerEnvArgs(),
    ...githubGitNonInteractiveDockerEnvArgs(),
    "-v",
    `${normalizedTargetRoot}:/workspace`,
    "-v",
    `${normalizedTargetRoot}:${normalizedTargetRoot}`,
    ...gitToolchainMountArgs(normalizedTargetRoot),
    ...targetRuntimeNetworkDockerArgs(normalizedTargetRoot),
    "-w",
    normalizedCwd,
    image,
    "bash",
    "-lc",
    studioUserStartupScript([normalizedCommand, ...normalizedArgs])
  ];
}

function createCodexGitManagedCommandRunner({
  ensureRuntimeNetwork = ensureTargetRuntimeNetwork,
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  runDockerCommand = runHostCommand
} = {}) {
  return async (command, args = [], {
    cwd = "",
    githubToolHomeSource = "",
    input,
    targetRoot = "",
    timeout = CODEX_GIT_COMMAND_TIMEOUT_MS,
    toolHomeSource = ""
  } = {}) => {
    if (targetRoot) {
      await ensureRuntimeNetwork(targetRoot);
    }
    return runDockerCommand("docker", codexGitManagedCommandDockerArgs(command, args, {
      cwd,
      githubToolHomeSource,
      image,
      targetRoot,
      toolHomeSource
    }), {
      input,
      timeout
    });
  };
}

function commandOutput(result = {}) {
  return normalizeText(result.stderr || result.stdout || result.output || result.error);
}

function commandOutputTail(value = "", limit = 1000) {
  return sanitizeLogText(normalizeText(value)).slice(-limit);
}

function commandArgv(command = "", args = []) {
  return [
    normalizeText(command),
    ...(Array.isArray(args) ? args.map((arg) => String(arg)) : [])
  ].filter(Boolean);
}

function commandSummary(command = "", args = []) {
  return commandArgv(command, args)
    .map((part) => sanitizeLogText(part))
    .join(" ");
}

function gitCommandPurpose(command = "", args = [], fallback = "") {
  const explicit = normalizeText(fallback);
  if (explicit) {
    return explicit;
  }
  const normalizedCommand = normalizeText(command);
  const primaryArg = normalizeText(Array.isArray(args) ? args[0] : "");
  if (normalizedCommand && primaryArg) {
    return `codex-git-command.${normalizedCommand}.${primaryArg}`;
  }
  return normalizedCommand ? `codex-git-command.${normalizedCommand}` : "codex-git-command";
}

function logGitCommandResult(logger, result = {}, fields = {}) {
  const ok = result?.ok !== false && Number(result?.exitCode || 0) === 0;
  const args = Array.isArray(fields.args) ? fields.args : [];
  const stdoutTail = ok ? "" : commandOutputTail(result.stdout);
  const stderrTail = ok ? "" : commandOutputTail(result.stderr);
  const outputTail = ok ? "" : commandOutputTail(commandOutput(result));
  return logOperationalEvent(logger, ok ? "info" : "warn", {
    code: result?.code || "",
    command: normalizeText(fields.command),
    commandKind: normalizeText(fields.command),
    commandSummary: commandSummary(fields.command, args),
    component: "vibe64.codex_git_command",
    cwd: normalizeText(fields.cwd),
    durationMs: Number(fields.durationMs || 0),
    errorCode: normalizeText(result?.errorCode || result?.code),
    event: "vibe64.codex_git_command.finished",
    exitCode: Number(result?.exitCode ?? (ok ? 0 : 1)),
    outputTail,
    purpose: gitCommandPurpose(fields.command, args, fields.purpose),
    ok,
    sessionId: normalizeText(fields.sessionId),
    signal: normalizeText(result?.signal),
    source: normalizeText(fields.actorSource),
    sourceRoot: normalizeText(fields.workdir || fields.cwd),
    stderrTail,
    stdoutTail,
    targetRoot: normalizeText(fields.targetRoot),
    timedOut: result?.timedOut === true,
    userKey: normalizeText(fields.actorUserKey)
  }, "Vibe64 Codex git command finished.");
}

function createCodexGitCommandService({
  authorizeActorAccess = null,
  env = process.env,
  logger = null,
  projectService,
  runCommand = null
} = {}) {
  const commandRunner = typeof runCommand === "function"
    ? runCommand
    : createCodexGitManagedCommandRunner();
  async function run(input = {}) {
    const startedAtMs = Date.now();
    const command = normalizeText(input.command);
    const args = Array.isArray(input.args) ? input.args.map((arg) => String(arg)) : [];
    const sessionId = normalizeText(input.sessionId);
    const baseFields = {
      args,
      command,
      purpose: normalizeText(input.purpose),
      sessionId
    };
    const finish = (result = {}, fields = {}) => {
      logGitCommandResult(logger, result, {
        ...baseFields,
        ...fields,
        durationMs: Date.now() - startedAtMs
      });
      return result;
    };
    if (!CODEX_GIT_COMMAND_WRAPPER_NAMES.includes(command)) {
      return finish(responseError("Codex only exposes git and gh through this command path.", "vibe64_codex_git_command_invalid"));
    }
    if (!sessionId) {
      return finish(responseError("Codex git command session id is required.", "vibe64_codex_git_command_session_required"));
    }
    const runtime = await projectService.createRuntime({
      input: {
        sessionId
      }
    });
    const session = await runtime.getSession(sessionId);
    const actor = gitCommandActorFromSession(session);
    if (actor.ok === false) {
      return finish(actor);
    }
    if (actor.sessionId !== sessionId) {
      return finish(responseError("Codex git command actor belongs to a different session.", "vibe64_codex_git_actor_session_mismatch"), actor);
    }
    const providerHomesRoot = normalizeText(env?.[VIBE64_PROVIDER_HOMES_ROOT_ENV]);
    const codexToolHomeSource = codexProviderHome(providerHomesRoot);
    if (!codexToolHomeSource) {
      return finish(responseError(
        "A Vibe64 provider homes root is required for Codex git commands.",
        "vibe64_codex_tool_home_required"
      ), actor);
    }
    const toolHome = resolveGithubToolHomeForStoredActor({
      accountMode: actor.actorScope,
      env,
      ownerEmail: actor.actorEmail,
      ownerUserKey: actor.actorUserKey,
      providerHomesRoot
    });
    if (toolHome.ok === false) {
      return finish(toolHome, actor);
    }
    const cwd = validateCommandCwd(input.cwd, actor);
    if (cwd.ok === false) {
      return finish(cwd, actor);
    }
    const authorize = typeof authorizeActorAccess === "function"
      ? authorizeActorAccess
      : typeof projectService?.authorizeCodexGitActorAccess === "function"
        ? projectService.authorizeCodexGitActorAccess.bind(projectService)
        : null;
    if (authorize) {
      const access = await authorize({
        actor,
        session,
        targetRoot: actor.targetRoot,
        workdir: cwd.cwd
      });
      if (access === false || access?.ok === false) {
        return finish(responseError(
          access?.error || "This Codex GitHub actor no longer has access to this project session.",
          access?.code || "vibe64_codex_git_actor_access_denied",
          {
            statusCode: access?.statusCode || 403
          }
        ), {
          ...actor,
          cwd: cwd.cwd
        });
      }
    }
    const inputBuffer = normalizeText(input.inputBase64)
      ? Buffer.from(normalizeText(input.inputBase64), "base64")
      : undefined;
    const result = await commandRunner(command, args, {
      cwd: cwd.cwd,
      env: githubCommandEnv(toolHome.toolHomeSource),
      githubToolHomeSource: toolHome.toolHomeSource,
      input: inputBuffer,
      targetRoot: actor.targetRoot,
      timeout: CODEX_GIT_COMMAND_TIMEOUT_MS,
      toolHomeSource: codexToolHomeSource
    });
    return finish({
      code: result.ok ? "" : "vibe64_codex_git_command_failed",
      error: result.ok ? "" : commandOutput(result),
      exitCode: Number(result.exitCode ?? (result.ok ? 0 : 1)),
      ok: result.ok === true,
      signal: result.signal || "",
      stderr: result.stderr || "",
      stdout: result.stdout || "",
      timedOut: result.timedOut === true
    }, {
      ...actor,
      cwd: cwd.cwd
    });
  }

  return {
    run
  };
}

function verifyRequestToken(input = {}, expectedToken = "") {
  return normalizeText(input.token) && normalizeText(input.token) === normalizeText(expectedToken);
}

function commandServerToken({
  sessionId = "",
  socketPath = "",
  stateRoot = ""
} = {}) {
  return stableHash([
    "codex-git-command-token",
    normalizeText(sessionId),
    normalizeText(socketPath),
    normalizeText(stateRoot)
  ].join("\n"));
}

async function ensureCodexGitCommandServer({
  commandService,
  env = process.env,
  sessionId = "",
  stateRoot = ""
} = {}) {
  const socketPath = commandSocketHostPath({
    env,
    sessionId,
    stateRoot
  });
  const existing = commandServers.get(socketPath);
  if (existing?.commandService === commandService) {
    return existing;
  }
  if (existing?.server) {
    await new Promise((resolve) => {
      existing.server.close(() => resolve());
    }).catch(() => null);
    commandServers.delete(socketPath);
  }
  await mkdir(path.dirname(socketPath), {
    recursive: true
  });
  await rm(socketPath, {
    force: true
  });
  const token = commandServerToken({
    sessionId,
    socketPath,
    stateRoot
  });
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/codex-git-command/run") {
        const input = await readRequestJson(request);
        if (!verifyRequestToken(input, token)) {
          sendJson(response, 403, responseError("Codex git command token is invalid.", "vibe64_codex_git_command_token_invalid"));
          return;
        }
        sendJson(response, 200, await commandService.run(input));
        return;
      }
      sendJson(response, 404, responseError("Unknown Codex git command route.", "vibe64_codex_git_command_route_not_found"));
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_codex_git_command_request_failed",
        fallbackMessage: "Codex git command request failed."
      });
      sendJson(response, vibe64StatusCode(payload), payload);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref?.();
  const stored = {
    commandService,
    server,
    token
  };
  commandServers.set(socketPath, stored);
  return stored;
}

function commandEnvironment({
  sessionId = "",
  stateRoot = "",
  token = ""
} = {}) {
  const containerDir = wrapperContainerDir({
    sessionId,
    stateRoot
  });
  const env = {
    [VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV]: normalizeText(sessionId),
    [VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV]: commandSocketContainerPath({
      sessionId,
      stateRoot
    }),
    [VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV]: normalizeText(token),
    [VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]: containerDir
  };
  return env;
}

async function prepareCodexGitCommand({
  commandService,
  env = process.env,
  sessionId = "",
  stateRoot = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  if (!commandService || !normalizedSessionId) {
    return {
      env: {},
      ok: false
    };
  }
  await prepareCodexAttachmentRoot({
    env
  });
  await writeWrappers({
    env,
    sessionId: normalizedSessionId,
    stateRoot
  });
  const server = await ensureCodexGitCommandServer({
    commandService,
    env,
    sessionId: normalizedSessionId,
    stateRoot
  });
  return {
    env: commandEnvironment({
      sessionId: normalizedSessionId,
      stateRoot,
      token: server.token
    }),
    hostSocketPath: commandSocketHostPath({
      env,
      sessionId: normalizedSessionId,
      stateRoot
    }),
    hostWrapperDir: commandHostDir({
      env,
      sessionId: normalizedSessionId,
      stateRoot
    }),
    ok: true
  };
}

export {
  VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV,
  VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV,
  VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV,
  VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV,
  codexGitManagedCommandDockerArgs,
  createCodexGitCommandService,
  createCodexGitManagedCommandRunner,
  gitCommandActorFromSession,
  githubCommandEnv,
  prepareCodexGitCommand
};
