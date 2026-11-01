// Reads the context a session's conversation runs in: its runtime, session, execution root and engine scope.

import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  defineVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { sessionClosingReason, sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { terminalNamespaceAdmissionFailure } from "@local/vibe64-execution/server/terminalSessions";
import {
  claudeConversationError,
  codexTerminalNamespace,
  codexSessionWorktreeWasRemoved,
  codexSessionWorktreeUnavailableFailure,
  codexSessionWorkdirAllowed,
  directoryExists,
  openCodeError,
  openCodeSessionId,
  nonRetryableTerminalFailure
} from "./terminalShared.js";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

const MAIN_CONVERSATION_STATE_KEY = "assistant_changeover";
const STATE_KEY = MAIN_CONVERSATION_STATE_KEY;

function requireCompletedNativeConversationReplacement(session, options = {}) {
  const { requireBriefing = false } = options;
  const state = JSON.parse(session?.metadata?.[STATE_KEY] || "null");
  if (state?.replacement?.status === "preparing") {
    throw new AppError(409, "Native conversation replacement is unfinished. Retry that operation before starting assistant work.", { code: "vibe64_conversation_replacement_pending" });
  }
  if (requireBriefing && state?.replacement?.status === "ready") {
    throw new AppError(409, "Send a chat message to deliver the saved continuity briefing before starting a native terminal or goal.", { code: "vibe64_conversation_replacement_briefing_pending" });
  }
}

/**
 * Only a server-constructed learning runtime can opt into a source-less cwd.
 * Its original store reader validates the exact active durable scope each time.
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {object} [options]
 * @param {boolean} [options.allowClosing]
 */
async function learningSessionExecutionRoot(runtime, sessionId, options = {}) {
  const { allowClosing = false } = options;
  if (!runtime?.learningScope) return "";
  const executionRoot = await runtime.getNativeExecutionRoot(sessionId, { allowClosing });
  return runtime.learningScope.noExercise === true ? executionRoot : "";
}

/**
 * Read application context without inspecting source or acquiring a native
 * conversation. Codex/OpenCode require matching snapshots; Claude retains its
 * captured/pinned snapshot.
 * @param {string} engine
 * @param {ProjectService} project
 * @param {string} sessionId
 * @param {object} [options]
 * @param {object} codexHost the Codex tool home and unavailable-worktree handlers
 */
async function readSessionConversationContext(engine, project, sessionId, options, codexHost) {
  const id = engine === "codex" ? sessionId : engine === "opencode"
    ? openCodeSessionId(sessionId) : String(sessionId ?? "").trim();
  let codex;
  let scope;
  if (engine === "codex") {
    const { allowClosing = false, runtime, session } = options;
    codex = { allowClosing, runtime, session };
    const admissionFailure = terminalNamespaceAdmissionFailure(codexTerminalNamespace(id));
    if (admissionFailure) return admissionFailure;
  } else if (engine === "opencode") {
    scope = options.assistantScope;
    if (scope) return scopedOpenCodeContext(id, scope, options);
  } else {
    scope = claudeConversationScope(id, options);
  }

  const runtime = (codex ? codex.runtime : options.runtime) || (scope
    ? { stateRoot: scope.runtimeRoot }
    : await project.createRuntimeWithoutSource());
  let session;
  if (codex) {
    session = codex.session?.sessionId === id ? codex.session : await runtime.getSessionWithoutSource(id);
  } else if (engine === "opencode") {
    // Bounded matching snapshot: preserve both original options.session reads.
    session = options.session?.sessionId === id ? options.session : await runtime.getSessionWithoutSource(id);
  } else {
    // Captured/pinned snapshot: do not replace a supplied Claude goal context.
    session = scope ? null : options.session || await runtime.getSessionWithoutSource(id);
  }

  if (codex) return prepareCodexConversationContext(id, runtime, session, codex.allowClosing, codexHost);
  if (engine === "opencode") {
    if (!session) {
      throw openCodeError("vibe64_session_not_found", "Vibe64 session is not available.", { sessionId: id }, 404);
    }
    const workdir = await learningSessionExecutionRoot(runtime, id, { allowClosing: options.allowClosing === true }) ||
      sessionSourcePath(session);
    if (!workdir || !String(session.sessionRoot ?? "").trim() || !String(runtime.stateRoot ?? "").trim()) {
      throw openCodeError(
        "vibe64_opencode_session_roots_missing",
        "OpenCode cannot start until the session workspace and state roots are ready.",
        { sessionId: id }
      );
    }
    return {
      key: `${path.resolve(runtime.stateRoot)}\0${id}`,
      runtime,
      session,
      sessionId: id,
      selection: openCodeSelection(session),
      workdir: path.resolve(workdir)
    };
  }
  if (!scope && !session) throw claudeConversationError("This session is unavailable.");
  const selection = options.assistantSelection || vibe64AssistantSelectionFromMetadata(session?.metadata);
  if (selection?.engineId !== "claude") throw claudeConversationError("This session does not have a Claude Code selection.");
  const workdir = scope?.workdir ||
    await learningSessionExecutionRoot(runtime, id, { allowClosing: options.allowClosing === true }) ||
    sessionSourcePath(session);
  if (!path.isAbsolute(workdir || "") || !runtime.stateRoot) throw claudeConversationError("Claude requires a prepared session workspace.");
  return {
    ...options,
    runtime,
    session,
    assistantSelection: selection,
    selection,
    sessionId: id,
    workdir,
    key: claudeConversationKey(runtime, id)
  };
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} id
 */
function claudeConversationKey(runtime, id) {
  return `${path.resolve(runtime.stateRoot)}\0${id}`;
}

function claudeConversationScope(id, options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id)) throw new TypeError("Claude requires a valid session id.");
  const scope = options.assistantScope;
  if (scope && scope.id !== id) throw claudeConversationError("Claude conversation scope does not match.");
  return scope;
}

