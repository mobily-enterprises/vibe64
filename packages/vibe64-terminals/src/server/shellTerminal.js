import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSessionText
} from "@local/studio-terminal-core/server/terminalSessions";
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
  vibe64Result,
  directoryExists,
  shellTerminalNamespace,
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
  targetToolchainTerminalArgs
} from "./targetToolchainTerminal.js";

const MAX_OPEN_SHELL_TERMINALS = 9;
const SHELL_TARGET_MAIN = "main";
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
  return target === SHELL_TARGET_MAIN || target === SHELL_TARGET_WORKTREE ? target : "";
}

function defaultShellCommand() {
  return SHELL_CONTAINER_COMMAND;
}

function shellTargetLabel(target = "") {
  return target === SHELL_TARGET_MAIN ? "main repo" : "worktree";
}

function shellPromptLabel(target = "") {
  return target === SHELL_TARGET_MAIN ? "main" : "worktree";
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
  sessionId = "",
  target = "",
  targetRoot = "",
  terminalId = "",
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
    kind: "shell-terminal",
    sessionId,
    targetRoot,
    terminalId,
    workdir
  });
}

async function resolveShellTerminalCwd({
  projectService = {},
  session = {},
  target = ""
} = {}) {
  const targetRoot = terminalTargetRoot(session, projectService);
  if (!targetRoot) {
    return {
      ok: false,
      error: "Vibe64 shell target root is not available."
    };
  }
  if (!await directoryExists(targetRoot)) {
    return {
      ok: false,
      error: `Main repo directory does not exist: ${targetRoot}`
    };
  }

  if (target === SHELL_TARGET_MAIN) {
    return {
      cwd: targetRoot,
      ok: true
    };
  }

  const worktreePath = terminalWorktreePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      error: "Create the session worktree before opening a worktree shell."
    };
  }
  const sessionRoot = String(session.sessionRoot || "").trim();
  if (!pathInsideOrEqual(targetRoot, worktreePath) && (!sessionRoot || !pathInsideOrEqual(sessionRoot, worktreePath))) {
    return {
      ok: false,
      error: "Session worktree directory is outside the target root and session state root."
    };
  }
  if (!await directoryExists(worktreePath)) {
    return {
      ok: false,
      error: `Session worktree directory does not exist: ${worktreePath}`
    };
  }
  return {
    cwd: worktreePath,
    ok: true
  };
}

function createShellTerminalController({ projectService } = {}) {
  return Object.freeze({
    closeAllForSession(sessionId) {
      return closeTerminalSessionsForNamespace(shellTerminalNamespace(sessionId));
    },

    closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      return vibe64Result(async () => {
        const target = normalizeShellTarget(input?.target);
        if (!target) {
          return {
            ok: false,
            error: "Shell target must be worktree or main."
          };
        }

        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const cwdResult = await resolveShellTerminalCwd({
          projectService,
          session,
          target
        });
        if (cwdResult.ok === false) {
          return cwdResult;
        }
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
        return startTerminalSession({
          args: ({ id }) => shellTerminalArgs({
            containerName: shellContainerName({
              sessionId,
              targetRoot,
              target,
              terminalId: id
            }),
            env: terminalEnv,
            image: imageResult.image,
            sessionId,
            target,
            targetRoot,
            terminalId: id,
            workdir: cwdResult.cwd
          }),
          command: "docker",
          commandPreview: `${shellCommand} (${shellTargetLabel(target)}, ${imageResult.label}) - ${cwdResult.cwd}`,
          cwd: cwdResult.cwd,
          maxRunning: MAX_OPEN_SHELL_TERMINALS,
          metadata: {
            cwd: cwdResult.cwd,
            envHash: terminalEnvHash,
            image: imageResult.image,
            imageLabel: imageResult.label,
            sessionId,
            shell: shellCommand,
            target,
            targetLabel: shellTargetLabel(target)
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

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSessionText(terminalSessionId, data, {
        namespace: shellTerminalNamespace(sessionId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: shellTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  SHELL_TARGET_MAIN,
  SHELL_TARGET_WORKTREE,
  createShellTerminalController,
  defaultShellCommand,
  normalizeShellTarget,
  resolveShellTerminalCwd,
  shellStartupScript,
  shellTerminalArgs
};
