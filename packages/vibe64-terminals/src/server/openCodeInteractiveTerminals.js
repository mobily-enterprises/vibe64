import {
  closeTerminalSession, readTerminalSession, resizeTerminalSession,
  subscribeTerminalSession, terminalNamespaceAdmissionFailure, writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";
import { opencodeTerminalNamespace, vibe64Result } from "./terminalShared.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").OpenCodeSharedRuntime} OpenCodeSharedRuntime */
/** @typedef {import("./types.js").OpenCodeHostPreparation} OpenCodeHostPreparation */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./types.js").OpenCodeMainMessagePreparation} OpenCodeMainMessagePreparation */
/** @typedef {import("./types.js").RecordSessionGitCommandActor} RecordSessionGitCommandActor */
/** @typedef {import("./types.js").OpenCodeMainMessagePreparationContextFor} OpenCodeMainMessagePreparationContextFor */

const OPENCODE_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH = 256 * 1024;

/**
 * @param {object} dependencies
 * @param {OpenCodeSharedRuntime} dependencies.sharedRuntime
 * @param {OpenCodeMainMessagePreparationContextFor} dependencies.contextFor
 * @param {OpenCodeHostPreparation} dependencies.hostPreparation
 * @param {RuntimeEnv} dependencies.env
 * @param {RecordSessionGitCommandActor} dependencies.recordGitActor
 */
export function createOpenCodeInteractiveTerminals({
  sharedRuntime,
  contextFor,
  hostPreparation,
  env,
  recordGitActor
}) {
  const { processes } = sharedRuntime;
  const { prepareProcess, upstreamSessionOptions, storedUpstreamSessionId } = hostPreparation;

  function terminalSnapshot(sessionId = "", terminalSessionId = "") {
    const id = toText(terminalSessionId);
    return id
      ? readTerminalSession(id, {
          namespace: opencodeTerminalNamespace(sessionId),
          outputLimit: OPENCODE_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
        })
      : null;
  }

  const terminalHost = {
    read: terminalSnapshot,
    close: closeTerminalSession,
    namespace: opencodeTerminalNamespace
  };

  async function startTerminal(sessionId = "", input = {}, options = {}) {
    void input;
    return vibe64Result(async () => {
      const context = await contextFor(sessionId, options);
      return sharedRuntime.startPreparedTerminal({
        process: () => prepareProcess(context, options),
        session: () => upstreamSessionOptions(context),
        context,
        terminalHost
      });
    });
  }

  function readTerminal(sessionId = "", terminalSessionId = "") {
    return vibe64Result(async () => terminalSnapshot(sessionId, terminalSessionId));
  }

  async function closeTerminal(sessionId = "", terminalSessionId = "") {
    return vibe64Result(async () => {
      return sharedRuntime.closeTerminal(sessionId, terminalSessionId, terminalHost);
    });
  }

  function subscribeTerminal(sessionId = "", terminalSessionId = "", subscriber = null) {
    return vibe64Result(async () => subscribeTerminalSession(terminalSessionId, subscriber, {
      namespace: opencodeTerminalNamespace(sessionId),
      outputLimit: OPENCODE_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
    }));
  }

  function resizeTerminal(sessionId = "", terminalSessionId = "", size = {}) {
    return resizeTerminalSession(terminalSessionId, size, {
      namespace: opencodeTerminalNamespace(sessionId)
    });
  }

  async function writeTerminal(sessionId = "", terminalSessionId = "", data = "", input = {}, options = {}) {
    const namespace = opencodeTerminalNamespace(sessionId);
    const admissionFailure = terminalNamespaceAdmissionFailure(namespace);
    if (admissionFailure) {
      return admissionFailure;
    }
    if (input.attachments?.length) {
      await sharedRuntime.allowTerminalAttachments(sessionId, terminalSessionId, input);
    }
    if (input.trackGitActor) {
      const context = await contextFor(sessionId, options);
      const target = processes.get(context.key);
      const actor = await recordGitActor({
        env,
        overwrite: false,
        reason: "opencode-terminal-input",
        runtime: context.runtime,
        session: context.session,
        sourceRoot: sessionSourcePath(context.session),
        threadId: target?.upstreamSessionId || storedUpstreamSessionId(context),
        vibe64User: options.vibe64User || null,
        workdir: context.workdir
      });
      if (actor?.ok === false) {
        return actor;
      }
    }
    return writeTerminalSessionText(terminalSessionId, data, { namespace });
  }

  return Object.freeze({
    startTerminal,
    readTerminal,
    closeTerminal,
    subscribeTerminal,
    resizeTerminal,
    writeTerminal,
    terminalHost
  });
}
