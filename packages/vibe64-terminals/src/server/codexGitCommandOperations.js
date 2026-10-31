// What an agent's Git command does, the GitHub token and commit author it needs, and how its result is logged.

import { USER_CREDENTIAL_SCOPE, normalizeText } from "@local/vibe64-execution/server";
import { logOperationalEvent, sanitizeLogText } from "@local/vibe64-core/server/logging";

const CODEX_GIT_COMMAND_TIMEOUT_MS = 30_000;
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

function responseError(message = "", code = "vibe64_codex_git_command_failed", extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
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

/**
 * @param {object} dependencies
 * @param {() => number} [dependencies.now]
 * @param {number} [dependencies.ttlMs]
 */
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

export {
  actorCredentialKey,
  CODEX_GIT_COMMAND_TIMEOUT_MS,
  commandOutput,
  commandRequiresGithubToken,
  commitAuthorOptions,
  createActorCredentialCache,
  gatewayGitIdentityUserKey,
  githubAuthenticationRejected,
  logGitCommandResult,
  readGithubToken,
  responseError
};
