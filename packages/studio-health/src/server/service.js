import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  GIT_IDENTITY_COMMANDS,
  isFallbackGitIdentityEmail,
  OPERATOR_CLIS,
  operatorCliInstall,
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightRuntimeOutput,
  playwrightBrowserLaunchCommandArgs,
  playwrightRuntimeVersionCommandArgs,
  resolveOperatorCli,
  runtimePackRoot,
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
  plainExit = false,
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
  // For the person's own tools, a plain non-zero exit shows the tool's own words,
  // not the command line that produced them.
  const plainFailure = plainExit && result?.output && /^Command failed with exit code \d+:/u.test(String(result?.error || ""));
  const observed = result?.ok
    ? result.output || ""
    : plainFailure ? result.output : [result?.error, result?.output].filter(Boolean).join("\n");
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

// Without runtime packs, the person keeps their own tools up to date.
function ownToolsCheck() {
  return passedCheck({
    id: "toolchain",
    label: "Tools",
    group: "Runtime",
    expected: "Vibe64 runs the tools installed on this computer.",
    observed: "Using your installed tools.",
    explanation: "Node.js, Git and the AI tools are the ones on this computer; install or update them yourself."
  });
}

// The Node.js major version Vibe64 declares in its package.json engines field.
async function requiredNodeMajor(studioRoot) {
  try {
    const { engines } = JSON.parse(await readFile(path.join(studioRoot, "package.json"), "utf8"));
    return /^\D*(\d+)/u.exec(String(engines?.node || ""))?.[1] || "";
  } catch {
    return "";
  }
}

async function operatorCliCheck(tool, { env, runCommand, studioRoot }) {
  const { name } = OPERATOR_CLIS[tool];
  const install = operatorCliInstall(tool);
  const cli = resolveOperatorCli(tool, { env });
  const check = {
    id: tool,
    label: name,
    group: "AI tools",
    expected: `${name} is installed on this computer.`,
    explanation: `Vibe64 runs ${name} for conversations that use it.`
  };
  if (!cli.installed) {
    return {
      ...check,
      observed: `${name} isn't installed on this computer.`,
      explanation: `To use it, install it with: ${install}`,
      status: "warn"
    };
  }
  return commandCheck({
    ...check,
    plainExit: true,
    command: cli.command,
    args: ["--version"],
    runtimes: ["operator-clis", "node26"],
    runCommand,
    studioRoot,
    isValid: (output) => /\d+\.\d+/u.test(compactOutput(output))
  });
}

