import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  normalizeGithubAccountMode
} from "@local/vibe64-execution/server";
import { PROJECT_REPOSITORY_MODE_LOCAL_SOURCE } from "@local/vibe64-core/server/projectRepository";
import {
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import { trimmedText } from "./trimmedText.js";

/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

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
    ? trimmedText(vibe64User?.username || vibe64User?.osUsername)
    : GITHUB_ACCOUNT_MODE_LOCAL;
  if (ownerScope === "user" && !ownerUserKey) {
    return responseError(
      "An enabled OS username is required for the Vibe64 user who authorized this session interaction.",
      "vibe64_os_user_required"
    );
  }
  const normalizedSessionId = trimmedText(session.sessionId);
  const normalizedSourceRoot = trimmedText(sourceRoot);
  if (!normalizedSessionId || !normalizedSourceRoot) {
    return responseError(
      "Session Git command actor metadata requires a session id and source root.",
      "vibe64_session_git_command_actor_context_required"
    );
  }
  return {
    metadata: actorMetadataRecord({
      reason: trimmedText(reason),
      scope: ownerScope,
      sessionId: normalizedSessionId,
      sourceRoot: normalizedSourceRoot,
      threadId: trimmedText(threadId),
      userKey: ownerUserKey,
      workdir: trimmedText(workdir)
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
  const normalizedSessionId = trimmedText(session.sessionId || actor.sessionId);
  const normalizedSourceRoot = trimmedText(sourceRoot) || trimmedText(actor.sourceRoot);
  if (!actor.actorScope || !actor.actorUserKey || !normalizedSessionId || !normalizedSourceRoot) {
    return responseError(
      "Session Git command actor metadata requires a session id, source root, and stored actor.",
      "vibe64_session_git_command_actor_context_required"
    );
  }
  return {
    metadata: actorMetadataRecord({
      reason: trimmedText(reason) || trimmedText(actor.actorReason),
      scope: trimmedText(actor.actorScope),
      sessionId: normalizedSessionId,
      sourceRoot: normalizedSourceRoot,
      threadId: trimmedText(threadId) || trimmedText(actor.threadId),
      userKey: trimmedText(actor.actorUserKey),
      workdir: trimmedText(workdir) || trimmedText(actor.workdir)
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
  const sessionId = trimmedText(metadata.session_git_command_actor_session_id);
  const actor = {
    actorReason: trimmedText(metadata.session_git_command_actor_reason),
    actorScope: trimmedText(metadata.session_git_command_actor_scope),
    actorUpdatedAt: trimmedText(metadata.session_git_command_actor_updated_at),
    actorUserKey: trimmedText(metadata.session_git_command_actor_user_key),
    sessionId,
    sourceRoot: trimmedText(metadata.session_git_command_actor_source_root),
    threadId: trimmedText(metadata.session_git_command_actor_thread_id),
    workdir: trimmedText(metadata.session_git_command_actor_workdir)
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

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} [sessionId]
 * @param {object} [metadata]
 * @param {object} [options]
 * @param {string} [options.reason]
 */
async function writeSessionGitCommandActorMetadata(runtime, sessionId = "", metadata = {}, {
  reason = ""
} = {}) {
  if (!runtime) {
    return false;
  }
  const normalizedSessionId = trimmedText(sessionId);
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
  await runtime.store.mutateSession(normalizedSessionId, writeEntries);
  vibe64SessionDebugLog("server.sessionGitCommandActor.recorded", {
    actorScope: trimmedText(metadata.session_git_command_actor_scope),
    actorUserKey: trimmedText(metadata.session_git_command_actor_user_key),
    reason: trimmedText(metadata.session_git_command_actor_reason) || trimmedText(reason),
    sessionId: normalizedSessionId,
    sourceRoot: trimmedText(metadata.session_git_command_actor_source_root),
    threadId: trimmedText(metadata.session_git_command_actor_thread_id),
    workdir: trimmedText(metadata.session_git_command_actor_workdir)
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
  const normalizedSessionId = trimmedText(sessionId) || trimmedText(session.sessionId);
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
      code: trimmedText(actorMetadata.code),
      error: trimmedText(actorMetadata.error),
      reason: trimmedText(reason),
      sessionId: normalizedSessionId,
      sourceRoot: trimmedText(sourceRoot),
      workdir: trimmedText(workdir)
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

// A local-source session only exchanges work with its local folder; that
// folder's own upstream, even on GitHub, never makes it a GitHub session.
function sessionRequiresGithubActor(session = {}) {
  const metadata = session.metadata || {};
  if (trimmedText(metadata.repository_mode) === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) return false;
  const repository = trimmedText(metadata.github_repository || session.github_repository);
  const remoteUrl = trimmedText(metadata.source_remote_url);
  return Boolean(repository || /(?:^|[.@/:])github\.com(?:[/:]|$)/iu.test(remoteUrl));
}

export {
  SESSION_GIT_COMMAND_ACTOR_METADATA_KEYS,
  recordSessionGitCommandActor,
  sessionRequiresGithubActor,
  sessionGitCommandActorFromMetadata,
  sessionGitCommandActorMetadata,
  sessionWithGitCommandActorMetadata,
  writeSessionGitCommandActorMetadata
};
