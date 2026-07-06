import path from "node:path";

import {
  closeTerminalSession,
  readTerminalSession,
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
  STUDIO_MANAGED_CODEX_COMMAND
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  resolveStudioAppRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  packageManagerAvailabilityScript
} from "@local/vibe64-adapters/server/nodePackage";

const TERMINAL_NAMESPACE = "studio-setup-doctor";
const STUDIO_SETUP_CACHE_SCOPE = "studio-setup-host-v2";

const isStudioSetupReady = areDoctorChecksReady;

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

function resolveStudioRoot(studioRoot) {
  return resolveStudioAppRoot({
    explicitRoot: studioRoot
  });
}

function isValidPlaywrightOutput(output = "") {
  const lines = String(output || "")
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const [versionLine, browserPath] = lines;
  return /^Version\s+\d+\./u.test(versionLine || "") &&
    Boolean(browserPath) &&
    path.isAbsolute(browserPath) &&
    /(?:^|\/)(?:chrome|chrome-headless-shell)$/u.test(browserPath);
}

async function checkHostCommand({
  id,
  label,
  commandArgs,
  expected,
  explanation,
  isValid
}) {
  const [command, ...args] = Array.isArray(commandArgs) ? commandArgs.map((arg) => String(arg)) : [];
  const result = command
    ? await runHostCommand(command, args, {
        timeout: 20000
      })
    : {
        ok: false,
        output: "Doctor command is empty."
      };

  if (!result.ok || !isValid(result.output)) {
    return hardStopCheck({
      id,
      label,
      expected,
      observed: result.output,
      explanation
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

function createStudioHostCommandDoctorPlugin() {
  return Object.freeze({
    id: "studio-host-commands",
    label: "Studio host commands",

    checks() {
      return [
        {
          id: "node",
          label: "Node.js",
          run() {
            return checkHostCommand({
              id: "node",
              label: "Node.js",
              commandArgs: ["node", "--version"],
              expected: "Node.js is installed on the host.",
              explanation: "Studio uses Node.js for JavaScript and TypeScript project setup, scripts, and framework CLIs.",
              isValid: (output) => /^v\d+\./u.test(output.trim())
            });
          }
        },
        {
          id: "npm",
          label: "npm",
          run() {
            return checkHostCommand({
              id: "npm",
              label: "npm",
              commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("npm")],
              expected: "npm is installed on the host.",
              explanation: "npm is the baseline Node package manager and backs npx-based project seed commands.",
              isValid: (output) => /^\d+\./u.test(output.trim())
            });
          }
        },
        {
          id: "corepack",
          label: "Corepack",
          run() {
            return checkHostCommand({
              id: "corepack",
              label: "Corepack",
              commandArgs: ["bash", "-lc", "command -v corepack >/dev/null 2>&1 && corepack --version"],
              expected: "Corepack is installed on the host.",
              explanation: "Studio uses Corepack to run pnpm and Yarn consistently in Node project worktrees.",
              isValid: (output) => /^\d+\./u.test(output.trim())
            });
          }
        },
        {
          id: "pnpm",
          label: "pnpm",
          run() {
            return checkHostCommand({
              id: "pnpm",
              label: "pnpm",
              commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("pnpm")],
              expected: "pnpm runs through Corepack on the host.",
              explanation: "Adapters can select pnpm without owning package-manager installation.",
              isValid: (output) => /^\d+\./u.test(output.trim())
            });
          }
        },
        {
          id: "yarn",
          label: "Yarn",
          run() {
            return checkHostCommand({
              id: "yarn",
              label: "Yarn",
              commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("yarn")],
              expected: "Yarn runs through Corepack on the host.",
              explanation: "Adapters can select Yarn without owning package-manager installation.",
              isValid: (output) => /^\d+\./u.test(output.trim())
            });
          }
        },
        {
          id: "bun",
          label: "Bun",
          run() {
            return checkHostCommand({
              id: "bun",
              label: "Bun",
              commandArgs: ["bash", "-lc", packageManagerAvailabilityScript("bun")],
              expected: "Bun is installed on the host.",
              explanation: "Adapters can select Bun without owning package-manager installation.",
              isValid: (output) => /^\d+\./u.test(output.trim())
            });
          }
        },
        {
          id: "git",
          label: "git",
          run() {
            return checkHostCommand({
              id: "git",
              label: "git",
              commandArgs: ["git", "--version"],
              expected: "git is installed on the host.",
              explanation: "Vibe64 uses git for status, diffs, commits, and project worktrees.",
              isValid: (output) => output.includes("git version")
            });
          }
        },
        {
          id: "ripgrep",
          label: "ripgrep",
          run() {
            return checkHostCommand({
              id: "ripgrep",
              label: "ripgrep",
              commandArgs: ["rg", "--version"],
              expected: "ripgrep is installed on the host.",
              explanation: "Codex uses rg for fast local codebase search.",
              isValid: (output) => output.toLowerCase().includes("ripgrep")
            });
          }
        },
        {
          id: "playwright",
          label: "Playwright",
          run() {
            return checkHostCommand({
              id: "playwright",
              label: "Playwright",
              commandArgs: [
                "bash",
                "-lc",
                "version=\"$(playwright --version)\" && browser=\"$(find \"${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}\" -maxdepth 4 -type f \\( -name chrome -o -name chrome-headless-shell \\) | head -n 1)\" && test -n \"$browser\" && printf '%s\\n%s\\n' \"$version\" \"$browser\""
              ],
              expected: "Playwright and Chromium are available on the host.",
              explanation: "Studio uses Playwright for local UI verification.",
              isValid: isValidPlaywrightOutput
            });
          }
        },
        {
          id: "gh",
          label: "GitHub CLI",
          run() {
            return checkHostCommand({
              id: "gh",
              label: "GitHub CLI",
              commandArgs: ["gh", "--version"],
              expected: "gh is installed on the host.",
              explanation: "Vibe64 uses GitHub CLI for repository, branch, and pull request workflows.",
              isValid: (output) => output.toLowerCase().includes("gh version")
            });
          }
        },
        {
          id: "codex",
          label: "Codex CLI",
          run() {
            return checkHostCommand({
              id: "codex",
              label: "Codex CLI",
              commandArgs: [STUDIO_MANAGED_CODEX_COMMAND, "--version"],
              expected: "Codex CLI is installed on the host.",
              explanation: "Studio delegates implementation work to local Codex sessions.",
              isValid: (output) => output.trim().length > 0
            });
          }
        },
        {
          id: "codex-sandbox",
          label: "Codex sandbox",
          run() {
            return checkHostCommand({
              id: "codex-sandbox",
              label: "Codex sandbox",
              commandArgs: [
                "bash",
                "-lc",
                "command -v bwrap && bwrap --version"
              ],
              expected: "bubblewrap is installed on the host.",
              explanation: "Codex uses bubblewrap for sandboxing.",
              isValid: (output) => output.includes("bwrap") || output.toLowerCase().includes("bubblewrap")
            });
          }
        },
      ];
    },

    startTerminal() {
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
    scope: STUDIO_SETUP_CACHE_SCOPE,
    studioRoot: resolvedStudioRoot,
    targetRoot: targetRoot || resolvedStudioRoot
  });
  const plugins = [
    createStudioHostCommandDoctorPlugin()
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
  resolveStudioRoot,
  createStudioHostCommandDoctorPlugin,
  isStudioSetupReady,
  isValidPlaywrightOutput,
  createService
};
