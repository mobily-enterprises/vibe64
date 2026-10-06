import {
  closeTerminalSession, readTerminalSession, resizeTerminalSession,
  subscribeTerminalSession, terminalNamespaceAdmissionFailure, writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";
import { opencodeTerminalNamespace, terminalSessionSourceRoot, vibe64Result } from "./terminalShared.js";

const OPENCODE_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH = 256 * 1024;

function text(value = "") {
  return String(value ?? "").trim();
}

export function createOpenCodeInteractiveTerminals({ sharedRuntime, contextFor, hostPreparation, env, recordGitActor }) {
  const { processes } = sharedRuntime;
  const { prepareProcess, upstreamSessionOptions, storedUpstreamSessionId } = hostPreparation;

  function terminalSnapshot(sessionId = "", terminalSessionId = "") {
    const id = text(terminalSessionId);
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
    if (input?.trackGitActor) {
      const context = await contextFor(sessionId, options);
      const target = processes.get(context.key);
      const actor = await recordGitActor({
        env,
        overwrite: false,
        reason: "opencode-terminal-input",
        runtime: context.runtime,
        session: context.session,
        sourceRoot: terminalSessionSourceRoot(context.session),
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

  return { startTerminal, readTerminal, closeTerminal, subscribeTerminal, resizeTerminal, writeTerminal, terminalHost };
}
