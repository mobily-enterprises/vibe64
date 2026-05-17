import path from "node:path";
import process from "node:process";
import {
  dockerCommand,
  runDocker
} from "./containerEngine.js";
import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  createReadyStatusCache
} from "../../../../server/lib/doctorStatusCache.js";
import {
  areDoctorChecksReady,
  runDoctorPlugins,
  startDoctorPluginTerminal
} from "../../../../server/lib/doctorPlugins.js";
import {
  AI_STUDIO_APP_ROOT_ENV,
  STUDIO_BASE_TOOLCHAIN_IMAGE as TOOLCHAIN_IMAGE
} from "../../../../server/lib/studioRuntimeIdentity.js";
import {
  createDoctorRepair,
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "../../../../server/lib/doctorCheckItems.js";
import {
  buildDoctorTerminalArgs,
  buildDoctorToolchainArgs
} from "../../../../server/lib/doctorToolchain.js";

const TOOLCHAIN_DOCKERFILE = "tooling/studio-setup/Dockerfile";
const TOOLCHAIN_CONTEXT = "tooling/studio-setup";
const REQUIRED_GH_SCOPES = ["repo", "read:org", "gist", "workflow"];
const TERMINAL_NAMESPACE = "studio-setup-doctor";

const isStudioSetupReady = areDoctorChecksReady;

function commandPreview(args) {
  return dockerCommand(args);
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
    `echo '$ ${commandPreview(args)}'`,
    commandPreview(args)
  ].join("\n");
}

function startBashTerminal({
  commandPreview,
  cwd = "",
  script
}) {
  return startTerminalSession({
    args: ["-lc", script],
    command: "bash",
    commandPreview,
    cwd,
    namespace: TERMINAL_NAMESPACE
  });
}

