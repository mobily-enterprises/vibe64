import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  normalizeText,
  resolveGithubHomeForStoredActor,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS,
  sessionGitCommandActorFromMetadata,
  sessionRequiresGithubActor
} from "./sessionGitCommandActor.js";
import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  pathInsideOrEqual
} from "./terminalShared.js";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import {
  closeUnixJsonCommandServer,
  listenUnixJsonCommandServer,
  readJsonCommandRequest,
  removeDeadUnixJsonCommandSocket,
  sendJsonCommandResponse,
  shortCommandHash,
  unixJsonCommandServerIsHealthy
} from "./unixJsonCommand.js";

const CODEX_GIT_COMMAND_DIR_NAME = "codex-git-command";
const CODEX_GIT_COMMAND_WRAPPER_NAMES = Object.freeze(["git", "gh"]);
const CODEX_GIT_COMMAND_INPUT_MAX_BYTES = 20 * 1024 * 1024;
const CODEX_GIT_COMMAND_TIMEOUT_MS = 120_000;
const CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS = 2000;
const CODEX_LOCAL_GIT_OPERATIONS = new Set([
  "add",
  "am",
  "apply",
  "archive",
  "bisect",
  "blame",
  "branch",
  "bundle",
  "cat-file",
  "check-attr",
  "check-ignore",
  "check-mailmap",
  "check-ref-format",
  "checkout",
  "cherry",
  "cherry-pick",
  "clean",
  "commit",
  "config",
  "describe",
  "diff",
  "diff-files",
  "diff-index",
  "diff-tree",
  "fast-export",
  "fast-import",
  "for-each-ref",
  "format-patch",
  "fsck",
  "gc",
  "grep",
  "hash-object",
  "help",
  "index-pack",
  "init",
  "log",
  "ls-files",
  "ls-tree",
  "merge",
  "merge-base",
  "merge-file",
  "merge-index",
  "merge-tree",
  "mktag",
  "mktree",
  "mv",
  "name-rev",
  "notes",
  "prune",
  "read-tree",
  "rebase",
  "reflog",
  "replace",
  "reset",
  "restore",
  "rev-list",
  "rev-parse",
  "rm",
  "show",
  "show-branch",
  "show-ref",
  "sparse-checkout",
  "stage",
  "stash",
  "status",
  "switch",
  "tag",
  "update-index",
  "update-ref",
  "verify-commit",
  "verify-pack",
  "verify-tag",
  "whatchanged",
  "worktree",
  "write-tree"
]);
const GIT_GLOBAL_OPTIONS_WITH_VALUES = new Set([
  "-C",
  "-c",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree"
]);
const VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV = "VIBE64_CODEX_GIT_COMMAND_SESSION_ID";
const VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV = "VIBE64_CODEX_GIT_COMMAND_SOCKET";
const VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV = "VIBE64_CODEX_GIT_COMMAND_TOKEN";
const VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV = "VIBE64_CODEX_GIT_COMMAND_GENERATION";
const VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV = "VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR";
const CODEX_GIT_COMMAND_METADATA_NAMES = Object.freeze([
  ...SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS,
  "agent_identity_conversation_id",
  "github_repository",
  "source_remote_url"
]);

const commandServers = new Map();
const commandServerPreparations = new Map();