// The name and email commits actually get here: git reports the identity the
// command env resolved. Nothing is blocked on a stand-in; the person is told how
// to set their own. A missing Git is already the Git row's failure.
async function gitIdentityCheck({ runCommand, studioRoot }) {
  const result = await runCommand({
    actor: "app",
    args: ["var", "GIT_AUTHOR_IDENT"],
    command: "git",
    cwd: studioRoot,
    mode: "capture",
    purpose: "health",
    runtimes: ["git"],
    timeout: COMMAND_TIMEOUT_MS
  });
  const match = /^(.*?) <([^>]*)>/u.exec(String(result?.stdout || result?.output || "").trim());
  if (result?.ok !== true || !match) return null;
  const [, name, email] = match;
  const check = { id: "git-identity", label: "Your name in Git", group: "Runtime" };
  if (!isFallbackGitIdentityEmail(email)) {
    return passedCheck({
      ...check,
      expected: "Commits carry your name and email.",
      observed: `${name} <${email}>`,
      explanation: "Taken from your Git settings."
    });
  }
  return {
    ...check,
    command: GIT_IDENTITY_COMMANDS,
    expected: "Commits carry your name and email.",
    observed: `Git doesn't know your name and email yet, so commits are saved as “${name}”.`,
    explanation: "Run this once in a terminal to use your own:",
    status: "warn"
  };
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
  env = process.env,
  projectService,
  runCommand = runVibe64Command,
  studioRoot
} = {}) {
  if (!connectionsService || !projectService || !studioRoot) {
    throw new TypeError("Studio Health requires account, project, and Studio-root services.");
  }

  return Object.freeze({
    async inspect(input = {}) {
      const packs = Boolean(runtimePackRoot());
      const nodeMajor = packs ? "26" : await requiredNodeMajor(studioRoot);
      const check = (definition) => commandCheck({ plainExit: !packs, ...definition });
      const commandChecks = [
        check({
          id: "node",
          label: "Node.js",
          command: "node",
          args: ["--version"],
          runtimes: ["node26"],
          runCommand,
          studioRoot,
          expected: packs ? "The pinned Node.js 26 runtime pack is available." : `Node.js ${nodeMajor || "(any version)"} is installed.`,
          isValid: (output) => new RegExp(`^v${nodeMajor || "\\d+"}\\.`, "u").test(compactOutput(output)),
          explanation: packs ? "Vibe64 itself runs on its pinned Node.js runtime." : "Vibe64 and your projects use the Node.js installed on this computer."
        }),
        check({
          id: "git",
          label: "Git",
          command: "git",
          args: ["--version"],
          runtimes: ["git"],
          runCommand,
          studioRoot,
          expected: packs ? "The managed Git runtime pack is available." : "Git is installed.",
          isValid: (output) => /^git version\s+/u.test(compactOutput(output)),
          explanation: "Vibe64 owns Git credentials and repository operations."
        }),
        ...(packs ? [] : [gitIdentityCheck({ runCommand, studioRoot })]),
        check({
          id: "github-cli",
          label: "GitHub CLI",
          command: "gh",
          args: ["--version"],
          runtimes: ["gh"],
          runCommand,
          studioRoot,
          expected: packs ? "The managed GitHub CLI runtime pack is available." : "The GitHub CLI is installed.",
          isValid: (output) => /^gh version\s+/u.test(compactOutput(output)),
          explanation: packs ? "Vibe64 uses its pinned GitHub CLI for authenticated GitHub operations."
            : "Vibe64 uses the GitHub CLI installed on this computer for GitHub operations."
        }),
        check({
          id: "ripgrep",
          label: "ripgrep",
          command: "rg",
          args: ["--version"],
          runtimes: ["ripgrep"],
          runCommand,
          studioRoot,
          expected: packs ? "The managed ripgrep runtime pack is available." : "ripgrep is installed.",
          isValid: (output) => /^ripgrep\s+/u.test(compactOutput(output)),
          explanation: "Codex uses ripgrep for fast local source discovery."
        }),
        ...(packs
          ? [check({
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
            })]
          : Object.keys(OPERATOR_CLIS).map((tool) => operatorCliCheck(tool, { env, runCommand, studioRoot }))),
        check({
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
        check({
          id: "playwright",
          label: "Playwright runtime",
          group: "Browser",
          command: playwrightRuntimeVersionCommandArgs()[0],
          args: playwrightRuntimeVersionCommandArgs().slice(1),
          runtimes: ["node26", "playwright"],
          runCommand,
          studioRoot,
          expected: packs ? "The managed Playwright CLI matches the active pinned runtime." : "Playwright is installed on this computer.",
          explanation: packs ? "Vibe64 owns browser automation versions instead of allowing project installs to download Chrome."
            : "Browser checks of your app use the Playwright installed on this computer.",
          isValid: isValidPlaywrightRuntimeOutput,
          summarize: summarizePlaywrightRuntimeOutput
        }),
        check({
          id: "playwright-browser",
          label: packs ? "Pinned browser" : "Playwright browser",
          group: "Browser",
          command: playwrightBrowserLaunchCommandArgs()[0],
          args: playwrightBrowserLaunchCommandArgs().slice(1),
          runtimes: ["node26", "playwright"],
          runCommand,
          studioRoot,
          expected: packs ? "The managed Chromium paths exist and its headless shell launches."
            : "Playwright's Chromium is installed and its headless shell launches.",
          explanation: packs ? "Browser verification launches Vibe64's pinned Chromium headless shell without downloading a project-local browser."
            : "Browser checks launch the Chromium headless shell that Playwright installed on this computer.",
          isValid: isValidPlaywrightBrowserLaunchOutput,
          summarize: summarizePlaywrightBrowserLaunchOutput
        })
      ];

      const [workspace, accounts, commands] = await Promise.all([
        inspectWorkspace({ projectService, studioRoot }),
        inspectAccounts({ connectionsService, input }),
        Promise.all(commandChecks)
      ]);
      const checks = [workspace, ...(packs ? [] : [ownToolsCheck()]), ...accounts, ...commands.filter(Boolean)];
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
