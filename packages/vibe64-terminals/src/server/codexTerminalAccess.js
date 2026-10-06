import path from "node:path";
import {
  codexInteractiveArguments,
  normalizeCodexThreadId
} from "@jskit-ai/assistant-core/server/codex-configuration";
import { STUDIO_MANAGED_CODEX_COMMAND } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { studioUserStartupScript } from "@local/studio-terminal-core/server/studioToolHome";
import { terminalAppOwnerMetadata } from "@local/studio-terminal-core/server/terminalOwnership";
import { effectiveVibe64AgentSettings } from "@local/vibe64-runtime/shared";
import { withGenesisCommandShim } from "@local/vibe64-genesis/server";
import { VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV } from "./codexGitCommand.js";
import { listTerminalSessions } from "@local/vibe64-execution/server/terminalSessions";
import { codexTerminalNamespace, globalCodexTerminalNamespace, terminalWorktreePath } from "./terminalShared.js";

const MAX_OPEN_CODEX_TERMINALS = 3;

function normalizeText(value) {
  return String(value || "").trim();
}

function codexAppTerminalOwnerMetadata(toolHome = {}) {
  return terminalAppOwnerMetadata({
    githubToolHomeSource: toolHome.toolHomeSource,
    ownerUserKey: "codex"
  });
}

function codexGitCommandWrapperSetupLines() {
  return [
    `if [ -n "\${${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}:-}" ]; then`,
    "  if [ \"$(id -u)\" = \"0\" ]; then",
    "    for VIBE64_CODEX_GIT_COMMAND_NAME in git gh; do",
    `      if [ -x "$${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}/$VIBE64_CODEX_GIT_COMMAND_NAME" ]; then`,
    `        ln -sfn "$${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}/$VIBE64_CODEX_GIT_COMMAND_NAME" "/usr/local/bin/$VIBE64_CODEX_GIT_COMMAND_NAME"`,
    "      fi",
    "    done",
    "    unset VIBE64_CODEX_GIT_COMMAND_NAME",
    "  fi",
    "fi"
  ];
}

function codexGitCommandShimDirs(codexRuntime = {}) {
  const terminalProcessEnv = codexRuntime?.terminalProcessEnv || {};
  const terminalEnv = codexRuntime?.terminalEnv || {};
  const wrapperDir = normalizeText(
    terminalProcessEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV] ||
    terminalEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]
  );
  return withGenesisCommandShim(
    wrapperDir && path.isAbsolute(wrapperDir) ? [path.resolve(wrapperDir)] : []
  );
}

function codexStartupScript(codexThreadId = "", {
  agentSettings = {},
  remoteEndpoint = ""
} = {}) {
  const normalizedThreadId = normalizeCodexThreadId(codexThreadId);
  const normalizedRemoteEndpoint = normalizeText(remoteEndpoint);
  const effectiveSettings = effectiveVibe64AgentSettings(agentSettings);
  const codexCommand = codexInteractiveArguments({
    command: STUDIO_MANAGED_CODEX_COMMAND,
    threadId: normalizedThreadId,
    remoteEndpoint: normalizedRemoteEndpoint,
    model: effectiveSettings.model,
    effort: effectiveSettings.thinking,
    disableStartupUpdates: true,
    bypassApprovalsAndSandbox: true,
    bypassHookTrust: true
  });
  return studioUserStartupScript(codexCommand, {
    setupLines: [
      "umask 0007",
      ...codexGitCommandWrapperSetupLines()
    ]
  });
}

function codexTerminalArgs({
  agentSettings = {},
  codexRemoteEndpoint = "",
  codexThreadId
}) {
  return [
    "-lc",
    codexStartupScript(codexThreadId, {
      agentSettings,
      remoteEndpoint: codexRemoteEndpoint
    })
  ];
}

function createCodexGatewayTerminal(runCommand) {
  async function startCodexGatewayTerminal({
    args,
    codexRuntime,
    cwd = "",
    detachedIdleTimeoutMs = 0,
    maxRunning = MAX_OPEN_CODEX_TERMINALS,
    metadata = {},
    namespace = "",
    onClose = async () => null,
    reuseRunning = false,
    session = {},
    executionRoot = "",
    workdir = ""
  } = {}) {
    return runCommand({
      actor: "app",
      allowedRoots: [
        executionRoot,
        cwd,
        workdir
      ].filter(Boolean),
      args,
      baseEnv: codexRuntime?.env || {},
      command: "bash",
      credentialHome: {
        home: codexRuntime?.toolHomeSource || "",
        username: codexRuntime?.username || codexRuntime?.userKey || ""
      },
      cwd,
      env: codexRuntime?.terminalEnv || {},
      envPolicy: "auth",
      mode: "pty",
      project: {
        sourceRoot: executionRoot
      },
      purpose: "codex",
      session,
      shimDirs: codexGitCommandShimDirs(codexRuntime),
      terminal: {
        commandPreview: "codex",
        detachedIdleTimeoutMs,
        maxRunning,
        metadata,
        namespace,
        onClose,
        reuseRunning
      }
    });
  }

  return startCodexGatewayTerminal;
}

function codexTerminalStatus(terminal = null) {
  if (!terminal) {
    return null;
  }
  return {
    commandPreview: terminal.commandPreview || "",
    id: terminal.id || "",
    inputVersion: terminal.inputVersion || 0,
    lastInputAt: terminal.lastInputAt || "",
    lastInputBytes: terminal.lastInputBytes || 0,
    lastOutputAt: terminal.lastOutputAt || "",
    lastOutputBytes: terminal.lastOutputBytes || 0,
    outputVersion: terminal.outputVersion || 0,
    status: terminal.status || ""
  };
}

function activeCodexTerminalSnapshots(session = {}) {
  const sessionId = String(session.sessionId || "").trim();
  if (!sessionId) {
    return [];
  }
  const workdir = terminalWorktreePath(session);
  return listTerminalSessions({
    namespace: codexTerminalNamespace(sessionId)
  })
    .filter((terminal) => terminal.status !== "exited")
    .filter((terminal) => !workdir || terminal.metadata?.workdir === workdir)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function activeCodexTerminal(session = {}) {
  const terminals = activeCodexTerminalSnapshots(session);
  const terminal = terminals[0] || null;
  return codexTerminalStatus(terminal);
}

function activeGlobalCodexTerminal(executionRoot = "") {
  const terminals = listTerminalSessions({
    namespace: globalCodexTerminalNamespace()
  })
    .filter((terminal) => terminal.status !== "exited")
    .filter((terminal) => !executionRoot || terminal.metadata?.executionRoot === executionRoot)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return codexTerminalStatus(terminals[0] || null);
}

export {
  activeCodexTerminal,
  activeGlobalCodexTerminal,
  codexAppTerminalOwnerMetadata,
  codexGitCommandShimDirs,
  codexTerminalArgs,
  createCodexGatewayTerminal,
  MAX_OPEN_CODEX_TERMINALS
};
