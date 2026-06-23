import {
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  startTerminalSession,
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  access,
  mkdir
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
  logGithubProviderHomeResolution,
  composeGithubTerminalHome,
  resolveGithubToolHomeForActor,
  VIBE64_PROVIDER_HOMES_ROOT_ENV
} from "@local/studio-terminal-core/server/providerHomes";
import {
  terminalOwnerFromGithubToolHome,
  terminalOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
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
import {
  closeOwnedTerminalSession,
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
  input = {},
  logger = null,
  operation = ""
} = {}) {
  const providerHomesRoot = String(env?.[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "").trim();
  const result = resolveGithubToolHomeForActor({
    env,
    providerHomesRoot,
    vibe64User: input?.vibe64User || null
  });
  logGithubProviderHomeResolution(logger, result, {
    operation,
    terminalKind: "shell"
  });
  if (result?.ok === false) {
    return {
      ok: false,
      error: result.error || "GitHub account storage is not available for shell terminals."
    };
  }
  try {
    await access(result.toolHomeSource);
  } catch {
    return {
      ok: false,
      error: "GitHub is not ready for shell terminals. Connect GitHub before opening a shell."
    };
  }
  const terminalHome = composeGithubTerminalHome(result, {
    providerHomesRoot
  });
  if (terminalHome?.ok === false) {
    return {
      ok: false,
      error: terminalHome.error || "Terminal account storage is not available for shell terminals."
    };
  }
  await mkdir(terminalHome.toolHomeSource, {
    mode: 0o700,
    recursive: true
  });
  return {
    ok: true,
    githubToolHomeSource: terminalHome.githubToolHomeSource,
    owner: terminalOwnerFromGithubToolHome(terminalHome),
    toolHomeSource: terminalHome.toolHomeSource
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
      error: "Create the session worktree before opening a shell."
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

function sameTerminalOwner(left = {}, right = {}) {
  return String(left?.ownerScope || "") === String(right?.ownerScope || "") &&
    String(left?.ownerUserKey || "") === String(right?.ownerUserKey || "");
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

    listTerminals(sessionId) {
      return {
        ok: true,
        terminals: listTerminalSessions({
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
        const toolHomeResult = await resolveShellTerminalToolHome({
          env,
          input,
          logger,
          operation: target
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
                runningSession.metadata?.cwd === cwdResult.cwd &&
                sameTerminalOwner(runningSession.metadata?.terminalOwner, ownerMetadata);
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