/**
 * Cleanup and activity reach what the Claude owner retains for a session by its
 * key alone. They need no workspace or Claude selection: a session whose source
 * was never created or was already removed can still be closed and inspected.
 * @param {ProjectService} project
 * @param {string} sessionId
 * @param {object} [options]
 */
async function readClaudeConversationOwnerContext(project, sessionId, options = {}) {
  const id = String(sessionId ?? "").trim();
  const scope = claudeConversationScope(id, options);
  const runtime = options.runtime || (scope
    ? { stateRoot: scope.runtimeRoot }
    : await project.createRuntimeWithoutSource());
  if (!runtime.stateRoot) throw claudeConversationError("Claude requires a session state root.");
  return { ...options, runtime, sessionId: id, key: claudeConversationKey(runtime, id) };
}

function scopedOpenCodeContext(id, assistantScope, options) {
  if (String(assistantScope.id ?? "").trim() !== id) {
    throw openCodeError(
      "vibe64_ephemeral_scope_mismatch",
      "OpenCode ephemeral conversation scope does not match its provider binding."
    );
  }
  const selection = defineVibe64AssistantSelection(options.assistantSelection || {});
  if (selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
    throw openCodeError(
      "vibe64_opencode_selection_required",
      "The ephemeral conversation does not have an OpenCode selection."
    );
  }
  return {
    assistantScope,
    key: `ephemeral\0${id}`,
    runtime: { projectContextRoot: assistantScope.workdir, stateRoot: assistantScope.runtimeRoot },
    session: null,
    sessionId: id,
    selection,
    workdir: path.resolve(assistantScope.workdir)
  };
}

/**
 * @param {string} sessionId
 * @param {Vibe64SessionRuntime} runtime
 * @param {object} session
 * @param {boolean} allowClosing
 * @param {object} codexHost the Codex tool home and unavailable-worktree handlers
 */
async function prepareCodexConversationContext(sessionId, runtime, session, allowClosing, codexHost) {
  requireCompletedNativeConversationReplacement(session);
  if (sessionIsClosing(session) && !allowClosing) {
    const renewing = String(session.status || "").trim() === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED;
    return {
      code: renewing ? "vibe64_session_renewal_quiesced" : "vibe64_session_closing",
      error: `Session is ${sessionClosingReason(session)} and cannot start Codex.`,
      ok: false
    };
  }
  let learningRoot;
  try {
    learningRoot = await learningSessionExecutionRoot(runtime, sessionId, { allowClosing });
  } catch (error) {
    if (error?.code !== "vibe64_session_source_required" || runtime.learningScope?.noExercise !== false ||
        !codexSessionWorktreeWasRemoved(session)) throw error;
    return codexHost.unavailableWorktree(runtime, sessionId, codexSessionWorktreeUnavailableFailure({
      session,
      workdir: sessionSourcePath(session)
    }));
  }
  const executionRoot = learningRoot || sessionSourcePath(session);
  if (!executionRoot) {
    return nonRetryableTerminalFailure({
      ok: false,
      error: "Vibe64 Codex execution root is not available."
    });
  }
  const workdir = executionRoot;
  if (!learningRoot && codexSessionWorktreeWasRemoved(session)) {
    return codexHost.unavailableWorktree(
      runtime,
      sessionId,
      codexSessionWorktreeUnavailableFailure({
        session,
        workdir
      })
    );
  }
  if (!learningRoot && !codexSessionWorkdirAllowed({
    session,
    executionRoot,
    workdir
  })) {
    return nonRetryableTerminalFailure({
      ok: false,
      error: workdir
        ? "Vibe64 Codex workdir is outside the execution root."
        : "Create the session clone before starting Codex."
    });
  }
  if (!await directoryExists(workdir)) {
    if (learningRoot) {
      throw Object.assign(new Error("The learning native execution directory is unavailable."), {
        code: "vibe64_learning_native_directory_unavailable"
      });
    }
    return codexHost.unavailableWorktree(
      runtime,
      sessionId,
      codexSessionWorktreeUnavailableFailure({
        session,
        workdir
      })
    );
  }
  const toolHome = await codexHost.toolHome(session);
  if (toolHome.ok === false) {
    return toolHome;
  }
  return {
    ok: true,
    runtime,
    session,
    executionRoot,
    toolHomeSource: toolHome.toolHomeSource,
    workdir
  };
}

function openCodeSelection(session) {
  const selection = vibe64AssistantSelectionFromMetadata(session?.metadata, {
    required: false
  });
  if (!selection || selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
    throw openCodeError(
      "vibe64_opencode_selection_required",
      "This session does not have a durable OpenCode selection."
    );
  }
  return selection;
}

export {
  learningSessionExecutionRoot,
  MAIN_CONVERSATION_STATE_KEY,
  readClaudeConversationOwnerContext,
  readSessionConversationContext,
  requireCompletedNativeConversationReplacement,
  STATE_KEY
};
