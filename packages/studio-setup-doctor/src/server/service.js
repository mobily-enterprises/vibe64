import {
  dockerCommand,
  runDocker,
  shellQuote
} from "./containerEngine.js";
import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  createRepositoryReadyStatusCache
} from "@local/setup-doctor-core/server/doctorStatusCache";
import {
  areDoctorChecksReady,
  runDoctorPlugins,
  startDoctorPluginTerminal
} from "@local/setup-doctor-core/server/doctorPlugins";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE as TOOLCHAIN_IMAGE
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  resolveStudioAppRoot
} from "@local/ai-studio-core/server/studioRoots";
import {
  createDoctorRepair,
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "@local/ai-studio-core/server/doctorCheckItems";
import {
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  packageManagerAvailabilityScript
} from "@local/ai-studio-adapters/server/nodePackage";

const TOOLCHAIN_DOCKERFILE = "tooling/studio-setup/Dockerfile";
const TOOLCHAIN_CONTEXT = "tooling/studio-setup";
const TERMINAL_NAMESPACE = "studio-setup-doctor";
const REINSTALL_CODEX_CLI_TERMINAL_PREVIEW = "Reinstall Codex CLI inside the managed Studio toolchain";

const isStudioSetupReady = areDoctorChecksReady;

function commandPreview(args) {
  return dockerCommand(args);
}

function printCommandPreviewLine(command) {
  return `printf '%s\\n' ${shellQuote(`$ ${command}`)}`;
}

function printTerminalLine(message) {
  return `printf '%s\\n' ${shellQuote(message)}`;
}

function createRepair(options = {}) {
  return createDoctorRepair({
    ...options
  });
}

function buildToolchainScript() {
  const args = [
    "build",
    "-t",
    TOOLCHAIN_IMAGE,
    "-f",
    TOOLCHAIN_DOCKERFILE,
    TOOLCHAIN_CONTEXT
  ];

  return [
    "set -e",
    printCommandPreviewLine(commandPreview(args)),
    commandPreview(args)
  ].join("\n");
}

function startBashTerminal({
  commandPreview,
  cwd = "",
  metadata = {},
  script
}) {
  return startTerminalSession({
    args: ["-lc", script],
    command: "bash",
    commandPreview,
    cwd,
    metadata,
    namespace: TERMINAL_NAMESPACE
  });
}

function manualDockerRepair() {
  return createRepair({
    actionId: "manual-docker",
    command: "docker version",
    kind: "manual",
    label: "Install and start Docker"
  });
}

function buildToolchainRepair() {
  return createRepair({
    actionId: "build-toolchain",
    autoRun: true,
    command: commandPreview([
      "build",
      "-t",
      TOOLCHAIN_IMAGE,
      "-f",
      TOOLCHAIN_DOCKERFILE,
      TOOLCHAIN_CONTEXT
    ]),
    label: "Build managed base toolchain"
  });
}

function reinstallCodexCliScript() {
  return [
    "set -e",
    "CODEX_GLOBAL_PACKAGE_DIR=\"${NPM_CONFIG_PREFIX:?}/lib/node_modules/@openai\"",
    "echo '[studio] Removing broken Codex CLI install...'",
    "rm -rf \"$CODEX_GLOBAL_PACKAGE_DIR/codex\"",
    "rm -rf \"$CODEX_GLOBAL_PACKAGE_DIR/.codex-\"*",
    "echo '[studio] Reinstalling Codex CLI...'",
    "npm install -g @openai/codex@latest",
    "echo '[studio] Verifying Codex CLI...'",
    "codex --version"
  ].join("\n");
}

function reinstallCodexCliToolchainArgs() {
  return buildDoctorToolchainArgs([
    "bash",
    "-lc",
    reinstallCodexCliScript()
  ]);
}

function reinstallCodexCliRepair() {
  return createRepair({
    actionId: "reinstall-codex-cli",
    command: commandPreview(reinstallCodexCliToolchainArgs()),
    label: "Reinstall Codex CLI"
  });
}

function reinstallCodexCliTerminalScript() {
  const args = reinstallCodexCliToolchainArgs();
  return [
    "set -e",
    printTerminalLine("AI Studio setup: reinstalling Codex CLI."),
    printTerminalLine("Status: running. Keep this terminal open."),
    printTerminalLine("This can take a minute while npm downloads Codex and its native package."),
    commandPreview(args),
    printTerminalLine("Status: done. Codex CLI was reinstalled and verified."),
    printTerminalLine("It is safe to close this terminal.")
  ].join("\n");
}

function resolveStudioRoot(studioRoot) {
  return resolveStudioAppRoot({
    explicitRoot: studioRoot
  });
}

async function checkDocker() {
  const result = await runDocker(["version", "--format", "{{.Server.Version}}"], {
    timeout: 12000
  });

  if (!result.ok) {
    return failCheck({
      id: "docker",
      label: "Docker engine",
      expected: "Docker CLI can reach a running engine.",
      observed: result.output,
      explanation: "Studio Setup repair needs Docker because Studio provisions its managed runtime in containers.",
      repair: manualDockerRepair()
    });
  }

  return passCheck({
    id: "docker",
    label: "Docker engine",
    expected: "Docker CLI can reach a running engine.",
    observed: result.output,
    explanation: "Docker is reachable."
  });
}

async function checkDockerCompose(dockerReady) {
  if (!dockerReady) {
    return failCheck({
      id: "docker-compose",
      label: "Docker Compose plugin",
      expected: "docker compose is available.",
      observed: "Docker is not ready.",
      explanation: "Docker Compose is part of the required container toolchain.",
      repair: manualDockerRepair()
    });
  }

  const result = await runDocker(["compose", "version", "--short"], {
    timeout: 12000
  });

  if (!result.ok) {
    return failCheck({
      id: "docker-compose",
      label: "Docker Compose plugin",
      expected: "docker compose is available.",
      observed: result.output,
      explanation: "The Docker Compose plugin is required for later local services.",
      repair: createRepair({
        actionId: "manual-docker-compose",
        command: "docker compose version",
        kind: "manual",
        label: "Install Docker Compose plugin"
      })
    });
  }

  return passCheck({
    id: "docker-compose",
    label: "Docker Compose plugin",
    expected: "docker compose is available.",
    observed: result.output,
    explanation: "Docker Compose is available."
  });
}

async function checkToolchainImage(dockerReady) {
  if (!dockerReady) {
    return failCheck({
      id: "toolchain-image",
      label: "Managed base toolchain image",
      expected: `${TOOLCHAIN_IMAGE} exists locally.`,
      observed: "Docker is not ready.",
      explanation: "Studio cannot inspect the managed base toolchain until Docker is ready.",
      repair: manualDockerRepair()
    });
  }

  const result = await runDocker(["image", "inspect", TOOLCHAIN_IMAGE, "--format", "{{.Id}}"], {
    timeout: 12000
  });

  if (!result.ok) {
    return failCheck({
      id: "toolchain-image",
      label: "Managed base toolchain image",
      expected: `${TOOLCHAIN_IMAGE} exists locally.`,
      observed: result.output,
      explanation: "Build the managed base toolchain before checking git, GH, Codex, and Studio automation tools.",
      repair: buildToolchainRepair()
    });
  }

  return passCheck({
    id: "toolchain-image",
    label: "Managed base toolchain image",
    expected: `${TOOLCHAIN_IMAGE} exists locally.`,
    observed: result.output,
    explanation: "The managed base toolchain image is present."
  });
}

function missingToolchainCheck(id, label) {
  return failCheck({
    id,
    label,
    expected: "Runs inside the managed base toolchain image.",
    observed: "Managed base toolchain image is missing.",
    explanation: "Build the managed base toolchain image first.",
    repair: buildToolchainRepair()
  });
}

async function checkToolchainCommand({
  id,
  label,
  commandArgs,
  expected,
  explanation,
  isValid,
  repair
}) {
  const result = await runDocker(buildDoctorToolchainArgs(commandArgs), {
    timeout: 20000
  });

  if (!result.ok || !isValid(result.output)) {
    return failCheck({
      id,
      label,
      expected,
      observed: result.output,
      explanation,
      repair
    });
  }

  return passCheck({
    id,
    label,
    expected,
    observed: result.output,
    explanation
  });
}

async function inspectStudioSetup({
  emit = null,
  plugins = []
} = {}) {
  const checks = await runDoctorPlugins({
    emit,
    plugins
  });

  return {
    ok: true,
    blockedReason: isStudioSetupReady(checks) ? "" : "Studio Setup is incomplete.",
    ready: isStudioSetupReady(checks),
    checks,
    updatedAt: new Date().toISOString()
  };
}

function createStudioRuntimeDoctorPlugin({
  studioRoot = ""
} = {}) {
  return Object.freeze({
    id: "studio-runtime",
    label: "Studio runtime",

    checks() {
      let dockerReady = false;
      let toolchainReady = false;

      return [
        {
          id: "docker",
          label: "Docker engine",
          async run() {
            const result = await checkDocker();
            dockerReady = result.status === "pass";
            return result;
          }
        },
        {
          id: "docker-compose",
          label: "Docker Compose plugin",
          run() {
            return checkDockerCompose(dockerReady);
          }
        },
        {
          id: "toolchain-image",
          label: "Managed base toolchain image",
          async run() {
            const result = await checkToolchainImage(dockerReady);
            toolchainReady = result.status === "pass";
            return result;
          }
        },
        {
          id: "node",
          label: "Node.js",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "node",
                label: "Node.js",
                commandArgs: ["node", "--version"],
                expected: "Node.js runs inside the managed base toolchain.",
                explanation: "Studio uses Node.js for JavaScript and TypeScript project setup, scripts, and framework CLIs.",
                isValid: (output) => /^v\d+\./u.test(output.trim()),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("node", "Node.js");
          }
        },
        {
          id: "npm",
          label: "npm",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "npm",
                label: "npm",
                commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("npm")],
                expected: "npm runs inside the managed base toolchain.",
                explanation: "npm is the baseline Node package manager and backs npx-based project seed commands.",
                isValid: (output) => /^\d+\./u.test(output.trim()),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("npm", "npm");
          }
        },
        {
          id: "corepack",
          label: "Corepack",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "corepack",
                label: "Corepack",
                commandArgs: ["bash", "-lc", "command -v corepack >/dev/null 2>&1 && corepack --version"],
                expected: "Corepack runs inside the managed base toolchain.",
                explanation: "Studio uses Corepack to run pnpm and Yarn consistently in Node project worktrees.",
                isValid: (output) => /^\d+\./u.test(output.trim()),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("corepack", "Corepack");
          }
        },
        {
          id: "pnpm",
          label: "pnpm",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "pnpm",
                label: "pnpm",
                commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("pnpm")],
                expected: "pnpm runs through Corepack inside the managed base toolchain.",
                explanation: "Adapters can select pnpm without owning package-manager installation.",
                isValid: (output) => /^\d+\./u.test(output.trim()),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("pnpm", "pnpm");
          }
        },
        {
          id: "yarn",
          label: "Yarn",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "yarn",
                label: "Yarn",
                commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("yarn")],
                expected: "Yarn runs through Corepack inside the managed base toolchain.",
                explanation: "Adapters can select Yarn without owning package-manager installation.",
                isValid: (output) => /^\d+\./u.test(output.trim()),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("yarn", "Yarn");
          }
        },
        {
          id: "bun",
          label: "Bun",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "bun",
                label: "Bun",
                commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("bun")],
                expected: "Bun runs inside the managed base toolchain.",
                explanation: "Adapters can select Bun without owning package-manager installation.",
                isValid: (output) => /^\d+\./u.test(output.trim()),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("bun", "Bun");
          }
        },
        {
          id: "git",
          label: "git",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "git",
                label: "git",
                commandArgs: ["git", "--version"],
                expected: "git runs inside the managed base toolchain.",
                explanation: "Studio uses git for status, diffs, commits, and deployments.",
                isValid: (output) => output.includes("git version"),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("git", "git");
          }
        },
        {
          id: "ripgrep",
          label: "ripgrep",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "ripgrep",
                label: "ripgrep",
                commandArgs: ["rg", "--version"],
                expected: "ripgrep runs inside the managed base toolchain.",
                explanation: "Codex uses rg for fast local codebase search inside the managed base toolchain container.",
                isValid: (output) => output.toLowerCase().includes("ripgrep"),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("ripgrep", "ripgrep");
          }
        },
        {
          id: "playwright",
          label: "Playwright",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "playwright",
                label: "Playwright",
                commandArgs: [
                  "bash",
                  "-lc",
                  "version=\"$(playwright --version)\" && browser=\"$(find \"$PLAYWRIGHT_BROWSERS_PATH\" -maxdepth 4 -type f \\( -name chrome -o -name chrome-headless-shell \\) | head -n 1)\" && test -n \"$browser\" && printf '%s\\n%s\\n' \"$version\" \"$browser\""
                ],
                expected: "Playwright and Chromium run inside the managed base toolchain.",
                explanation: "Studio uses Playwright for local UI verification without reinstalling browsers in every session worktree.",
                isValid: (output) => output.includes("Version ") && output.includes("/ms-playwright/"),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("playwright", "Playwright");
          }
        },
        {
          id: "gh",
          label: "GitHub CLI",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "gh",
                label: "GitHub CLI",
                commandArgs: ["gh", "--version"],
                expected: "gh runs inside the managed base toolchain.",
                explanation: "Studio uses GitHub CLI for repository and deploy-adjacent workflows.",
                isValid: (output) => output.toLowerCase().includes("gh version"),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("gh", "GitHub CLI");
          }
        },
        {
          id: "codex",
          label: "Codex CLI",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "codex",
                label: "Codex CLI",
                commandArgs: ["codex", "--version"],
                expected: "Codex runs inside the managed base toolchain.",
                explanation: "Studio delegates implementation work to local Codex sessions.",
                isValid: (output) => output.trim().length > 0,
                repair: reinstallCodexCliRepair()
              })
              : missingToolchainCheck("codex", "Codex CLI");
          }
        },
        {
          id: "codex-sandbox",
          label: "Codex sandbox",
          run() {
            return toolchainReady
              ? checkToolchainCommand({
                id: "codex-sandbox",
                label: "Codex sandbox",
                commandArgs: [
                  "bash",
                  "-lc",
                  "command -v bwrap && bwrap --version"
                ],
                expected: "bubblewrap is available inside the managed base toolchain.",
                explanation: "Codex uses bubblewrap for sandboxing inside the managed base toolchain container.",
                isValid: (output) => output.includes("bwrap") || output.toLowerCase().includes("bubblewrap"),
                repair: buildToolchainRepair()
              })
              : missingToolchainCheck("codex-sandbox", "Codex sandbox");
          }
        },
      ];
    },

    startTerminal({
      actionId = ""
    } = {}) {
      if (actionId === "build-toolchain") {
        return startBashTerminal({
          commandPreview: buildToolchainRepair().commandPreview,
          cwd: studioRoot,
          script: buildToolchainScript()
        });
      }
      if (actionId === "reinstall-codex-cli") {
        return startBashTerminal({
          commandPreview: REINSTALL_CODEX_CLI_TERMINAL_PREVIEW,
          cwd: studioRoot,
          metadata: {
            commandDetails: reinstallCodexCliRepair().commandPreview
          },
          script: reinstallCodexCliTerminalScript()
        });
      }

      return null;
    }
  });
}