function attachmentRuntimeKey({
  sessionId = "",
  stateRoot = ""
} = {}) {
  return shortCommandHash([
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

function commandSocketHostPath({
  env = process.env,
  sessionId = "",
  stateRoot = ""
} = {}) {
  const owner = typeof process.getuid === "function" ? process.getuid() : "user";
  const socketRoot = path.resolve(normalizeText(env.TMPDIR) || tmpdir());
  return path.join(
    socketRoot,
    `v64-git-${owner}-${attachmentRuntimeKey({ sessionId, stateRoot })}.sock`
  );
}

function wrapperHostPath(options = {}, command = "") {
  return path.join(commandHostDir(options), command);
}

async function readRequestJson(request) {
  return readJsonCommandRequest(request, {
    invalidJsonError: {
      code: "vibe64_codex_git_command_invalid_json",
      message: "Codex git command input must be valid JSON."
    },
    maxBytes: CODEX_GIT_COMMAND_INPUT_MAX_BYTES,
    tooLargeError: {
      code: "vibe64_codex_git_command_input_too_large",
      message: "Codex git command input is too large."
    }
  });
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
      socketPath,
      timeout: 5000
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
    request.once("timeout", () => {
      const error = new Error("Managed Git control timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.end(requestBody);
  });
}

if (!allowedCommands.has(command)) {
  fail("Codex git command wrapper was invoked with an unsupported command.");
}

const socketPath = process.env.${VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV} || "";
const sessionId = process.env.${VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV} || "";
const token = process.env.${VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV} || "";
const generationId = process.env.${VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV} || "";
const noStdinParentPid = Number.parseInt(
  process.env.VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID || "",
  10
);

if (!socketPath || !sessionId || !token || !generationId) {
  fail("vibe64_agent_control_unavailable: Managed Git control identity is unavailable. Reconnect the assistant.");
}

const inputBase64 = noStdinParentPid === process.ppid
  ? ""
  : await readStdinBase64();
const response = await requestSocket({
  socketPath,
  body: {
    args: process.argv.slice(2),
    command,
    cwd: process.cwd(),
    generationId,
    inputBase64,
    sessionId,
    token
  }
}).catch((error) => {
  if (["ECONNREFUSED", "ENOENT", "ENOTSOCK", "ETIMEDOUT"].includes(String(error?.code || ""))) {
    fail("vibe64_agent_control_unavailable: Managed Git control is unavailable. Reconnect the assistant.");
  }
  fail(error?.message || error || "Codex git command request failed.");
});

let payload = {};
try {
  payload = JSON.parse(response.text || "{}");
} catch {
  fail(response.text || "Codex git command returned invalid JSON.");
}

if (payload.stdout) {
  process.stdout.write(Buffer.from(String(payload.stdout), payload.outputEncoding === "base64" ? "base64" : "utf8"));
}
if (payload.stderr) {
  process.stderr.write(Buffer.from(String(payload.stderr), payload.outputEncoding === "base64" ? "base64" : "utf8"));
}
if (payload.ok === false && !payload.stderr && payload.error && payload.code !== "vibe64_codex_git_command_failed") {
  const prefix = payload.code === "vibe64_agent_control_unavailable"
    ? "vibe64_agent_control_unavailable: "
    : "";
  process.stderr.write(prefix + String(payload.error) + "\\n");
}

const exitCode = Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0);
process.exitCode = exitCode;
`;
}

async function writeWrappers(options = {}) {
  const dir = commandHostDir(options);
  await mkdir(dir, {
    recursive: true
  });
  const source = wrapperScriptSource();
  await Promise.all(CODEX_GIT_COMMAND_WRAPPER_NAMES.map(async (command) => {
    const filePath = wrapperHostPath(options, command);
    await writeExecutableFileIfChanged(filePath, source);
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

function noGithubGitCommandActorFromSession(session = {}, {
  command = ""
} = {}) {
  if (normalizeText(command) === "gh") {
    return responseError(
      "GitHub CLI is only available for GitHub repository sessions.",
      "vibe64_codex_git_command_github_unavailable",
      {
        statusCode: 403
      }
    );
  }
  const sessionId = normalizeText(session.sessionId || session.id);
  const sourceRoot = sessionSourcePath(session);
  if (!sessionId || !sourceRoot) {
    return responseError(
      "Codex git commands for non-GitHub sessions require a session source path.",
      "vibe64_codex_git_command_source_missing"
    );
  }
  return {
    actorReason: "repository_profile",
    actorScope: "",
    actorSource: "session_repository_profile",
    actorUserKey: "",
    githubRequired: false,
    sessionId,
    sourceRoot,
    threadId: normalizeText(session.metadata?.agent_identity_conversation_id),
    workdir: sourceRoot,
    ok: true
  };
}

function gitCommandActorFromSession(session = {}, {
  command = ""
} = {}) {
  if (!sessionRequiresGithubActor(session)) {
    return noGithubGitCommandActorFromSession(session, {
      command
    });
  }
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

async function readGitCommandSession(projectService = {}, sessionId = "") {
  if (typeof projectService.createSessionStore !== "function") {
    throw new TypeError("Codex git commands require the project session-store boundary.");
  }
  const store = await projectService.createSessionStore({
    sessionId
  });
  if (
    typeof store?.readSessionSourceDescriptor !== "function" ||
    typeof store?.readMetadataValue !== "function"
  ) {
    throw new TypeError("Codex git commands require bounded session source and metadata reads.");
  }
  const [
    sourceDescriptor,
    metadataEntries
  ] = await Promise.all([
    store.readSessionSourceDescriptor(sessionId),
    Promise.all(CODEX_GIT_COMMAND_METADATA_NAMES.map(async (name) => [
      name,
      await store.readMetadataValue(sessionId, name)
    ]))
  ]);
  return {
    ...sourceDescriptor,
    id: sessionId,
    sessionId,
    metadata: {
      ...(sourceDescriptor?.metadata || {}),
      ...Object.fromEntries(metadataEntries)
    }
  };
}

function normalizeHostCwd(cwd = "", actor = {}) {
  const normalizedCwd = normalizeText(cwd);
  if (!normalizedCwd) {
    return actor.workdir || actor.sourceRoot;
  }
  return normalizedCwd;
}

function validateCommandCwd(cwd = "", actor = {}) {
  const resolvedCwd = path.resolve(normalizeHostCwd(cwd, actor));
  const sourceRoot = path.resolve(actor.sourceRoot);
  if (!pathInsideOrEqual(sourceRoot, resolvedCwd)) {
    return responseError(
      "Codex git commands must run inside the active project.",
      "vibe64_codex_git_command_cwd_invalid",
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

function localGitCommandToolHome() {
  return {
    ok: true,
    toolHomeSource: homedir()
  };
}

function commandOutput(result = {}) {
  const captured = result.stderr || result.stdout;
  return normalizeText(captured
    ? Buffer.from(captured, result.outputEncoding === "base64" ? "base64" : "utf8").toString("utf8")
    : result.error || result.output);
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

function gatewayGitIdentityUserKey(session = {}, actor = {}, toolHome = {}) {
  return actor.githubRequired === false
    ? normalizeText(session.metadata?.session_git_command_actor_user_key)
    : normalizeText(toolHome.ownerUserKey || actor.actorUserKey);
}

function gitOperation(args = []) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg)) : [];
  for (let index = 0; index < values.length; index += 1) {
    const value = normalizeText(values[index]);
    if (!value) {
      continue;
    }
    if (GIT_GLOBAL_OPTIONS_WITH_VALUES.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith("--git-dir=") ||
      value.startsWith("--work-tree=") ||
      value.startsWith("--namespace=") ||
      value.startsWith("--exec-path=") ||
      value.startsWith("--super-prefix=")) {
      continue;
    }
    if (value.startsWith("-")) {
      continue;
    }
    return value;
  }
  return "";
}

function commandRequiresGithubToken(command = "", args = []) {
  if (normalizeText(command) === "gh") {
    return true;
  }
  const operation = gitOperation(args);
  return !operation || !CODEX_LOCAL_GIT_OPERATIONS.has(operation);
}

async function readGithubToken({
  actor = {},
  gatewayCommandRunner,
  session = {},
  toolHome = {}
} = {}) {
  const userKey = gatewayGitIdentityUserKey(session, actor, toolHome);
  const credentialRoot = normalizeText(toolHome.toolHomeSource);
  const result = await gatewayCommandRunner({
    actor: "owner-user",
    allowedRoots: [credentialRoot],
    args: ["auth", "token"],
    command: "gh",
    cwd: credentialRoot,
    envPolicy: "auth",
    gitTransport: "none",
    mode: "capture",
    project: {
      ownerUserKey: toolHome.ownerUserKey
    },
    purpose: "github-api",
    runtimes: ["gh"],
    session: {
      metadata: session.metadata || {},
      sessionId: actor.sessionId
    },
    timeout: CODEX_GIT_COMMAND_TIMEOUT_MS,
    userKey
  });
  const token = result?.ok === true ? normalizeText(result.stdout) : "";
  if (!token) {
    const error = normalizeText(result?.stderr || result?.error);
    return responseError(
      error || "GitHub authentication is not ready for this Vibe64 account.",
      "vibe64_codex_git_command_github_auth_unavailable",
      { statusCode: 403 }
    );
  }
  return {
    ok: true,
    token
  };
}

function logGitCommandResult(logger, result = {}, fields = {}) {
  const ok = result?.ok !== false && Number(result?.exitCode || 0) === 0;
  const args = Array.isArray(fields.args) ? fields.args : [];
  const stdoutTail = ok ? "" : commandOutputTail(commandOutput({ stdout: result.stdout, outputEncoding: result.outputEncoding }));
  const stderrTail = ok ? "" : commandOutputTail(commandOutput({ stderr: result.stderr, outputEncoding: result.outputEncoding }));
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
    timedOut: result?.timedOut === true,
    userKey: normalizeText(fields.actorUserKey)
  }, "Vibe64 Codex git command finished.");
}

function createCodexGitCommandService({
  authorizeActorAccess = null,
  env = process.env,
  logger = null,
  projectService,
  runGatewayCommand = runVibe64Command
} = {}) {
  const gatewayCommandRunner = typeof runGatewayCommand === "function" ? runGatewayCommand : runVibe64Command;

  async function sessionWorkSaveContext({
    session: suppliedSession = null,
    sessionId: suppliedSessionId = ""
  } = {}) {
    const sessionId = normalizeText(suppliedSessionId || suppliedSession?.sessionId || suppliedSession?.id);
    if (!sessionId) {
      return responseError(
        "Session Save requires a session id.",
        "vibe64_session_save_session_required"
      );
    }
    const session = suppliedSession || await readGitCommandSession(projectService, sessionId);
    const actor = gitCommandActorFromSession(session, {
      command: "git"
    });
    if (actor.ok === false) {
      return actor;
    }
    const authorize = typeof authorizeActorAccess === "function"
      ? authorizeActorAccess
      : typeof projectService?.authorizeCodexGitActorAccess === "function"
        ? projectService.authorizeCodexGitActorAccess.bind(projectService)
        : null;
    if (actor.githubRequired !== false && authorize) {
      const access = await authorize({
        actor,
        session,
        sourceRoot: actor.sourceRoot,
        workdir: actor.workdir
      });
      if (access === false || access?.ok === false) {
        return responseError(
          access?.error || "This GitHub actor no longer has access to this project session.",
          access?.code || "vibe64_codex_git_actor_access_denied",
          {
            statusCode: access?.statusCode || 403
          }
        );
      }
    }
    if (actor.githubRequired === false) {
      return {
        actor,
        commandOptions: {},
        identity: {
          email: "vibe64@localhost",
          name: "Vibe64 Save"
        },
        ok: true,
        runCommand: gatewayCommandRunner
      };
    }
    const toolHome = await resolveGithubHomeForStoredActor({
      accountMode: actor.actorScope,
      env,
      ownerUserKey: actor.actorUserKey
    });
    if (toolHome.ok === false) {
      return toolHome;
    }
    const githubToken = await readGithubToken({
      actor,
      gatewayCommandRunner,
      session,
      toolHome
    });
    if (githubToken.ok === false) {
      return githubToken;
    }
    const actorLabel = normalizeText(actor.actorUserKey) || "Vibe64 user";
    return {
      actor,
      commandOptions: {
        actor: "app",
        gitAuthToken: githubToken.token,
        gitTransport: "github-token",
        purpose: "github",
        userKey: gatewayGitIdentityUserKey(session, actor, toolHome)
      },
      identity: {
        email: `${actorLabel.replace(/[^a-z0-9._-]+/giu, "-")}@users.noreply.vibe64.dev`,
        name: actorLabel
      },
      ok: true,
      runCommand: gatewayCommandRunner
    };
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const command = normalizeText(input.command);
    let args = Array.isArray(input.args) ? input.args.map((arg) => String(arg)) : [];
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
    // Codex probes Git frequently while its TUI is active. Git authorization
    // owns only source and actor metadata; constructing a complete session runtime here
    // previously reread complete conversation history for every
    // `git status` subcommand (hundreds of MB every few seconds on long-lived
    // sessions). Keep this hot path structurally bounded—never hide a full
    // session read here behind caching or throttling.
    const session = await readGitCommandSession(projectService, sessionId);
    const actor = gitCommandActorFromSession(session, {
      command
    });
    if (actor.ok === false) {
      return finish(actor);
    }
    if (actor.sessionId !== sessionId) {
      return finish(responseError("Codex git command actor belongs to a different session.", "vibe64_codex_git_actor_session_mismatch"), actor);
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
    if (actor.githubRequired !== false && authorize) {
      const access = await authorize({
        actor,
        session,
        sourceRoot: actor.sourceRoot,
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
    const requiresGithubToken = actor.githubRequired !== false && commandRequiresGithubToken(command, args);
    const toolHome = actor.githubRequired === false || !requiresGithubToken
      ? localGitCommandToolHome()
      : await resolveGithubHomeForStoredActor({
          accountMode: actor.actorScope,
          env,
          ownerUserKey: actor.actorUserKey
        });
    if (toolHome.ok === false) {
      return finish(toolHome, actor);
    }
    const githubToken = requiresGithubToken
      ? await readGithubToken({
          actor,
          gatewayCommandRunner,
          session,
          toolHome
        })
      : { ok: true, token: "" };
    if (githubToken.ok === false) {
      return finish(githubToken, actor);
    }
    const inputBuffer = normalizeText(input.inputBase64)
      ? Buffer.from(normalizeText(input.inputBase64), "base64")
      : undefined;
    const gatewayUserKey = gatewayGitIdentityUserKey(session, actor, toolHome);
    const result = await gatewayCommandRunner({
      actor: "app",
      allowedRoots: [
        actor.sourceRoot
      ],
      args,
      command,
      cwd: cwd.cwd,
      env: command === "gh" && githubToken.token
        ? { GH_TOKEN: githubToken.token }
        : {},
      envPolicy: "auth",
      gitSafeDirectories: [
        actor.sourceRoot,
        cwd.cwd
      ],
      gitAuthToken: command === "git" ? githubToken.token : "",
      gitTransport: command === "git" && githubToken.token ? "github-token" : "none",
      input: inputBuffer,
      mode: "capture",
      outputEncoding: "base64",
      project: {
        ownerUserKey: actor.githubRequired === false
          ? ""
          : toolHome.ownerUserKey || actor.actorUserKey,
        tenant: env.VIBE64_WORKSPACE || env.VIBE64_RUNTIME_NAMESPACE || ""
      },
      purpose: githubToken.token ? "github" : "codex",
      runtimes: ["git", "gh"],
      session: {
        metadata: session.metadata || {},
        sessionId,
        sourcePath: actor.sourceRoot
      },
      timeout: CODEX_GIT_COMMAND_TIMEOUT_MS,
      userKey: gatewayUserKey
    });
    return finish({
      code: result.ok ? "" : result.code || "vibe64_codex_git_command_failed",
      error: result.ok ? "" : commandOutput(result),
      exitCode: Number(result.exitCode ?? (result.ok ? 0 : 1)),
      ok: result.ok === true,
      outputEncoding: result.outputEncoding || "utf8",
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
    run,
    sessionWorkSaveContext
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
  return shortCommandHash([
    "codex-git-command-token",
    normalizeText(sessionId),
    normalizeText(socketPath),
    normalizeText(stateRoot)
  ].join("\n"));
}

async function replaceCodexGitCommandServer({
  commandService,
  sessionId = "",
  socketPath = "",
  stateRoot = ""
} = {}) {
  const existing = commandServers.get(socketPath);
  await closeUnixJsonCommandServer(commandServers, socketPath, existing);
  await mkdir(path.dirname(socketPath), {
    recursive: true
  });
  await removeDeadUnixJsonCommandSocket(socketPath, {
    healthPath: "/codex-git-command/health",
    ownerErrorMessage: "The managed Git socket is owned by an unverified listener.",
    timeoutMs: CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS
  });
  const token = commandServerToken({
    sessionId,
    socketPath,
    stateRoot
  });
  const generationId = randomUUID();
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "POST" && [
        "/codex-git-command/health",
        "/codex-git-command/run"
      ].includes(request.url)) {
        const input = await readRequestJson(request);
        if (
          !verifyRequestToken(input, token) ||
          normalizeText(input.sessionId) !== normalizeText(sessionId) ||
          normalizeText(input.generationId) !== generationId
        ) {
          sendJsonCommandResponse(response, 409, responseError(
            "Managed Git control generation is no longer current. Reconnect the assistant.",
            "vibe64_agent_control_unavailable"
          ));
          return;
        }
        if (request.url === "/codex-git-command/health") {
          sendJsonCommandResponse(response, 200, {
            generationId,
            ok: true,
            sessionId: normalizeText(sessionId)
          });
          return;
        }
        sendJsonCommandResponse(response, 200, await commandService.run(input));
        return;
      }
      sendJsonCommandResponse(response, 404, responseError("Unknown Codex git command route.", "vibe64_codex_git_command_route_not_found"));
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_codex_git_command_request_failed",
        fallbackMessage: "Codex git command request failed."
      });
      sendJsonCommandResponse(response, vibe64StatusCode(payload), payload);
    }
  });
  await listenUnixJsonCommandServer(server, socketPath);
  const stored = {
    commandService,
    generationId,
    server,
    sessionId: normalizeText(sessionId),
    socketPath,
    token
  };
  commandServers.set(socketPath, stored);
  if (!await unixJsonCommandServerIsHealthy(stored, {
    healthPath: "/codex-git-command/health",
    sessionId,
    socketPath,
    timeoutMs: CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS
  })) {
    await closeUnixJsonCommandServer(commandServers, socketPath, stored);
    await rm(socketPath, {
      force: true
    }).catch(() => null);
    const error = new Error("Managed Git control did not pass its ownership health check.");
    error.code = "vibe64_agent_control_unavailable";
    throw error;
  }
  return stored;
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
  const pending = commandServerPreparations.get(socketPath);
  if (pending?.commandService === commandService) {
    return pending.promise;
  }

  const waitForPrevious = pending?.promise
    ? pending.promise.catch(() => null)
    : Promise.resolve();
  const preparation = {
    commandService,
    promise: null
  };
  preparation.promise = waitForPrevious.then(async () => {
    const existing = commandServers.get(socketPath);
    if (
      existing?.commandService === commandService &&
      await unixJsonCommandServerIsHealthy(existing, {
        healthPath: "/codex-git-command/health",
        sessionId,
        socketPath,
        timeoutMs: CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS
      })
    ) {
      return existing;
    }
    return replaceCodexGitCommandServer({
      commandService,
      sessionId,
      socketPath,
      stateRoot
    });
  });
  commandServerPreparations.set(socketPath, preparation);
  try {
    return await preparation.promise;
  } finally {
    if (commandServerPreparations.get(socketPath) === preparation) {
      commandServerPreparations.delete(socketPath);
    }
  }
}

function commandEnvironment({
  env = process.env,
  generationId = "",
  sessionId = "",
  stateRoot = "",
  token = ""
} = {}) {
  const hostDir = commandHostDir({
    env,
    sessionId,
    stateRoot
  });
  const commandEnv = {
    [VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV]: normalizeText(generationId),
    [VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV]: normalizeText(sessionId),
    [VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV]: commandSocketHostPath({
      env,
      sessionId,
      stateRoot
    }),
    [VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV]: normalizeText(token),
    [VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]: hostDir
  };
  return commandEnv;
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
    controlGenerationId: server.generationId,
    env: commandEnvironment({
      env,
      generationId: server.generationId,
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
  VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV,
  VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV,
  VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV,
  VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV,
  VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV,
  createCodexGitCommandService,
  gitCommandActorFromSession,
  prepareCodexGitCommand
};
