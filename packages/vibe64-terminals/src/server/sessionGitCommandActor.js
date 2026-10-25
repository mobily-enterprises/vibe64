import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  composeGithubTerminalHome,
  logGithubCredentialHomeResolution,
  normalizeGithubAccountMode,
  resolveGithubHomeForActor,
  resolveGithubHomeForStoredActor
} from "@local/vibe64-execution/server";
import { PROJECT_REPOSITORY_MODE_LOCAL_SOURCE } from "@local/vibe64-core/server/projectRepository";
import {
  terminalOwnerFromGithubToolHome
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

const NO_GITHUB_TERMINAL_USER_KEY = "runtime";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function responseError(message = "", code = "vibe64_session_git_actor_failed", extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
  };
}

function actorMetadataRecord({
  reason = "",
  scope = "",
  sessionId = "",
  sourceRoot = "",
  threadId = "",
  userKey = "",
  workdir = ""
} = {}) {
  return {
    session_git_command_actor_reason: reason,
    session_git_command_actor_updated_at: new Date().toISOString(),
    session_git_command_actor_scope: scope,
    session_git_command_actor_session_id: sessionId,
    session_git_command_actor_source_root: sourceRoot,
    session_git_command_actor_thread_id: threadId,
    session_git_command_actor_user_key: userKey,
    session_git_command_actor_workdir: workdir || sourceRoot
  };
}

const SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS = Object.freeze(Object.keys(actorMetadataRecord()));

