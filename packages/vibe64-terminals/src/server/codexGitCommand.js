import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { isVibe64DebugLoggingEnabled } from "@local/vibe64-core/shared";

import { normalizeText, resolveGithubHomeForStoredActor, runVibe64Command } from "@local/vibe64-execution/server";
import {
  SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS,
  sessionGitCommandActorFromMetadata,
  sessionRequiresGithubActor
} from "./sessionGitCommandActor.js";
import { prepareCodexAttachmentRoot } from "@local/vibe64-runtime/server/codexAttachmentPaths";
import { pathInsideOrEqual } from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import { fetchReachesGithubAsGit, listGithubRemoteHeads } from "./githubRemoteHeads.js";
import { currentProjectSlug } from "./terminalShared.js";
import { createSessionCommandServers } from "./unixJsonCommand.js";
import {
  CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS,
  CODEX_GIT_COMMAND_WRAPPER_NAMES,
  commandEnvironment,
  commandHostDir,
  commandSocketHostPath,
  VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV,
  VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV,
  VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV,
  VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV,
  VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV,
  writeWrappers
} from "./codexGitCommandWrappers.js";
import {
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
} from "./codexGitCommandOperations.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

const CODEX_GIT_COMMAND_INPUT_MAX_BYTES = 20 * 1024 * 1024;
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
  const sessionId = normalizeText(session.sessionId);
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

/**
 * @param {ProjectService} projectService
 * @param {string} [sessionId]
 */
async function readGitCommandSession(projectService, sessionId = "") {
  const store = await projectService.createSessionStore({
    sessionId
  });
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

/**
 * @param {object} dependencies
 * @param {((actor: object, request: object) => Promise<unknown>) | null} [dependencies.authorizeActorAccess]
 * @param {RuntimeEnv} [dependencies.env]
 * @param {typeof fetch} [dependencies.fetch]
 * @param {RuntimeLogger} dependencies.logger
 * @param {() => number} [dependencies.now]
 * @param {ProjectService} dependencies.projectService
 * @param {typeof runVibe64Command} [dependencies.runGatewayCommand]
 */
function createCodexGitCommandService({
  authorizeActorAccess = null,
  env = process.env,
  fetch: fetchRemote = globalThis.fetch,
  logger,
  now = Date.now,
  projectService,
  runGatewayCommand: gatewayCommandRunner = runVibe64Command
}) {
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
    // readable-check: allow method-probe - optional operation: a project service without Git actor authorization admits every actor
    return typeof projectService.authorizeCodexGitActorAccess === "function"
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
    const sessionId = normalizeText(suppliedSessionId || suppliedSession?.sessionId);
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
      // rejection drops it as a rejected Git command's does. Behind a proxy
      // this process's fetch would not use, there is none and Git reads.
      ...(fetchReachesGithubAsGit(env) ? {
        readRemoteHeads: async (remoteUrl, refs, { timeoutMs } = {}) => {
          try {
            return await listGithubRemoteHeads({ fetch: fetchRemote, refs, remoteUrl, timeoutMs, token: githubToken.token });
          } catch (error) {
            if (error?.authenticationRejected === true) actorCredentials.drop(credentialKey);
            throw error;
          }
        }
      } : {}),
      runCommand: async (request) => dropRejectedCredentials(credentialKey, await gatewayCommandRunner(request))
    };
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const startedAt = performance.now();
    const phaseElapsedMs = isVibe64DebugLoggingEnabled({ env, level: logger.level }) ? {} : null;
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
    const projectSlug = currentProjectSlug(projectService);
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

  return Object.freeze({
    logger,
    run,
    sessionWorkSaveContext
  });
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