function startDockerTerminal({
  args,
  commandPreview
}) {
  return startTerminalSession({
    args,
    command: "docker",
    commandPreview,
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

function ghLoginCommandArgs() {
  return [
    "gh",
    "auth",
    "login",
    "--hostname",
    "github.com",
    "--git-protocol",
    "https",
    "--web",
    "--scopes",
    REQUIRED_GH_SCOPES.join(",")
  ];
}

function ghLoginRepair() {
  const args = buildDoctorTerminalArgs(ghLoginCommandArgs());
  return createRepair({
    actionId: "terminal-gh-login",
    command: commandPreview(args),
    kind: "terminal",
    label: "Log in to GitHub"
  });
}

function ghReauthScript() {
  return [
    "gh auth logout --hostname github.com",
    `exec ${commandPreview(ghLoginCommandArgs())}`
  ].join("\n");
}

function ghReauthRepair() {
  const args = buildDoctorTerminalArgs(["bash", "-lc", ghReauthScript()]);

  return createRepair({
    actionId: "terminal-gh-reauth",
    command: commandPreview(args),
    kind: "terminal",
    label: "Re-authenticate GitHub"
  });
}

function codexBrowserLoginCommandArgs() {
  return [
    "codex",
    "login"
  ];
}

function codexDeviceLoginCommandArgs() {
  return [
    "codex",
    "login",
    "--device-auth"
  ];
}

function codexReauthScript(commandArgs) {
  return [
    "codex logout || true",
    `exec ${commandPreview(commandArgs)}`
  ].join("\n");
}

function codexLoginRepair() {
  const args = buildDoctorTerminalArgs(codexBrowserLoginCommandArgs(), ["--network", "host"]);

  return createRepair({
    actionId: "terminal-codex-login",
    command: commandPreview(args),
    kind: "terminal",
    label: "Log in to Codex with browser"
  });
}

function codexDeviceLoginRepair() {
  const args = buildDoctorTerminalArgs(codexDeviceLoginCommandArgs());

  return createRepair({
    actionId: "terminal-codex-device-login",
    command: commandPreview(args),
    kind: "terminal",
    label: "Log in to Codex with device code"
  });
}

function codexReauthRepair() {
  const script = codexReauthScript(codexBrowserLoginCommandArgs());
  const args = buildDoctorTerminalArgs(["bash", "-lc", script], ["--network", "host"]);

  return createRepair({
    actionId: "terminal-codex-reauth",
    command: commandPreview(args),
    kind: "terminal",
    label: "Re-authenticate Codex with browser"
  });
}

function codexDeviceReauthRepair() {
  const script = codexReauthScript(codexDeviceLoginCommandArgs());
  const args = buildDoctorTerminalArgs(["bash", "-lc", script]);

  return createRepair({
    actionId: "terminal-codex-device-reauth",
    command: commandPreview(args),
    kind: "terminal",
    label: "Re-authenticate Codex with device code"
  });
}

function codexLoginRepairs(hostNetworkReady) {
  return [
    hostNetworkReady ? codexLoginRepair() : null,
    codexDeviceLoginRepair()
  ].filter(Boolean);
}

function codexReauthRepairs(hostNetworkReady) {
  return [
    hostNetworkReady ? codexReauthRepair() : null,
    codexDeviceReauthRepair()
  ].filter(Boolean);
}

function resolveStudioRoot(studioRoot) {
  const configuredRoot = String(studioRoot || process.env[AI_STUDIO_APP_ROOT_ENV] || "").trim();
  return path.resolve(configuredRoot || process.cwd());
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

async function checkHostNetwork(toolchainReady) {
  if (!toolchainReady) {
    return {
      ok: false,
      output: "Managed base toolchain image is missing."
    };
  }

  const result = await runDocker(buildDoctorToolchainArgs([
    "bash",
    "-lc",
    "true"
  ], ["--network", "host"]), {
    timeout: 20000
  });

  return {
    ok: result.ok,
    output: result.output || (result.ok ? "Docker host networking is available." : "Docker host networking is unavailable.")
  };
}

async function checkGitHubAuth(toolchainReady) {
  if (!toolchainReady) {
    return missingToolchainCheck("gh-auth", "GitHub login");
  }

  const result = await runDocker(buildDoctorToolchainArgs([
    "gh",
    "auth",
    "status",
    "--hostname",
    "github.com"
  ]), {
    timeout: 20000
  });
  const output = result.output;
  const missingScopes = REQUIRED_GH_SCOPES.filter((scope) => !output.includes(scope));

  if (!result.ok || missingScopes.length > 0) {
    return failCheck({
      id: "gh-auth",
      label: "GitHub login",
      expected: `Logged in to github.com with scopes ${REQUIRED_GH_SCOPES.join(", ")}.`,
      observed: output,
      explanation: "Studio needs GH authenticated inside the managed base toolchain to inspect remotes and run deploy flows later.",
      repair: ghLoginRepair()
    });
  }

  return passCheck({
    id: "gh-auth",
    label: "GitHub login",
    expected: `Logged in to github.com with scopes ${REQUIRED_GH_SCOPES.join(", ")}.`,
    observed: output,
    explanation: "GH is authenticated inside the managed base toolchain.",
    repair: ghReauthRepair()
  });
}

async function checkCodexAuth(toolchainReady, hostNetwork) {
  if (!toolchainReady) {
    return missingToolchainCheck("codex-auth", "Codex login");
  }

  const result = await runDocker(buildDoctorToolchainArgs(["codex", "login", "status"]), {
    timeout: 20000
  });

  if (!result.ok) {
    const repairs = codexLoginRepairs(hostNetwork.ok);

    return failCheck({
      id: "codex-auth",
      label: "Codex login",
      expected: "Codex login status succeeds inside the managed base toolchain.",
      observed: [
        result.output,
        `Docker host networking: ${hostNetwork.ok ? "available" : hostNetwork.output}`
      ].filter(Boolean).join("\n"),
      explanation: "Codex must be logged in before Studio can orchestrate local implementation sessions. Browser login uses Docker host networking when available; device-code login remains the fallback.",
      repair: repairs[0],
      repairs
    });
  }

  const repairs = codexReauthRepairs(hostNetwork.ok);

  return passCheck({
    id: "codex-auth",
    label: "Codex login",
    expected: "Codex login status succeeds inside the managed base toolchain.",
    observed: [
      result.output,
      `Docker host networking: ${hostNetwork.ok ? "available" : hostNetwork.output}`
    ].filter(Boolean).join("\n"),
    explanation: "Codex is authenticated inside the managed base toolchain.",
    repair: repairs[0],
    repairs
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
      let hostNetwork = {
        ok: false,
        output: ""
      };

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
            hostNetwork = await checkHostNetwork(toolchainReady);
            return result;
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
          id: "gh-auth",
          label: "GitHub login",
          run() {
            return checkGitHubAuth(toolchainReady);
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
                repair: buildToolchainRepair()
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
        {
          id: "codex-auth",
          label: "Codex login",
          run() {
            return checkCodexAuth(toolchainReady, hostNetwork);
          }
        }
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

      if (actionId === "terminal-gh-login") {
        const args = buildDoctorTerminalArgs(ghLoginCommandArgs());
        return startDockerTerminal({
          args,
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-gh-reauth") {
        const args = buildDoctorTerminalArgs(["bash", "-lc", ghReauthScript()]);
        return startDockerTerminal({
          args,
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-login") {
        const args = buildDoctorTerminalArgs(codexBrowserLoginCommandArgs(), ["--network", "host"]);
        return startDockerTerminal({
          args,
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-device-login") {
        const args = buildDoctorTerminalArgs(codexDeviceLoginCommandArgs());
        return startDockerTerminal({
          args,
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-reauth") {
        const script = codexReauthScript(codexBrowserLoginCommandArgs());
        const args = buildDoctorTerminalArgs(["bash", "-lc", script], ["--network", "host"]);
        return startDockerTerminal({
          args,
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-device-reauth") {
        const script = codexReauthScript(codexDeviceLoginCommandArgs());
        const args = buildDoctorTerminalArgs(["bash", "-lc", script]);
        return startDockerTerminal({
          args,
          commandPreview: commandPreview(args)
        });
      }

      return null;
    }
  });
}

function createService({ studioRoot = "" } = {}) {
  const resolvedStudioRoot = resolveStudioRoot(studioRoot);
  const readyStatusCache = createReadyStatusCache();
  const plugins = [
    createStudioRuntimeDoctorPlugin({
      studioRoot: resolvedStudioRoot
    })
  ];

  return Object.freeze({
    async getStatus() {
      const cachedStatus = readyStatusCache.read();
      if (cachedStatus) {
        return cachedStatus;
      }
      return readyStatusCache.remember(await inspectStudioSetup({
        plugins
      }));
    },

    async streamStatus({ emit } = {}) {
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
  codexBrowserLoginCommandArgs,
  codexDeviceLoginCommandArgs,
  codexLoginRepairs,
  resolveStudioRoot,
  isStudioSetupReady,
  createService
};
