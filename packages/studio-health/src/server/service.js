import { access } from "node:fs/promises";
import path from "node:path";

import {
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightRuntimeOutput,
  playwrightBrowserLaunchCommandArgs,
  playwrightRuntimeVersionCommandArgs,
  runVibe64Command,
  summarizePlaywrightBrowserLaunchOutput,
  summarizePlaywrightRuntimeOutput
} from "@local/vibe64-execution/server";
import {
  genesisPackageBinDirectory
} from "@local/vibe64-genesis/server";

const COMMAND_TIMEOUT_MS = 20_000;

function passedCheck({ id, label, group, expected, observed, explanation }) {
  return {
    id,
    label,
    group,
    expected,
    observed: compactOutput(observed),
    explanation,
    status: "pass"
  };
}

function failedCheck({ id, label, group, expected, observed, explanation }) {
  return {
    id,
    label,
    group,
    expected,
    observed: compactOutput(observed) || "Unavailable.",
    explanation,
    status: "fail"
  };
}

function compactOutput(value = "") {
  return String(value || "")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");
}

async function commandCheck({
  args = [],
  command,
  expected,
  explanation,
  group = "Runtime",
  id,
  isValid = (output) => Boolean(compactOutput(output)),
  label,
  runCommand,
  runtimes = [],
  summarize = compactOutput,
  studioRoot
}) {
  const result = await runCommand({
    actor: "app",
    args,
    command,
    cwd: studioRoot,
    mode: "capture",
    purpose: "health",
    runtimes,
    timeout: COMMAND_TIMEOUT_MS
  });
  const observed = result?.ok
    ? result.output || ""
    : [result?.error, result?.output].filter(Boolean).join("\n");
  const check = {
    id,
    label,
    group,
    expected,
    observed,
    explanation
  };
  return result?.ok && isValid(observed)
    ? passedCheck({ ...check, observed: summarize(observed) })
    : failedCheck(check);
}

async function inspectWorkspace({ projectService, studioRoot }) {
  try {
    await access(path.join(studioRoot, "package.json"));
    const catalog = await projectService.listProjects();
    if (catalog?.ok === false) {
      throw new Error(catalog.error || catalog.errors?.[0]?.message || "Project catalog is unavailable.");
    }
    const projectCount = Array.isArray(catalog?.projects) ? catalog.projects.length : 0;
    return passedCheck({
      id: "workspace",
      label: "Workspace services",
      group: "Studio",
      expected: "The Vibe64 installation and project catalog are readable.",
      observed: `${studioRoot}\n${projectCount} project${projectCount === 1 ? "" : "s"} visible.`,
      explanation: "Chat needs a readable Vibe64 installation and project catalog; technology guidance comes from Genesis Stack."
    });
  } catch (error) {
    return failedCheck({
      id: "workspace",
      label: "Workspace services",
      group: "Studio",
      expected: "The Vibe64 installation and project catalog are readable.",
      observed: error?.message || error,
      explanation: "This is a platform failure, not a project setup decision."
    });
  }
}

async function inspectAccounts({ connectionsService, input }) {
  try {
    const result = await connectionsService.getStatus(input);
    if (result?.ok === false) throw new Error(result.error || result.blockedReason || "Account status could not be read.");
    const connections = Array.isArray(result?.connections) ? result.connections : [];
    if (!connections.length) throw new Error("The account service returned no connection status.");
    return connections.map((account) => {
      const label = account.label || (account.id === "github" ? "GitHub authentication" : "AI connection");
      const check = {
        id: `${account.id}-auth`, label, group: "Credentials",
        expected: `${label} is connected.`,
        observed: account.message || account.observed || account.status || "No status was returned.",
        explanation: "Account readiness is inspected by the account service; Studio Health does not attempt a repair."
      };
      return account.connected === true || account.required === false ? passedCheck(check) : failedCheck(check);
    });
  } catch (error) {
    return [failedCheck({
      id: "accounts-auth", label: "Account readiness", group: "Credentials",
      expected: "The account service returns an explicit connection state.",
      observed: error?.message || error,
      explanation: "Studio Health could not inspect accounts and does not infer their state."
    })];
  }
}