function sessionGitCommandActorMetadata({
  env = process.env,
  reason = "",
  session = {},
  sourceRoot = "",
  threadId = "",
  vibe64User = null,
  workdir = ""
} = {}) {
  const accountMode = normalizeGithubAccountMode(
    env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const ownerScope = accountMode === GITHUB_ACCOUNT_MODE_USER ? "user" : "local";
  const ownerUserKey = ownerScope === "user"
    ? normalizeText(vibe64User?.username || vibe64User?.osUsername)
    : GITHUB_ACCOUNT_MODE_LOCAL;
  if (ownerScope === "user" && !ownerUserKey) {
    return responseError(
      "An enabled OS username is required for the Vibe64 user who authorized this session interaction.",
      "vibe64_os_user_required"
    );
  }
  const normalizedSessionId = normalizeText(session.sessionId || session.id);
  const normalizedSourceRoot = normalizeText(sourceRoot);
  if (!normalizedSessionId || !normalizedSourceRoot) {
    return responseError(
      "Session Git command actor metadata requires a session id and source root.",
      "vibe64_session_git_command_actor_context_required"
    );
  }
  return {
    metadata: actorMetadataRecord({
      reason: normalizeText(reason),
      scope: ownerScope,
      sessionId: normalizedSessionId,
      sourceRoot: normalizedSourceRoot,
      threadId: normalizeText(threadId),
      userKey: ownerUserKey,
      workdir: normalizeText(workdir)
    }),
    ok: true
  };
}

function sessionGitCommandActorMetadataFromExistingActor({
  actor = {},
  reason = "",
  session = {},
  sourceRoot = "",
  threadId = "",
  workdir = ""
} = {}) {
  const normalizedSessionId = normalizeText(session.sessionId || session.id || actor.sessionId);
  const normalizedSourceRoot = normalizeText(sourceRoot) || normalizeText(actor.sourceRoot);
  if (!actor.actorScope || !actor.actorUserKey || !normalizedSessionId || !normalizedSourceRoot) {
    return responseError(
      "Session Git command actor metadata requires a session id, source root, and stored actor.",
      "vibe64_session_git_command_actor_context_required"
    );
  }
  return {
    metadata: actorMetadataRecord({
      reason: normalizeText(reason) || normalizeText(actor.actorReason),
      scope: normalizeText(actor.actorScope),
      sessionId: normalizedSessionId,
      sourceRoot: normalizedSourceRoot,
      threadId: normalizeText(threadId) || normalizeText(actor.threadId),
      userKey: normalizeText(actor.actorUserKey),
      workdir: normalizeText(workdir) || normalizeText(actor.workdir)
    }),
    ok: true,
    preservedActor: true
  };
}

function sessionWithGitCommandActorMetadata(session = {}, metadata = {}) {
  return {
    ...session,
    metadata: {
      ...(session.metadata || {}),
      ...metadata
    }
  };
}

function sessionGitCommandActorFromMetadata(session = {}) {
  const metadata = session.metadata || {};
  const sessionId = normalizeText(metadata.session_git_command_actor_session_id);
  const actor = {
    actorReason: normalizeText(metadata.session_git_command_actor_reason),
    actorScope: normalizeText(metadata.session_git_command_actor_scope),
    actorUpdatedAt: normalizeText(metadata.session_git_command_actor_updated_at),
    actorUserKey: normalizeText(metadata.session_git_command_actor_user_key),
    sessionId,
    sourceRoot: normalizeText(metadata.session_git_command_actor_source_root),
    threadId: normalizeText(metadata.session_git_command_actor_thread_id),
    workdir: normalizeText(metadata.session_git_command_actor_workdir)
  };
  if (!actor.actorScope || !actor.actorUserKey || !actor.sessionId || !actor.sourceRoot) {
    return responseError(
      "Vibe64 does not have a complete GitHub command actor for this session.",
      "vibe64_session_git_command_actor_missing"
    );
  }
  return {
    ...actor,
    actorSource: "session_git_command_actor",
    ok: true
  };
}

async function writeSessionGitCommandActorMetadata(runtime, sessionId = "", metadata = {}, {
  reason = ""
} = {}) {
  if (typeof runtime?.store?.writeMetadataValue !== "function") {
    return false;
  }
  const normalizedSessionId = normalizeText(sessionId);
  const entries = Object.entries(metadata)
    .filter(([name]) => SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS.includes(name));
  if (!normalizedSessionId || !entries.length) {
    return false;
  }
  const writeEntries = async () => {
    await Promise.all(entries.map(([name, value]) => (
      runtime.store.writeMetadataValue(normalizedSessionId, name, String(value || ""))
    )));
  };
  if (typeof runtime.store.mutateSession === "function") {
    await runtime.store.mutateSession(normalizedSessionId, writeEntries);
  } else {
    await writeEntries();
  }
  vibe64SessionDebugLog("server.sessionGitCommandActor.recorded", {
    actorScope: normalizeText(metadata.session_git_command_actor_scope),
    actorUserKey: normalizeText(metadata.session_git_command_actor_user_key),
    reason: normalizeText(metadata.session_git_command_actor_reason) || normalizeText(reason),
    sessionId: normalizedSessionId,
    sourceRoot: normalizeText(metadata.session_git_command_actor_source_root),
    threadId: normalizeText(metadata.session_git_command_actor_thread_id),
    workdir: normalizeText(metadata.session_git_command_actor_workdir)
  });
  return true;
}

async function recordSessionGitCommandActor({
  env = process.env,
  overwrite = false,
  reason = "",
  runtime = null,
  session = {},
  sessionId = "",
  sourceRoot = "",
  threadId = "",
  vibe64User = null,
  workdir = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId) || normalizeText(session.sessionId || session.id);
  const sessionContext = {
    ...session,
    sessionId: normalizedSessionId
  };
  if (!sessionRequiresGithubActor(sessionContext)) {
    return {
      ok: true,
      session: sessionContext
    };
  }
  const existingActor = overwrite === true
    ? null
    : sessionGitCommandActorFromMetadata(sessionContext);
  const actorMetadata = existingActor?.ok === true
    ? sessionGitCommandActorMetadataFromExistingActor({
      actor: existingActor,
      reason,
      session: sessionContext,
      sourceRoot,
      threadId,
      workdir
    })
    : sessionGitCommandActorMetadata({
      env,
      reason,
      session: sessionContext,
      sourceRoot,
      threadId,
      vibe64User,
      workdir
    });
  if (actorMetadata?.ok === false) {
    vibe64SessionDebugLog("server.sessionGitCommandActor.recordFailed", {
      code: normalizeText(actorMetadata.code),
      error: normalizeText(actorMetadata.error),
      reason: normalizeText(reason),
      sessionId: normalizedSessionId,
      sourceRoot: normalizeText(sourceRoot),
      workdir: normalizeText(workdir)
    });
    return actorMetadata;
  }
  const persisted = await writeSessionGitCommandActorMetadata(
    runtime,
    normalizedSessionId,
    actorMetadata.metadata,
    {
      reason
    }
  );
  if (!persisted) {
    return responseError(
      "Session Git command actor metadata could not be persisted.",
      "vibe64_session_git_command_actor_store_required"
    );
  }
  return {
    ...actorMetadata,
    session: sessionWithGitCommandActorMetadata(session, actorMetadata.metadata)
  };
}

async function resolveSessionGitCommandActorTerminalHome({
  env = process.env,
  logger = null,
  operation = "",
  session = {},
  terminalKind = ""
} = {}) {
  if (!sessionRequiresGithubActor(session)) {
    return resolveNoGithubSessionTerminalHome({
      env
    });
  }
  const actor = sessionGitCommandActorFromMetadata(session);
  if (actor?.ok === false) {
    logGithubCredentialHomeResolution(logger, {
      ...actor,
      accountMode: "",
      credentialScope: "",
      ownerUserKey: "",
      toolHomeSource: ""
    }, {
      operation,
      terminalKind
    });
    return actor;
  }
  const context = await resolveGithubHomeForStoredActor({
    accountMode: actor.actorScope,
    env,
    ownerUserKey: actor.actorUserKey
  });
  logGithubCredentialHomeResolution(logger, context, {
    operation,
    terminalKind
  });
  if (context?.ok === false) {
    return {
      ...context,
      error: context.error || "GitHub account storage is not available for this session actor."
    };
  }
  const terminalHome = composeGithubTerminalHome(context);
  if (terminalHome?.ok === false) {
    return {
      ...terminalHome,
      error: terminalHome.error || "Terminal account storage is not available for this session actor."
    };
  }
  return {
    ...terminalHome,
    actor,
    hostGid: terminalHome.hostGid,
    hostUid: terminalHome.hostUid,
    owner: terminalOwnerFromGithubToolHome(terminalHome),
    ok: true
  };
}

// A local-source session only exchanges work with its local folder; that
// folder's own upstream, even on GitHub, never makes it a GitHub session.
function sessionRequiresGithubActor(session = {}) {
  const metadata = session.metadata || {};
  if (normalizeText(metadata.repository_mode) === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) return false;
  const repository = normalizeText(metadata.github_repository || session.github_repository);
  const remoteUrl = normalizeText(metadata.source_remote_url);
  return Boolean(repository || /(?:^|[.@/:])github\.com(?:[/:]|$)/iu.test(remoteUrl));
}

function resolveNoGithubSessionTerminalHome({
  env = process.env
} = {}) {
  const context = resolveGithubHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    env
  });
  if (context?.ok === false) {
    return context;
  }
  return {
    actor: {
      actorScope: "app",
      actorUserKey: NO_GITHUB_TERMINAL_USER_KEY,
      actorSource: "session_repository_profile"
    },
    githubRequired: false,
    githubToolHomeSource: "",
    hostGid: context.hostGid,
    hostUid: context.hostUid,
    ok: true,
    owner: {
      githubCredentialScope: "app",
      githubToolHomeSource: "",
      ownerScope: "app",
      ownerUserKey: NO_GITHUB_TERMINAL_USER_KEY
    },
    credentialScope: "app",
    toolHomeSource: context.toolHomeSource
  };
}

export {
  SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS,
  recordSessionGitCommandActor,
  resolveSessionGitCommandActorTerminalHome,
  sessionRequiresGithubActor,
  sessionGitCommandActorFromMetadata,
  sessionGitCommandActorMetadata,
  sessionWithGitCommandActorMetadata,
  writeSessionGitCommandActorMetadata
};
