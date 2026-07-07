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
  runtimePackageTool,
  runtimeToolCommandArgs,
  runtimeToolVersionMatches
} from "@local/vibe64-core/server/runtimeToolchain";

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

function playwrightBrowserLaunchCommandArgs() {
  return [
    "bash",
    "-lc",
    [
      "set -euo pipefail",
      "search_roots=()",
      "if [ -n \"${PLAYWRIGHT_BROWSERS_PATH:-}\" ]; then search_roots+=(\"$PLAYWRIGHT_BROWSERS_PATH\"); fi",
      "if [ -n \"${VIBE64_SHARED_CACHE_ROOT:-}\" ]; then search_roots+=(\"$VIBE64_SHARED_CACHE_ROOT/playwright\"); fi",
      "search_roots+=(\"/var/cache/vibe64/playwright\" \"$HOME/.cache/ms-playwright\")",
      "browser=\"\"",
      "for root in \"${search_roots[@]}\"; do",
      "  [ -d \"$root\" ] || continue",
      "  candidate=\"$(find \"$root\" -maxdepth 4 -type f \\( -name chrome-headless-shell -o -name chrome \\) -print 2>/dev/null | sort | head -n 1 || true)\"",
      "  if [ -n \"$candidate\" ]; then",
      "    browser=\"$candidate\"",
      "    break",
      "  fi",
      "done",
      "if [ -z \"$browser\" ]; then",
      "  echo \"No Playwright Chromium browser was found.\"",
      "  exit 1",
      "fi",
      "if ldd \"$browser\" 2>/dev/null | grep -q \"not found\"; then",
      "  ldd \"$browser\" | grep \"not found\"",
      "  exit 1",
      "fi",
      "\"$browser\" --headless --disable-gpu --no-sandbox --dump-dom 'data:text/html,<title>vibe64-playwright</title><h1>vibe64-playwright-ok</h1>' | grep -q 'vibe64-playwright-ok'",
      "printf 'Playwright browser launched: %s\\n' \"$browser\""
    ].join("\n")
  ];
}

function isValidPlaywrightBrowserLaunchOutput(output = "") {
  return /Playwright browser launched:\s+\/.*(?:\/chrome|\/chrome-headless-shell)\b/u.test(String(output || "")) &&
    !/not found/u.test(String(output || ""));
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

async function checkRuntimeTool({
  explanation,
  expected = "",
  id,
  label,
  packageId,
  toolId
}) {
  const tool = runtimePackageTool(packageId, toolId);
  return checkHostCommand({
    id,
    label,
    commandArgs: runtimeToolCommandArgs(packageId, toolId),
    expected: expected || tool?.expected || `${label} is available through the Vibe64 runtime toolchain.`,
    explanation,
    isValid: (output) => runtimeToolVersionMatches(output, packageId, toolId)
  });
}

function runtimeToolCheck({
  explanation,
  expected = "",
  id,
  label,
  packageId,
  toolId
}) {
  return {
    id,
    label,
    run() {
      return checkRuntimeTool({
        explanation,
        expected,
        id,
        label,
        packageId,
        toolId
      });
    }
  };
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
          id: "nix",
          label: "Nix",
          run() {
            return checkHostCommand({
              id: "nix",
              label: "Nix",
              commandArgs: ["nix", "--version"],
              expected: "Nix is installed on the host.",
              explanation: "Vibe64 uses Nix to provide exact project runtime binaries without containers.",
              isValid: (output) => output.includes("nix (Nix)")
            });
          }
        },
        {
          id: "nix-access",
          label: "Nix access",
          run() {
            return checkHostCommand({
              id: "nix-access",
              label: "Nix access",
              commandArgs: [
                "nix",
                "--extra-experimental-features",
                "nix-command flakes",
                "eval",
                "--impure",
                "--raw",
                "--expr",
                "builtins.currentSystem"
              ],
              expected: "The Vibe64 service user can evaluate Nix packages.",
              explanation: "The same OS user that runs Vibe64 must be allowed to talk to the Nix daemon.",
              isValid: (output) => /linux/u.test(output.trim())
            });
          }
        },
        runtimeToolCheck({
          id: "node",
          label: "Node.js",
          packageId: "nodejs-22",
          toolId: "node",
          explanation: "Studio uses the Vibe64-selected Node runtime for JavaScript and TypeScript project setup, scripts, and framework CLIs."
        }),
        runtimeToolCheck({
          id: "npm",
          label: "npm",
          packageId: "nodejs-22",
          toolId: "npm",
          explanation: "npm is provided by the Vibe64-selected Node runtime and backs npx-based project seed commands."
        }),
        runtimeToolCheck({
          id: "corepack",
          label: "Corepack",
          packageId: "nodejs-22",
          toolId: "corepack",
          explanation: "Corepack is provided by the Vibe64-selected Node runtime for package-manager dispatch."
        }),
        runtimeToolCheck({
          id: "bun",
          label: "Bun",
          packageId: "bun",
          toolId: "bun",
          explanation: "Adapters can select Bun without owning package-manager installation."
        }),
        runtimeToolCheck({
          id: "git",
          label: "git",
          packageId: "git",
          toolId: "git",
          explanation: "Vibe64 uses git for status, diffs, commits, and project worktrees."
        }),
        runtimeToolCheck({
          id: "ripgrep",
          label: "ripgrep",
          packageId: "ripgrep",
          toolId: "rg",
          explanation: "Codex uses rg for fast local codebase search."
        }),
        runtimeToolCheck({
          id: "playwright",
          label: "Playwright",
          packageId: "playwright",
          toolId: "playwright",
          explanation: "Studio uses Playwright for local UI verification."
        }),
        {
          id: "playwright-browser",
          label: "Playwright browser",
          run() {
            return checkHostCommand({
              id: "playwright-browser",
              label: "Playwright browser",
              commandArgs: playwrightBrowserLaunchCommandArgs(),
              expected: "A Playwright Chromium browser is installed and can launch from the Vibe64 runtime.",
              explanation: "UI verification needs Chromium's native libraries and fonts, not only the Playwright command-line tool.",
              isValid: isValidPlaywrightBrowserLaunchOutput
            });
          }
        },
        runtimeToolCheck({
          id: "gh",
          label: "GitHub CLI",
          packageId: "gh",
          toolId: "gh",
          explanation: "Vibe64 uses GitHub CLI for repository, branch, and pull request workflows."
        }),
        runtimeToolCheck({
          id: "codex-sandbox",
          label: "Codex sandbox",
          packageId: "bubblewrap",
          toolId: "bwrap",
          explanation: "Codex uses bubblewrap for sandboxing."
        }),
        runtimeToolCheck({
          id: "codex",
          label: "Codex CLI",
          packageId: "codex",
          toolId: "codex",
          explanation: "Studio delegates implementation work to local Codex sessions."
        }),
        runtimeToolCheck({
          id: "opencode",
          label: "opencode",
          packageId: "opencode",
          toolId: "opencode",
          explanation: "Vibe64 can delegate implementation work to opencode sessions when configured."
        })
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
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightOutput,
  playwrightBrowserLaunchCommandArgs,
  createService
};