function createService({
  connectionsService,
  projectService,
  runCommand = runVibe64Command,
  studioRoot
} = {}) {
  if (!connectionsService || !projectService || !studioRoot) {
    throw new TypeError("Studio Health requires account, project, and Studio-root services.");
  }

  return Object.freeze({
    async inspect(input = {}) {
      const commandChecks = [
        commandCheck({
          id: "node",
          label: "Node.js",
          command: "node",
          args: ["--version"],
          runtimes: ["node26"],
          runCommand,
          studioRoot,
          expected: "The pinned Node.js 26 runtime pack is available.",
          isValid: (output) => /^v26\./u.test(compactOutput(output)),
          explanation: "Vibe64 itself runs on its pinned Node.js runtime."
        }),
        commandCheck({
          id: "git",
          label: "Git",
          command: "git",
          args: ["--version"],
          runtimes: ["git"],
          runCommand,
          studioRoot,
          expected: "The managed Git runtime pack is available.",
          isValid: (output) => /^git version\s+/u.test(compactOutput(output)),
          explanation: "Vibe64 owns Git credentials and repository operations."
        }),
        commandCheck({
          id: "github-cli",
          label: "GitHub CLI",
          command: "gh",
          args: ["--version"],
          runtimes: ["gh"],
          runCommand,
          studioRoot,
          expected: "The managed GitHub CLI runtime pack is available.",
          isValid: (output) => /^gh version\s+/u.test(compactOutput(output)),
          explanation: "Vibe64 uses its pinned GitHub CLI for authenticated GitHub operations."
        }),
        commandCheck({
          id: "ripgrep",
          label: "ripgrep",
          command: "rg",
          args: ["--version"],
          runtimes: ["ripgrep"],
          runCommand,
          studioRoot,
          expected: "The managed ripgrep runtime pack is available.",
          isValid: (output) => /^ripgrep\s+/u.test(compactOutput(output)),
          explanation: "Codex uses ripgrep for fast local source discovery."
        }),
        commandCheck({
          id: "codex",
          label: "Codex CLI",
          command: "codex",
          args: ["--version"],
          runtimes: ["operator-clis", "node26"],
          runCommand,
          studioRoot,
          expected: "The managed operator CLI pack exposes Codex.",
          isValid: (output) => /codex/iu.test(compactOutput(output)),
          explanation: "Direct chat delegates project work to the pinned Codex command."
        }),
        commandCheck({
          id: "genesis",
          label: "Genesis",
          group: "Runtime",
          command: path.join(genesisPackageBinDirectory(), "genesis"),
          args: ["--help"],
          runtimes: ["node26"],
          runCommand,
          studioRoot,
          expected: "The installed genesis-compiler package exposes the Genesis CLI.",
          explanation: "Genesis supplies project context, prompts, Stack guidance, Program descriptions, and Cities.",
          isValid: (output) => compactOutput(output).startsWith("Usage:")
        }),
        commandCheck({
          id: "playwright",
          label: "Playwright runtime",
          group: "Browser",
          command: playwrightRuntimeVersionCommandArgs()[0],
          args: playwrightRuntimeVersionCommandArgs().slice(1),
          runtimes: ["node26", "playwright"],
          runCommand,
          studioRoot,
          expected: "The managed Playwright CLI matches the active pinned runtime.",
          explanation: "Vibe64 owns browser automation versions instead of allowing project installs to download Chrome.",
          isValid: isValidPlaywrightRuntimeOutput,
          summarize: summarizePlaywrightRuntimeOutput
        }),
        commandCheck({
          id: "playwright-browser",
          label: "Pinned browser",
          group: "Browser",
          command: playwrightBrowserLaunchCommandArgs()[0],
          args: playwrightBrowserLaunchCommandArgs().slice(1),
          runtimes: ["node26", "playwright"],
          runCommand,
          studioRoot,
          expected: "The managed Chromium paths exist and its headless shell launches.",
          explanation: "Browser verification launches Vibe64's pinned Chromium headless shell without downloading a project-local browser.",
          isValid: isValidPlaywrightBrowserLaunchOutput,
          summarize: summarizePlaywrightBrowserLaunchOutput
        })
      ];

      const [workspace, accounts, commands] = await Promise.all([
        inspectWorkspace({ projectService, studioRoot }),
        inspectAccounts({ connectionsService, input }),
        Promise.all(commandChecks)
      ]);
      const checks = [workspace, ...accounts, ...commands];
      const failed = checks.filter((check) => check.status !== "pass").length;
      return {
        ok: true,
        healthy: failed === 0,
        checks,
        summary: {
          failed,
          passed: checks.length - failed,
          total: checks.length
        },
        updatedAt: new Date().toISOString()
      };
    }
  });
}

export {
  commandCheck,
  createService,
  inspectAccounts,
  inspectWorkspace
};
