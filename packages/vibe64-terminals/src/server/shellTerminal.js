import {
  closeTerminalSessionsForNamespace,
  startTerminalSession,
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  access
} from "node:fs/promises";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  terminalOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  claimSessionWorkflowDriver
} from "@local/vibe64-core/server/sessionWorkflowDriver";
import {
  vibe64Result,
  directoryExists,
  shellTerminalNamespace,
  ensureTerminalSessionSourceGitSelfContained,
  terminalContainerName,
  pathInsideOrEqual,
  terminalTargetRoot,
  terminalWorktreePath
} from "./terminalShared.js";
import {
  resolveTerminalToolchainImage
} from "./terminalToolchainImage.js";
import {
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";
import {
  ensureAdapterRuntimeContainers
} from "./terminalRuntimeContainers.js";
import {
  recordSessionGitCommandActor,
  resolveSessionGitCommandActorTerminalHome
} from "./sessionGitCommandActor.js";
import {
  targetToolchainTerminalArgs
} from "./targetToolchainTerminal.js";
import {
  closeOwnedTerminalSession,
  listOwnedTerminalSessions,
  readOwnedTerminalSession,
  resizeOwnedTerminalSession,
  subscribeOwnedTerminalSession,
  writeOwnedTerminalSessionText
} from "@local/studio-terminal-core/server/terminalAccess";

const MAX_OPEN_SHELL_TERMINALS = 9;
const SHELL_DETACHED_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SHELL_TARGET_WORKTREE = "worktree";
const SHELL_CONTAINER_COMMAND = "bash";
const SHELL_RC_PATH = "/tmp/vibe64-shell.bashrc";
const SHELL_TERMINAL_COLOR_ENV = Object.freeze({
  COLORTERM: "truecolor",
  FORCE_COLOR: "1",
  TERM: "xterm-256color"
});

function normalizeShellTarget(value = "") {
  const target = String(value || "").trim();
  return target && target !== SHELL_TARGET_WORKTREE ? "" : SHELL_TARGET_WORKTREE;
}

function defaultShellCommand() {
  return SHELL_CONTAINER_COMMAND;
}

function shellTargetLabel(target = "") {
  void target;
  return "worktree";
}

function shellPromptLabel(target = "") {
  void target;
  return "worktree";
}

function shellPrompt(target = "") {
  const label = shellPromptLabel(target);
  return [
    "\\[\\e[38;5;39m\\]studio",
    "\\[\\e[0m\\]",
    " ",
    `\\[\\e[38;5;214m\\]${label}`,
    "\\[\\e[0m\\]",
    " ",
    "\\[\\e[38;5;245m\\]\\w",
    "\\[\\e[0m\\]",
    " \\$ "
  ].join("");
}

function shellTerminalEnv({
  env = {},
  target = "",
  targetRoot = "",
  workdir = ""
} = {}) {
  return {
    ...env,
    ...SHELL_TERMINAL_COLOR_ENV,
    VIBE64_PROJECT_ROOT: targetRoot,
    VIBE64_SHELL_PROMPT: shellPrompt(target),
    VIBE64_SHELL_TARGET: target,
    VIBE64_SHELL_WORKDIR: workdir,
    LOGNAME: "studio",
    PS1: shellPrompt(target),
    SHELL: "/bin/bash",
    USER: "studio"
  };
}

function shellRcFileSetupLines() {
  return [
    `cat > ${SHELL_RC_PATH} <<'VIBE64_SHELL_RC'`,
    "shopt -s checkwinsize 2>/dev/null || true",
    "PROMPT_DIRTRIM=4",
    "export TERM=${TERM:-xterm-256color}",
    "export COLORTERM=${COLORTERM:-truecolor}",
    "export FORCE_COLOR=${FORCE_COLOR:-1}",
    "if [ -x /usr/bin/dircolors ]; then",
    "  test -r \"$HOME/.dircolors\" && eval \"$(dircolors -b \"$HOME/.dircolors\")\" || eval \"$(dircolors -b)\"",
    "fi",
    "alias ls='ls --color=auto'",
    "alias ll='ls -alF --color=auto'",
    "alias la='ls -A --color=auto'",
    "alias grep='grep --color=auto'",
    "alias fgrep='fgrep --color=auto'",
    "alias egrep='egrep --color=auto'",
    "PS1=\"${VIBE64_SHELL_PROMPT:-\\w \\$ }\"",
    "VIBE64_SHELL_RC"
  ];
}

function shellContainerName({
  sessionId = "",
  targetRoot = "",
  target = "",
  terminalId = ""
} = {}) {
  return terminalContainerName({
    kind: "shell",
    parts: [target, sessionId, terminalId],
    targetRoot
  });
}

function shellContainerHostname(target = "") {
  return `vibe64-${shellPromptLabel(target)}`;
}

function shellStartupScript() {
  return studioUserStartupScript([
    SHELL_CONTAINER_COMMAND,
    "--rcfile",
    SHELL_RC_PATH,
    "-i"
  ], {
    setupLines: shellRcFileSetupLines()
  });
}

function shellTerminalArgs({
  containerName = "",
  env = {},
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  githubToolHomeSource = "",
  hostGid = "",
  hostUid = "",
  sessionId = "",
  target = "",
  targetRoot = "",
  terminalId = "",
  toolHomeSource = "",
  workdir = ""
} = {}) {
  return targetToolchainTerminalArgs({
    commandArgs: [
      "bash",
      "-lc",
      shellStartupScript()
    ],
    containerName,
    dockerRunArgs: [
      "--hostname",
      shellContainerHostname(target)
    ],
    env: shellTerminalEnv({
      env,
      target,
      targetRoot,
      workdir
    }),
    extraLabels: [
      studioDockerLabel("shell-target", target)
    ],
    image,
    githubToolHomeSource,
    hostGid,
    hostUid,
    kind: "shell-terminal",
    sessionId,
    targetRoot,
    terminalId,
    toolHomeSource,
    workdir
  });
}

async function resolveShellTerminalToolHome({
  env = process.env,
  logger = null,
  operation = "",
  session = {}
} = {}) {
  const result = await resolveSessionGitCommandActorTerminalHome({
    env,
    logger,
    operation,
    session,
    terminalKind: "shell"
  });
  if (result?.ok === false) {
    return {
      ok: false,
      error: result.error || "GitHub account storage is not available for shell terminals."
    };
  }
  const githubRequired = result.githubRequired !== false;
  if (githubRequired) {
    try {
      await access(result.githubToolHomeSource);
    } catch {
      return {
        ok: false,
        error: "GitHub is not ready for shell terminals. Connect GitHub before opening a shell."
      };
    }
  }
  return {
    ok: true,
    githubToolHomeSource: result.githubToolHomeSource || "",
    hostGid: result.hostGid,
    hostUid: result.hostUid,
    owner: result.owner,
    toolHomeSource: result.toolHomeSource
  };
}

async function resolveShellTerminalCwd({
  projectService = {},
  session = {},
  target = ""
} = {}) {
  const normalizedTarget = normalizeShellTarget(target);
  const targetRoot = terminalTargetRoot(session, projectService);
  if (!targetRoot) {
    return {
      ok: false,
      error: "Vibe64 shell target root is not available."
    };
  }
  if (normalizedTarget !== SHELL_TARGET_WORKTREE) {
    return {
      ok: false,
      error: "Shell target must be worktree."
    };
  }

  const worktreePath = terminalWorktreePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      error: "Create the session clone before opening a shell."
    };
  }
  const sessionRoot = String(session.sessionRoot || "").trim();
  if (!pathInsideOrEqual(targetRoot, worktreePath) && (!sessionRoot || !pathInsideOrEqual(sessionRoot, worktreePath))) {
    return {
      ok: false,
      error: "Session clone directory is outside the target root and session state root."
    };
  }
  if (!await directoryExists(worktreePath)) {
    return {
      ok: false,
      error: `Session clone directory does not exist: ${worktreePath}`
    };
  }
  return {
    cwd: worktreePath,
    ok: true
  };
}

