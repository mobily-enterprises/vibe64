import {
  runDocker
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
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  createRuntimeContainerDoctorEntries
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE as TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_CODEX_COMMAND
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  resolveStudioAppRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  createDoctorRepair,
  failDoctorCheck as failCheck,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  packageManagerAvailabilityScript
} from "@local/vibe64-adapters/server/nodePackage";
import {
  createJskitTenantMariaDbRuntimeContainer
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";

const TERMINAL_NAMESPACE = "studio-setup-doctor";
const STUDIO_SETUP_CACHE_SCOPE = "studio-setup-runtime-v1";

const isStudioSetupReady = areDoctorChecksReady;

function createRepair(options = {}) {
  return createDoctorRepair({
    ...options
  });
}

function ownerRequired(input = {}) {
  const user = input?.vibe64User || null;
  if (!user) {
    return null;
  }
  if (user.role === "owner") {
    return null;
  }
  return {
    error: "Only the Vibe64 owner can run Studio setup actions.",
    errors: [
      {
        code: "vibe64_owner_required",
        message: "Only the Vibe64 owner can run Studio setup actions."
      }
    ],
    ok: false
  };
}

function manualDockerRepair() {
  return createRepair({
    actionId: "manual-docker",
    command: "docker version",
    kind: "manual",
    label: "Install and start Docker"
  });
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
    return hardStopCheck({
      id: "toolchain-image",
      label: "Managed base toolchain image",
      expected: `${TOOLCHAIN_IMAGE} exists locally.`,
      observed: result.output,
      explanation: "This Vibe64 editor does not have the required managed base toolchain image locally. Pull the required GHCR image before Studio Setup runs."
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
  return hardStopCheck({
    id,
    label,
    expected: "Runs inside the managed base toolchain image.",
    observed: "Managed base toolchain image is missing.",
    explanation: "This Vibe64 host was not provisioned with the required managed base toolchain image."
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
    const failedCheck = repair ? failCheck : hardStopCheck;
    return failedCheck({
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

function createStudioToolchainDoctorPlugin() {
  return Object.freeze({
    id: "studio-toolchain",
    label: "Studio toolchain",

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
                isValid: (output) => /^v\d+\./u.test(output.trim())
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
                isValid: (output) => /^\d+\./u.test(output.trim())
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
                isValid: (output) => /^\d+\./u.test(output.trim())
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
                isValid: (output) => /^\d+\./u.test(output.trim())
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
                isValid: (output) => /^\d+\./u.test(output.trim())
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
                isValid: (output) => /^\d+\./u.test(output.trim())
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
                explanation: "Vibe64 uses git for status, diffs, commits, and project worktrees.",
                isValid: (output) => output.includes("git version")
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
                isValid: (output) => output.toLowerCase().includes("ripgrep")
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
                explanation: "Studio uses Playwright for local UI verification without reinstalling browsers in every session clone.",
                isValid: (output) => output.includes("Version ") && output.includes("/ms-playwright/")
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
                explanation: "Vibe64 uses GitHub CLI for repository, branch, and pull request workflows.",
                isValid: (output) => output.toLowerCase().includes("gh version")
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
                commandArgs: [STUDIO_MANAGED_CODEX_COMMAND, "--version"],
                expected: "Codex runs inside the managed base toolchain.",
                explanation: "Studio delegates implementation work to local Codex sessions.",
                isValid: (output) => output.trim().length > 0
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
                isValid: (output) => output.includes("bwrap") || output.toLowerCase().includes("bubblewrap")
              })
              : missingToolchainCheck("codex-sandbox", "Codex sandbox");
          }
        },
      ];
    },

    startTerminal() {
      return null;
    }
  });
}

function createStudioRuntimeDoctorPlugin({
  runCommand,
  studioRoot = ""
} = {}) {
  const toolkit = createDoctorPluginToolkit({
    runCommand,
    startTerminalSession,
    studioRoot,
    targetRoot: studioRoot,
    terminalNamespace: TERMINAL_NAMESPACE
  });
  const mariaDbContainer = createJskitTenantMariaDbRuntimeContainer({
    targetRoot: studioRoot
  });
  const runtimeContainers = createRuntimeContainerDoctorEntries(toolkit, [
    mariaDbContainer
  ], {
    adapterId: "jskit",
    targetRoot: studioRoot
  });

  return toolkit.plugin({
    id: "studio-runtime",
    label: "Studio runtime",
    checks: runtimeContainers.checks,
    terminalActions: runtimeContainers.terminalActions
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
    scope: STUDIO_SETUP_CACHE_SCOPE,
    studioRoot: resolvedStudioRoot,
    targetRoot: targetRoot || resolvedStudioRoot
  });
  const plugins = [
    createStudioToolchainDoctorPlugin(),
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
      const ownerError = ownerRequired(input);
      if (ownerError) {
        return ownerError;
      }
      return readyStatusCache.remember(await inspectStudioSetup({
        plugins
      }));
    },

    async streamStatus(input = {}) {
      const {
        emit,
        refresh = false
      } = input;
      if (!refreshRequested({ refresh })) {
        const cachedStatus = await readyStatusCache.read();
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      const ownerError = ownerRequired(input);
      if (ownerError) {
        return ownerError;
      }
      return readyStatusCache.remember(await inspectStudioSetup({
        emit,
        plugins
      }));
    },

    async startTerminal(input = {}) {
      const ownerError = ownerRequired(input);
      if (ownerError) {
        return ownerError;
      }

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

    readTerminal(sessionId, input = {}) {
      const ownerError = ownerRequired(input);
      if (ownerError) {
        return ownerError;
      }

      return readTerminalSession(sessionId, { namespace: TERMINAL_NAMESPACE });
    },

    writeTerminal(sessionId, data, input = {}) {
      const ownerError = ownerRequired(input);
      if (ownerError) {
        return ownerError;
      }

      return writeTerminalSession(sessionId, data, { namespace: TERMINAL_NAMESPACE });
    },

    closeTerminal(sessionId, input = {}) {
      const ownerError = ownerRequired(input);
      if (ownerError) {
        return ownerError;
      }

      return closeTerminalSession(sessionId, { namespace: TERMINAL_NAMESPACE });
    }
  });
}

export {
  TOOLCHAIN_IMAGE,
  resolveStudioRoot,
  createStudioToolchainDoctorPlugin,
  createStudioRuntimeDoctorPlugin,
  isStudioSetupReady,
  createService
};