function refreshRequested(input = {}) {
  return input?.refresh === true || input?.refresh === "true" || input?.refresh === "1";
}

function createService({
  studioRoot = "",
  targetRoot = ""
} = {}) {
  const resolvedStudioRoot = resolveStudioRoot(studioRoot);
  const readyStatusCache = createRepositoryReadyStatusCache({
    doctorId: "studio-setup",
    studioRoot: resolvedStudioRoot,
    targetRoot: targetRoot || resolvedStudioRoot
  });
  const plugins = [
    createStudioRuntimeDoctorPlugin({
      studioRoot: resolvedStudioRoot
    })
  ];

  return Object.freeze({
    async getStatus(input = {}) {
      if (!refreshRequested(input)) {
        const cachedStatus = await readyStatusCache.read();
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      return readyStatusCache.remember(await inspectStudioSetup({
        plugins
      }));
    },

    async streamStatus({
      emit,
      refresh = false
    } = {}) {
      if (!refreshRequested({ refresh })) {
        const cachedStatus = await readyStatusCache.read();
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      return readyStatusCache.remember(await inspectStudioSetup({
        emit,
        plugins
      }));
    },

    async startTerminal(input = {}) {
      const actionId = String(input.actionId || "");
      const terminal = await startDoctorPluginTerminal({
        actionId,
        context: {
          studioRoot: resolvedStudioRoot
        },
        input,
        plugins
      });
      if (terminal) {
        return terminal;
      }

      return {
        ok: false,
        error: "Unknown terminal action."
      };
    },

    readTerminal(sessionId) {
      return readTerminalSession(sessionId, { namespace: TERMINAL_NAMESPACE });
    },

    writeTerminal(sessionId, data) {
      return writeTerminalSession(sessionId, data, { namespace: TERMINAL_NAMESPACE });
    },

    closeTerminal(sessionId) {
      return closeTerminalSession(sessionId, { namespace: TERMINAL_NAMESPACE });
    }
  });
}

export {
  TOOLCHAIN_IMAGE,
  resolveStudioRoot,
  REINSTALL_CODEX_CLI_TERMINAL_PREVIEW,
  reinstallCodexCliRepair,
  reinstallCodexCliScript,
  reinstallCodexCliTerminalScript,
  isStudioSetupReady,
  createService
};