function createShellTerminalController({
  env = process.env,
  logger = null,
  projectService
} = {}) {
  return Object.freeze({
    closeAllForSession(sessionId) {
      return closeTerminalSessionsForNamespace(shellTerminalNamespace(sessionId));
    },

    closeTerminal(sessionId, terminalSessionId, input = {}) {
      return closeOwnedTerminalSession(terminalSessionId, {
        env,
        input,
        logger,
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    readTerminal(sessionId, terminalSessionId, input = {}) {
      return readOwnedTerminalSession(terminalSessionId, {
        env,
        input,
        logger,
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    listTerminals(sessionId, input = {}) {
      return {
        ok: true,
        terminals: listOwnedTerminalSessions({
          env,
          input,
          namespace: shellTerminalNamespace(sessionId),
          runningOnly: true
        }).filter((terminal) => normalizeShellTarget(terminal?.metadata?.target || "") === SHELL_TARGET_WORKTREE)
      };
    },

    async startTerminal(sessionId, input = {}) {
      return vibe64Result(async () => {
        const target = normalizeShellTarget(input?.target);
        if (!target) {
          return {
            ok: false,
            error: "Shell target must be worktree."
          };
        }

        const runtime = await projectService.createRuntime({
          input: {
            sessionId
          }
        });
        const session = await runtime.getSession(sessionId);
        const cwdResult = await resolveShellTerminalCwd({
          projectService,
          session,
          target
        });
        if (cwdResult.ok === false) {
          return cwdResult;
        }
        await ensureTerminalSessionSourceGitSelfContained({
          session,
          workdir: cwdResult.cwd
        });
        const reuseRunning = input?.reuseRunning !== false;
        const targetRoot = terminalTargetRoot(session, projectService);
        const imageResult = await resolveTerminalToolchainImage({
          runtime,
          session,
          target,
          targetRoot
        });
        if (imageResult.ok === false) {
          return imageResult;
        }
        const driverResult = await claimSessionWorkflowDriver(runtime, sessionId, {
          originId: input?.originId || "",
          reason: `shell-terminal:${target}`,
          vibe64User: input?.vibe64User || null
        });
        const driverSession = driverResult.session || session;
        const actorResult = await recordSessionGitCommandActor({
          env,
          reason: `shell-terminal:${target}`,
          runtime,
          session: driverSession,
          targetRoot,
          vibe64User: input?.vibe64User || null,
          workdir: cwdResult.cwd
        });
        if (actorResult?.ok === false) {
          return actorResult;
        }
        const toolHomeResult = await resolveShellTerminalToolHome({
          env,
          logger,
          operation: target,
          session: actorResult.session || session
        });
        if (toolHomeResult.ok === false) {
          return toolHomeResult;
        }

        await ensureTargetRuntimeNetwork(targetRoot);
        await ensureAdapterRuntimeContainers({
          runtime,
          session,
          target,
          targetRoot
        });
        const shellCommand = defaultShellCommand();
        const terminalEnv = await projectTerminalEnvironment({
          projectService,
          runtime,
          session,
          target,
          targetRoot
        });
        const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
        const namespace = shellTerminalNamespace(sessionId);
        const ownerMetadata = terminalOwnerMetadata(toolHomeResult.owner).terminalOwner;
        return startTerminalSession({
          args: ({ id }) => shellTerminalArgs({
            containerName: shellContainerName({
              sessionId,
              targetRoot,
              target,
              terminalId: id
            }),
            env: terminalEnv,
            githubToolHomeSource: toolHomeResult.githubToolHomeSource,
            hostGid: toolHomeResult.hostGid,
            hostUid: toolHomeResult.hostUid,
            image: imageResult.image,
            sessionId,
            target,
            targetRoot,
            terminalId: id,
            toolHomeSource: toolHomeResult.toolHomeSource,
            workdir: cwdResult.cwd
          }),
          command: "docker",
          commandPreview: `${shellCommand} (${shellTargetLabel(target)}, ${imageResult.label}) - ${cwdResult.cwd}`,
          cwd: cwdResult.cwd,
          detachedIdleTimeoutMs: SHELL_DETACHED_IDLE_TIMEOUT_MS,
          maxRunning: MAX_OPEN_SHELL_TERMINALS,
          metadata: {
            cwd: cwdResult.cwd,
            envHash: terminalEnvHash,
            image: imageResult.image,
            imageLabel: imageResult.label,
            sessionId,
            shell: shellCommand,
            target,
            targetLabel: shellTargetLabel(target),
            terminalKind: "shell",
            terminalOwner: ownerMetadata
          },
          namespace,
          namespaceLimitPrefix: namespace,
          reuseRunning: reuseRunning
            ? (runningSession) => {
              return runningSession.metadata?.target === target &&
                runningSession.metadata?.envHash === terminalEnvHash &&
                runningSession.metadata?.image === imageResult.image &&
                runningSession.metadata?.cwd === cwdResult.cwd;
            }
            : false
        });
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber, input = {}) {
      return subscribeOwnedTerminalSession(terminalSessionId, subscriber, {
        env,
        input,
        logger,
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data, input = {}) {
      return writeOwnedTerminalSessionText(terminalSessionId, data, {
        env,
        input,
        logger,
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size, input = {}) {
      return resizeOwnedTerminalSession(terminalSessionId, size, {
        env,
        input,
        logger,
        namespace: shellTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  SHELL_TARGET_WORKTREE,
  SHELL_DETACHED_IDLE_TIMEOUT_MS,
  createShellTerminalController,
  defaultShellCommand,
  normalizeShellTarget,
  resolveShellTerminalCwd,
  resolveShellTerminalToolHome,
  shellStartupScript,
  shellTerminalArgs
};
