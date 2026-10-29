import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { isVibe64DebugLoggingEnabled } from "@local/vibe64-core/shared";

import {
  USER_CREDENTIAL_SCOPE,
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
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import { pathInsideOrEqual } from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import { listGithubRemoteHeads } from "./githubRemoteHeads.js";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import {
  createSessionCommandServers,
  shortCommandHash,
  unixCommandSocketPath
} from "./unixJsonCommand.js";

const CODEX_GIT_COMMAND_DIR_NAME = "codex-git-command";
const CODEX_GIT_COMMAND_WRAPPER_NAMES = Object.freeze(["git", "gh", "vibe64-github"]);
const CODEX_GIT_COMMAND_INPUT_MAX_BYTES = 20 * 1024 * 1024;
const CODEX_GIT_COMMAND_TIMEOUT_MS = 30_000;
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
  "repository_mode",
  "source_remote_url"
]);

const commandServers = createSessionCommandServers({
  routePrefix: "/codex-git-command",
  routes: {
    "/codex-git-command/run": { handle: ({ commandService, input }) => commandService.run(input) }
  },
  label: "Git",
  maxBytes: CODEX_GIT_COMMAND_INPUT_MAX_BYTES,
  invalidJsonError: { code: "vibe64_codex_git_command_invalid_json", message: "Codex git command input must be valid JSON." },
  tooLargeError: { code: "vibe64_codex_git_command_input_too_large", message: "Codex git command input is too large." },
  notFound: responseError("Unknown Codex git command route.", "vibe64_codex_git_command_route_not_found"),
  rejection: {
    statusCode: 409,
    payload: responseError(
      "Managed Git control generation is no longer current. Reconnect the assistant.",
      "vibe64_agent_control_unavailable",
      { diagnostic: { stage: "control", commandSubmitted: false, executionId: null } }
    )
  },
  requestFailure: {
    fallbackCode: "vibe64_codex_git_command_request_failed",
    fallbackMessage: "Codex git command request failed."
  },
  healthTimeoutMs: CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS
});

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
  const hostDir = commandHostDir({ env, sessionId, stateRoot });
  return unixCommandSocketPath(path.join(hostDir, "git-command.sock"), { env });
}

function wrapperHostPath(options = {}, command = "") {
  return path.join(commandHostDir(options), command);
}

function wrapperScriptSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const allowedCommands = new Set(${JSON.stringify(CODEX_GIT_COMMAND_WRAPPER_NAMES)});
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
    let connected = false;
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
      response.once("error", rejectTransport);
    });
    // Only connection establishment has a transport deadline. The executor
    // owns the command budget and must finish cleanup before returning a result.
    const connectionTimer = setTimeout(() => {
      const error = new Error("Managed Git control connection timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, ${CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS});
    function rejectTransport(error) {
      clearTimeout(connectionTimer);
      error.controlConnected = connected;
      reject(error);
    }
    request.once("error", rejectTransport);
    request.once("socket", (socket) => {
      const onConnect = () => {
        connected = true;
        clearTimeout(connectionTimer);
      };
      if (socket.connecting) {
        socket.once("connect", onConnect);
      } else {
        onConnect();
      }
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
  fail("vibe64_agent_control_unavailable: Managed Git control identity is unavailable. The requested command was not submitted. Reconnect the assistant.");
}

const inputBase64 = command === "vibe64-github" || noStdinParentPid === process.ppid
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
  const code = String(error?.code || "UNKNOWN");
  if (error.controlConnected) {
    fail("vibe64_codex_git_command_transport_lost: Managed Git command response was lost (" + code + "). Its outcome is unknown. Check the result before retrying a write.");
  }
  if (["ECONNREFUSED", "ENOENT", "ENOTSOCK", "ETIMEDOUT"].includes(code)) {
    fail("vibe64_agent_control_unavailable: Managed Git control connection failed (" + code + "). The requested command was not submitted. Reconnect the assistant.");
  }
  fail(error?.message || error || "Codex git command request failed.");
});

let payload = {};
try {
  payload = JSON.parse(response.text || "{}");
} catch {
  fail("vibe64_codex_git_command_response_invalid: Managed Git returned an unreadable response. Its outcome is unknown. Check the result before retrying a write.");
}
if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.ok !== "boolean") {
  fail("vibe64_codex_git_command_response_invalid: Managed Git returned an incomplete response. Its outcome is unknown. Check the result before retrying a write.");
}

if (payload.stdout) {
  process.stdout.write(Buffer.from(String(payload.stdout), payload.outputEncoding === "base64" ? "base64" : "utf8"));
}
if (payload.stderr) {
  process.stderr.write(Buffer.from(String(payload.stderr), payload.outputEncoding === "base64" ? "base64" : "utf8"));
}
const timedOut = payload.timedOut === true;
const hasPlatformFailure = payload.ok === false && (timedOut || payload.code !== "vibe64_codex_git_command_failed");
if (timedOut) {
  process.stderr.write(String(payload.code || "vibe64_codex_git_command_timed_out") + ": " + String(payload.error || "Managed Git command timed out.") + "\\n");
} else if (hasPlatformFailure && !payload.stderr && payload.error) {
  const prefix = payload.code ? String(payload.code) + ": " : "";
  process.stderr.write(prefix + String(payload.error) + "\\n");
}
if (hasPlatformFailure) {
  if (payload.diagnostic) {
    process.stderr.write("Managed Git diagnostic: " + JSON.stringify(payload.diagnostic) + "\\n");
  }
  if (payload.diagnostic?.commandSubmitted === false) {
    process.stderr.write("The requested command was not submitted.\\n");
  } else if (timedOut) {
    process.stderr.write("The command's effects are unconfirmed. Check the result before retrying a write.\\n");
  }
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
  if (["gh", "vibe64-github"].includes(normalizeText(command))) {
    return responseError(
      "GitHub commands are only available for GitHub repository sessions.",
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

// Git and gh report a rejected GitHub credential with these messages. The
// session repository operation relays its Git output in its JSON stdout.
const GITHUB_AUTHENTICATION_REJECTED = /Authentication failed|Invalid username or (?:password|token)|returned error: 401|HTTP 401|Bad credentials/iu;

function githubAuthenticationRejected(result = {}) {
  if (result?.ok === true) return false;
  const decode = (value) => value
    ? Buffer.from(value, result.outputEncoding === "base64" ? "base64" : "utf8").toString("utf8")
    : "";
  return GITHUB_AUTHENTICATION_REJECTED.test(
    [decode(result?.stderr), decode(result?.stdout), result?.error, result?.output].filter(Boolean).join("\n")
  );
}

// Each GitHub session-work operation needs the actor's token, and each read is
// a managed job run as that person. One actor's token is reused for a short
// time and dropped when GitHub rejects it. It lives in this process's memory
// only, never on disk or in logs.
const ACTOR_CREDENTIAL_TTL_MS = 5 * 60_000;

function createActorCredentialCache({ now = Date.now, ttlMs = ACTOR_CREDENTIAL_TTL_MS } = {}) {
  const entries = new Map();
  return Object.freeze({
    // load() returns { cacheable, value }; only a settled answer is kept.
    async read(actorKey, load) {
      const at = now();
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= at) entries.delete(key);
      }
      const cached = entries.get(actorKey);
      if (cached) return cached.value;
      const { cacheable, value } = await load();
      if (cacheable) entries.set(actorKey, { expiresAt: now() + ttlMs, value });
      return value;
    },
    drop(actorKey) {
      entries.delete(actorKey);
    }
  });
}

function actorCredentialKey(session = {}, actor = {}, toolHome = {}) {
  return JSON.stringify([gatewayGitIdentityUserKey(session, actor, toolHome), normalizeText(toolHome.toolHomeSource)]);
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
    execution: { label: "Reading your GitHub sign-in", operationId: "github-token-read" },
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
  if (result?.timedOut === true) {
    return responseError(
      "GitHub credential lookup timed out.",
      result.code || "vibe64_codex_git_command_timed_out",
      { exitCode: 1, signal: result.signal || "", timedOut: true, executionId: result.execution?.id }
    );
  }
  const token = result?.ok === true ? normalizeText(result.stdout) : "";
  if (!token) {
    const error = normalizeText(result?.stderr || result?.error);
    return responseError(
      error || "GitHub authentication is not ready for this Vibe64 account.",
      "vibe64_codex_git_command_github_auth_unavailable",
      { statusCode: 403, errorCode: result?.code, executionId: result?.execution?.id }
    );
  }
  return {
    ok: true,
    token
  };
}

// Session-work writes run as the workspace service. Where each person has their
// own OS account (the user credential scope), the commit author's Git name and
// email are read as that person, in their tool home, every time a write that
// creates commits starts, so a name saved in Account applies to the next Save.
// Elsewhere Vibe64 runs as the person and the command env reads their Git
// config itself. Git exits 1 when no name or email is set: the commit then
// carries a stand-in named after the person. A read that fails (a timeout on a
// busy host, any other error) uses that person's last answered read since the
// server started, so load neither fails the Save nor records a stand-in for
// someone whose name Git has; with no answered read yet, the write is refused.
async function commitAuthorOptions({
  actor = {},
  answeredAuthors,
  gatewayCommandRunner,
  logger = null,
  session = {},
  toolHome = {}
} = {}) {
  const credentialRoot = normalizeText(toolHome.toolHomeSource);
  if (toolHome.ok === false || toolHome.credentialScope !== USER_CREDENTIAL_SCOPE || !credentialRoot) {
    return { ok: true, options: {} };
  }
  const userKey = normalizeText(toolHome.ownerUserKey);
  const authorKey = JSON.stringify([userKey, credentialRoot]);
  const result = await gatewayCommandRunner({
    actor: "owner-user",
    allowedRoots: [credentialRoot],
    args: ["config", "--get-regexp", "^user\\.(name|email)$"],
    command: "git",
    cwd: credentialRoot,
    envPolicy: "auth",
    execution: { label: "Reading your Git identity", operationId: "git-identity-read" },
    gitTransport: "none",
    mode: "capture",
    project: {
      ownerUserKey: toolHome.ownerUserKey
    },
    purpose: "account",
    runtimes: ["git"],
    session: {
      metadata: session.metadata || {},
      sessionId: actor.sessionId
    },
    timeout: CODEX_GIT_COMMAND_TIMEOUT_MS,
    userKey
  });
  const unset = result?.ok !== true && Number(result?.exitCode) === 1 && result?.timedOut !== true;
  if (result?.ok !== true && !unset) {
    const answered = answeredAuthors.get(authorKey);
    logOperationalEvent(logger, "warn", {
      code: normalizeText(result?.code) || "vibe64_session_git_author_read_failed",
      component: "vibe64.session_git_author",
      event: "vibe64.session_git_author.read_failed",
      executionId: normalizeText(result?.execution?.id),
      timedOut: result?.timedOut === true,
      usedLastAnswer: Boolean(answered),
      userKey
    }, "The commit author's Git identity could not be read.");
    return answered
      ? { ok: true, options: answered }
      : responseError(
          "Vibe64 could not read your Git name and email just now, so nothing was changed. Try again.",
          "vibe64_session_git_author_unavailable",
          { executionId: normalizeText(result?.execution?.id) || null }
        );
  }
  const values = {};
  for (const line of String(unset ? "" : result.stdout || "").split("\n")) {
    const match = /^user\.(name|email) (.+)$/iu.exec(line.trim());
    if (match) values[match[1].toLowerCase()] = normalizeText(match[2]);
  }
  const options = Object.freeze({
    ...(values.name && values.email ? { personGitIdentity: Object.freeze({ email: values.email, name: values.name }) } : {}),
    userKey
  });
  answeredAuthors.set(authorKey, options);
  return { ok: true, options };
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
    ...(fields.phaseElapsedMs ? { phaseElapsedMs: fields.phaseElapsedMs } : {}),
    errorCode: normalizeText(result?.errorCode || result?.code),
    executionId: normalizeText(result?.executionId),
    event: "vibe64.codex_git_command.finished",
    exitCode: Number(result?.exitCode ?? (ok ? 0 : 1)),
    outputTail,
    purpose: gitCommandPurpose(fields.command, args, fields.purpose),
    ok,
    sessionId: normalizeText(fields.sessionId),
    signal: normalizeText(result?.signal),
    source: normalizeText(fields.actorSource),
    sourceRoot: normalizeText(fields.workdir || fields.cwd),
    stage: normalizeText(fields.stage),
    stderrTail,
    stdoutTail,
    timedOut: result?.timedOut === true,
    userKey: normalizeText(fields.actorUserKey)
  }, "Vibe64 Codex git command finished.");
}

