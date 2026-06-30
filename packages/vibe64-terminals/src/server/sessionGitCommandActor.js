import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  canonicalVibe64UserEmail,
  composeGithubTerminalHome,
  githubProviderUserKey,
  logGithubProviderHomeResolution,
  normalizeGithubAccountMode,
  resolveGithubToolHomeForStoredActor
} from "@local/studio-terminal-core/server/providerHomes";
import {
  terminalOwnerFromGithubToolHome
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

const SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS = Object.freeze([
  "session_git_command_actor_reason",
  "session_git_command_actor_updated_at",
  "session_git_command_actor_email",
  "session_git_command_actor_scope",
  "session_git_command_actor_session_id",
  "session_git_command_actor_target_root",
  "session_git_command_actor_thread_id",
  "session_git_command_actor_user_key",
  "session_git_command_actor_workdir"
]);

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

function sessionGitCommandActorMetadata({
  env = process.env,
  reason = "",
  session = {},
  targetRoot = "",
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
    ? githubProviderUserKey(vibe64User)
    : GITHUB_ACCOUNT_MODE_LOCAL;
  if (ownerScope === "user" && !ownerUserKey) {
    return responseError(
      "A GitHub identity is required for the Vibe64 user who authorized this session interaction.",
      "vibe64_user_required"
    );
  }
  const normalizedSessionId = normalizeText(session.sessionId || session.id);
  const normalizedTargetRoot = normalizeText(targetRoot);
  if (!normalizedSessionId || !normalizedTargetRoot) {
    return responseError(
      "Session Git command actor metadata requires a session id and target root.",
      "vibe64_session_git_command_actor_context_required"
    );
  }
  const now = new Date();
  return {
    metadata: {
      session_git_command_actor_email: ownerScope === "user" ? canonicalVibe64UserEmail(vibe64User) : "",
      session_git_command_actor_reason: normalizeText(reason),
      session_git_command_actor_scope: ownerScope,
      session_git_command_actor_session_id: normalizedSessionId,
      session_git_command_actor_target_root: normalizedTargetRoot,
      session_git_command_actor_thread_id: normalizeText(threadId),
      session_git_command_actor_updated_at: now.toISOString(),
      session_git_command_actor_user_key: ownerUserKey,
      session_git_command_actor_workdir: normalizeText(workdir) || normalizedTargetRoot
    },
    ok: true
  };
}

function sessionGitCommandActorMetadataFromExistingActor({
  actor = {},
  reason = "",
  session = {},
  targetRoot = "",
  threadId = "",
  workdir = ""
} = {}) {
  const normalizedSessionId = normalizeText(session.sessionId || session.id || actor.sessionId);
  const normalizedTargetRoot = normalizeText(targetRoot) || normalizeText(actor.targetRoot);
  if (!actor.actorScope || !actor.actorUserKey || !normalizedSessionId || !normalizedTargetRoot) {
    return responseError(
      "Session Git command actor metadata requires a session id, target root, and stored actor.",
      "vibe64_session_git_command_actor_context_required"
    );
  }
  const now = new Date();
  return {
    metadata: {
      session_git_command_actor_email: normalizeText(actor.actorEmail),
      session_git_command_actor_reason: normalizeText(reason) || normalizeText(actor.actorReason),
      session_git_command_actor_scope: normalizeText(actor.actorScope),
      session_git_command_actor_session_id: normalizedSessionId,
      session_git_command_actor_target_root: normalizedTargetRoot,
      session_git_command_actor_thread_id: normalizeText(threadId) || normalizeText(actor.threadId),
      session_git_command_actor_updated_at: now.toISOString(),
      session_git_command_actor_user_key: normalizeText(actor.actorUserKey),
      session_git_command_actor_workdir: normalizeText(workdir) || normalizeText(actor.workdir) || normalizedTargetRoot
    },
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
    actorEmail: normalizeText(metadata.session_git_command_actor_email),
    actorReason: normalizeText(metadata.session_git_command_actor_reason),
    actorScope: normalizeText(metadata.session_git_command_actor_scope),
    actorUpdatedAt: normalizeText(metadata.session_git_command_actor_updated_at),
    actorUserKey: normalizeText(metadata.session_git_command_actor_user_key),
    sessionId,
    targetRoot: normalizeText(metadata.session_git_command_actor_target_root),
    threadId: normalizeText(metadata.session_git_command_actor_thread_id),
    workdir: normalizeText(metadata.session_git_command_actor_workdir)
  };
  if (!actor.actorScope || !actor.actorUserKey || !actor.sessionId || !actor.targetRoot) {
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
    targetRoot: normalizeText(metadata.session_git_command_actor_target_root),
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
  targetRoot = "",
  threadId = "",
  vibe64User = null,
  workdir = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId) || normalizeText(session.sessionId || session.id);
  const sessionContext = {
    ...session,
    sessionId: normalizedSessionId
  };
  const existingActor = overwrite === true
    ? null
    : sessionGitCommandActorFromMetadata(sessionContext);
  const actorMetadata = existingActor?.ok === true
    ? sessionGitCommandActorMetadataFromExistingActor({
      actor: existingActor,
      reason,
      session: sessionContext,
      targetRoot,
      threadId,
      workdir
    })
    : sessionGitCommandActorMetadata({
      env,
      reason,
      session: sessionContext,
      targetRoot,
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
      targetRoot: normalizeText(targetRoot),
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
  providerHomesRoot = "",
  session = {},
  terminalKind = ""
} = {}) {
  const actor = sessionGitCommandActorFromMetadata(session);
  if (actor?.ok === false) {
    logGithubProviderHomeResolution(logger, {
      ...actor,
      accountMode: "",
      ownerEmail: "",
      ownerUserKey: "",
      providerScope: "",
      toolHomeSource: ""
    }, {
      operation,
      terminalKind
    });
    return actor;
  }
  const resolvedProviderHomesRoot = normalizeText(providerHomesRoot) ||
    normalizeText(env?.[VIBE64_PROVIDER_HOMES_ROOT_ENV]);
  const context = resolveGithubToolHomeForStoredActor({
    accountMode: actor.actorScope,
    env,
    ownerEmail: actor.actorEmail,
    ownerUserKey: actor.actorUserKey,
    providerHomesRoot: resolvedProviderHomesRoot
  });
  logGithubProviderHomeResolution(logger, context, {
    operation,
    terminalKind
  });
  if (context?.ok === false) {
    return {
      ...context,
      error: context.error || "GitHub account storage is not available for this session actor."
    };
  }
  const terminalHome = composeGithubTerminalHome(context, {
    providerHomesRoot: resolvedProviderHomesRoot
  });
  if (terminalHome?.ok === false) {
    return {
      ...terminalHome,
      error: terminalHome.error || "Terminal account storage is not available for this session actor."
    };
  }
  return {
    ...terminalHome,
    actor,
    owner: terminalOwnerFromGithubToolHome(terminalHome),
    ok: true
  };
}

export {
  SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS,
  recordSessionGitCommandActor,
  resolveSessionGitCommandActorTerminalHome,
  sessionGitCommandActorFromMetadata,
  sessionGitCommandActorMetadata,
  sessionWithGitCommandActorMetadata,
  writeSessionGitCommandActorMetadata
};