function createCodexGitCommandService({
  authorizeActorAccess = null,
  env = process.env,
  fetch: fetchRemote = globalThis.fetch,
  logger = null,
  now = Date.now,
  projectService,
  runGatewayCommand = runVibe64Command
} = {}) {
  const gatewayCommandRunner = typeof runGatewayCommand === "function" ? runGatewayCommand : runVibe64Command;
  const actorCredentials = createActorCredentialCache({ now });
  // Each person's last answered Git identity read, used only when a read fails.
  // It lives in this process's memory, one entry per person and tool home.
  const answeredAuthors = new Map();

  function readActorToken(credentialKey, request) {
    return actorCredentials.read(credentialKey, async () => {
      const value = await readGithubToken(request);
      return { cacheable: value.ok === true, value };
    });
  }

  // Returns the result unchanged; a GitHub rejection only drops the cached token.
  function dropRejectedCredentials(credentialKey, result) {
    if (githubAuthenticationRejected(result)) actorCredentials.drop(credentialKey);
    return result;
  }

  // Resolved per call: the project service may install its hook after construction.
  function actorAccessAuthorizer() {
    if (typeof authorizeActorAccess === "function") {
      return authorizeActorAccess;
    }
    return typeof projectService?.authorizeCodexGitActorAccess === "function"
      ? projectService.authorizeCodexGitActorAccess.bind(projectService)
      : null;
  }

  async function actorAccessRefusal(authorize, { actor, deniedMessage, session, workdir }) {
    const access = await authorize({
      actor,
      session,
      sourceRoot: actor.sourceRoot,
      workdir
    });
    if (access !== false && access?.ok !== false) {
      return null;
    }
    return responseError(
      access?.error || deniedMessage,
      access?.code || "vibe64_codex_git_actor_access_denied",
      {
        statusCode: access?.statusCode || 403
      }
    );
  }

  // `createsCommits` marks a write that records commits (Save, Update, Merge
  // contribution), whose options then carry their author: a GitHub session's
  // Git actor, whose credential publishes them, or for any other session
  // `vibe64User`, the person asking. Checks and probes read nobody's identity.
  async function sessionWorkSaveContext({
    createsCommits = false,
    session: suppliedSession = null,
    sessionId: suppliedSessionId = "",
    vibe64User = null
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
    const authorize = actor.githubRequired !== false && actorAccessAuthorizer();
    if (authorize) {
      const refusal = await actorAccessRefusal(authorize, {
        actor,
        deniedMessage: "This GitHub actor no longer has access to this project session.",
        session,
        workdir: actor.workdir
      });
      if (refusal) {
        return refusal;
      }
    }
    const noCommitAuthor = { ok: true, options: {} };
    if (actor.githubRequired === false) {
      const commitAuthor = createsCommits
        ? await commitAuthorOptions({
            actor,
            answeredAuthors,
            gatewayCommandRunner,
            logger,
            session,
            toolHome: await resolveGithubHomeForStoredActor({
              env,
              ownerUserKey: normalizeText(vibe64User?.username || vibe64User?.osUsername)
            })
          })
        : noCommitAuthor;
      if (commitAuthor.ok === false) {
        return commitAuthor;
      }
      return {
        actor,
        commandOptions: { ...commitAuthor.options },
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
    const credentialKey = actorCredentialKey(session, actor, toolHome);
    const githubToken = await readActorToken(credentialKey, {
      actor,
      gatewayCommandRunner,
      session,
      toolHome
    });
    if (githubToken.ok === false) {
      return githubToken;
    }
    const commitAuthor = createsCommits
      ? await commitAuthorOptions({ actor, answeredAuthors, gatewayCommandRunner, logger, session, toolHome })
      : noCommitAuthor;
    if (commitAuthor.ok === false) {
      return commitAuthor;
    }
    return {
      actor,
      commandOptions: {
        actor: "app",
        gitAuthToken: githubToken.token,
        gitTransport: "github-token",
        purpose: "github",
        userKey: gatewayGitIdentityUserKey(session, actor, toolHome),
        ...commitAuthor.options
      },
      ok: true,
      // The update probe's GitHub head read, made in this process: the token
      // goes only into that request's Authorization header, and GitHub's
      // rejection drops it as a rejected Git command's does.
      readRemoteHeads: async (remoteUrl, refs, { timeoutMs } = {}) => {
        try {
          return await listGithubRemoteHeads({ fetch: fetchRemote, refs, remoteUrl, timeoutMs, token: githubToken.token });
        } catch (error) {
          if (error?.authenticationRejected === true) actorCredentials.drop(credentialKey);
          throw error;
        }
      },
      runCommand: async (request) => dropRejectedCredentials(credentialKey, await gatewayCommandRunner(request))
    };
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const startedAt = performance.now();
    const phaseElapsedMs = isVibe64DebugLoggingEnabled({ env, level: logger?.level }) ? {} : null;
    let stage = "session";
    let commandSubmitted = false;
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
        stage,
        phaseElapsedMs,
        durationMs: Date.now() - startedAtMs
      });
      if (result.ok !== false) {
        return result;
      }
      return {
        ...result,
        diagnostic: {
          stage,
          ...(command === "vibe64-github" ? {} : { budgetMs: CODEX_GIT_COMMAND_TIMEOUT_MS, commandSubmitted }),
          elapsedMs: Math.round(performance.now() - startedAt),
          code: normalizeText(result.errorCode || result.code),
          executionId: normalizeText(result.executionId) || null
        }
      };
    };
    const runWithinBudget = (request) => {
      const timeout = Math.floor(CODEX_GIT_COMMAND_TIMEOUT_MS - (performance.now() - startedAt));
      if (timeout <= 0) {
        return Promise.resolve(responseError(
          "Managed Git command exhausted its 30-second execution budget.",
          "vibe64_codex_git_command_timed_out",
          { exitCode: 1, timedOut: true }
        ));
      }
      if (stage === "command") {
        commandSubmitted = true;
      }
      return gatewayCommandRunner({ ...request, timeout, signal: input.signal });
    };
    if (!CODEX_GIT_COMMAND_WRAPPER_NAMES.includes(command)) {
      return finish(responseError("This command path exposes git, gh and vibe64-github.", "vibe64_codex_git_command_invalid"));
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
    if (phaseElapsedMs) phaseElapsedMs.session = Math.round(performance.now() - startedAt);
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
    const authorize = actor.githubRequired !== false && actorAccessAuthorizer();
    if (authorize) {
      stage = "authorization";
      const refusal = await actorAccessRefusal(authorize, {
        actor,
        deniedMessage: "This Codex GitHub actor no longer has access to this project session.",
        session,
        workdir: cwd.cwd
      });
      if (refusal) {
        return finish(refusal, {
          ...actor,
          cwd: cwd.cwd
        });
      }
    }
    if (command === "vibe64-github") {
      stage = "github-helper";
      const usage = "Usage: vibe64-helper github refresh | vibe64-helper github issue-link <number>";
      if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
        return finish({ ok: true, exitCode: 0, stdout: `${usage}\n` }, actor);
      }
      if (args.length === 2 && args[0] === "issue-link" && /^[1-9]\d*$/u.test(args[1]) && Number.isSafeInteger(Number(args[1]))) {
        const project = await projectService.readCurrentProject();
        const slug = normalizeText(project.slug);
        if (!slug) {
          return finish(responseError("The current project has no issue link.", "vibe64_github_issue_link_unavailable"), actor);
        }
        return finish({
          ok: true,
          exitCode: 0,
          stdout: `/app/project/${encodeURIComponent(slug)}/dashboard/issues?issue=${args[1]}\n`
        }, actor);
      }
      if (args.length !== 1 || args[0] !== "refresh") {
        return finish(responseError(usage, "vibe64_github_refresh_input_invalid"), actor);
      }
      await projectService.refreshGithub();
      return finish({
        ok: true,
        exitCode: 0,
        stdout: "Vibe64 GitHub refresh requested.\n"
      }, actor);
    }
    if (phaseElapsedMs) phaseElapsedMs.access = Math.round(performance.now() - startedAt);
    const requiresGithubToken = actor.githubRequired !== false && commandRequiresGithubToken(command, args);
    stage = "github-account";
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
    if (phaseElapsedMs) phaseElapsedMs.account = Math.round(performance.now() - startedAt);
    stage = "github-token";
    const credentialKey = actorCredentialKey(session, actor, toolHome);
    const githubToken = requiresGithubToken
      ? await readActorToken(credentialKey, {
          actor,
          gatewayCommandRunner: runWithinBudget,
          session,
          toolHome
        })
      : { ok: true, token: "" };
    if (githubToken.ok === false) {
      return finish(githubToken, actor);
    }
    if (phaseElapsedMs) phaseElapsedMs.authentication = Math.round(performance.now() - startedAt);
    const inputBuffer = normalizeText(input.inputBase64)
      ? Buffer.from(normalizeText(input.inputBase64), "base64")
      : undefined;
    const gatewayUserKey = gatewayGitIdentityUserKey(session, actor, toolHome);
    // Resources show the AI's command under the project whose session store
    // was just read, and its session. Reading the slug lists no projects.
    const projectSlug = typeof projectService.currentProjectSlug === "function"
      ? normalizeText(projectService.currentProjectSlug()) : "";
    stage = "command";
    if (phaseElapsedMs) phaseElapsedMs.commandStarted = Math.round(performance.now() - startedAt);
    const result = await runWithinBudget({
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
      execution: command === "gh"
        ? { label: "Running GitHub CLI for the AI", operationId: "agent-gh", projectSlug }
        : { label: "Running Git for the AI", operationId: "agent-git", projectSlug },
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
        workspace: env.VIBE64_WORKSPACE || env.VIBE64_RUNTIME_NAMESPACE || ""
      },
      purpose: githubToken.token ? "github" : "codex",
      runtimes: ["git", "gh"],
      session: {
        metadata: session.metadata || {},
        sessionId,
        sourcePath: actor.sourceRoot
      },
      userKey: gatewayUserKey
    });
    if (githubToken.token) dropRejectedCredentials(credentialKey, result);
    if (phaseElapsedMs) phaseElapsedMs.commandFinished = Math.round(performance.now() - startedAt);
    let error = "";
    if (result.timedOut && commandSubmitted) {
      error = "Managed Git command timed out.";
    } else if (!result.ok) {
      error = commandOutput(result);
    }
    return finish({
      code: result.ok ? "" : result.code || "vibe64_codex_git_command_failed",
      error,
      executionId: result.execution?.id,
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
    logger,
    run,
    sessionWorkSaveContext
  };
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
  const server = await commandServers.ensure({
    commandService,
    sessionId: normalizedSessionId,
    socketPath: commandSocketHostPath({ env, sessionId: normalizedSessionId, stateRoot })
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

// A session's final close (its archive, or the discard of a renewal successor
// that never went live) stops its Git control and removes its helper
// directory, which holds every agent command wrapper of the session.
// Renewal, changeover and project runtime closes keep both: the same session
// reconnects and its helpers are rewritten in place.
async function removeCodexGitCommandSession({
  env = process.env,
  sessionId = "",
  stateRoot = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) {
    return { ok: false, removed: false };
  }
  const options = { env, sessionId: normalizedSessionId, stateRoot };
  await commandServers.close(commandSocketHostPath(options));
  await rm(commandHostDir(options), { force: true, recursive: true });
  return { ok: true, removed: true };
}

export {
  VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV,
  VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV,
  VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV,
  VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV,
  VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV,
  createCodexGitCommandService,
  gitCommandActorFromSession,
  prepareCodexGitCommand,
  removeCodexGitCommandSession
};
