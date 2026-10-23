import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  checkLocalTools,
  GIT_IDENTITY_COMMANDS,
  isFallbackGitIdentityEmail,
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightRuntimeOutput,
  playwrightBrowserLaunchCommandArgs,
  playwrightRuntimeVersionCommandArgs,
  localToolInstall,
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

// The Node.js major version Vibe64 declares in its package.json engines field.
async function requiredNodeMajor(studioRoot) {
  try {
    const { engines } = JSON.parse(await readFile(path.join(studioRoot, "package.json"), "utf8"));
    return /^\D*(\d+)/u.exec(String(engines?.node || ""))?.[1] || "";
  } catch {
    return "";
  }
}

const AI_TOOLS = ["claude", "codex", "opencode"];
// Without packs these help but are never required; signing in to GitHub too.
const OPTIONAL_CHECKS = new Set(["git-identity", "github-auth", "playwright", "playwright-browser"]);
const LOCAL_TOOL_CHECKS = Object.freeze({
  node: { need: "needed", explanation: "Vibe64 and your projects run on it." },
  git: { need: "needed", explanation: "Vibe64 keeps every change in Git." },
  gh: { id: "github-cli", need: "optional", explanation: "Only needed for projects on GitHub." },
  ripgrep: { need: "optional", explanation: "Makes searching your code faster." }
});

function playwrightTool() {
  return { name: "Playwright browser", status: "missing", guideUrl: "https://playwright.dev/docs/browsers",
    install: localToolInstall("playwright", { family: process.platform === "darwin" ? "brew" : "apt" }) };
}

function plural(name = "") {
  return /s$/u.test(name) ? "aren't" : "isn't";
}

// A tool from the shared check, as a Health row: what was found, or one
// sentence and the command that installs it.
function localToolRow(tool, { group, id = tool.id, need, explanation }) {
  const found = [tool.version && `${tool.name} ${tool.version}`, tool.path].filter(Boolean).join(" · ");
  const observed = {
    ready: found,
    broken: `${tool.name} is at ${tool.path} but didn't start.`,
    missing: `${tool.name} ${plural(tool.name)} installed on this computer.`
  }[tool.status];
  return {
    id, label: tool.name, group, need, explanation,
    expected: `${tool.name} runs on this computer.`,
    observed,
    status: tool.status === "ready" ? "pass" : need === "needed" ? "fail" : "warn",
    tool
  };
}

// Without packs: Node, Git and one AI tool are needed; everything else is optional.
async function inspectLocalTools({ nodeMajor, runCommand, studioRoot }) {
  const { tools } = await checkLocalTools(["node", "git", ...AI_TOOLS, "gh", "ripgrep"], { cwd: studioRoot, runCommand });
  const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]));
  const rows = Object.entries(LOCAL_TOOL_CHECKS).map(([id, options]) => localToolRow(byId[id], { group: "Tools", ...options }));
  const node = rows[0];
  if (node.status === "pass" && nodeMajor && !String(byId.node.version).startsWith(`${nodeMajor}.`)) {
    Object.assign(node, {
      status: "fail",
      observed: `Node.js ${byId.node.version} is installed; Vibe64 needs Node.js ${nodeMajor}.`,
      tool: { ...byId.node, status: "broken", install: localToolInstall("node", { family: "", mise: false }) }
    });
  }
  const ai = AI_TOOLS.map((id) => byId[id]);
  const ready = ai.filter((tool) => tool.status === "ready");
  const aiRow = {
    id: "ai-tool", label: "An AI tool", group: "AI tools", need: "needed",
    expected: "At least one of Claude Code, Codex or opencode runs on this computer.",
    explanation: "One is enough. Choose and connect it in AI setup.",
    observed: ready.length ? ready.map((tool) => `${tool.name} ${tool.version}`.trim()).join(", ")
      : "No AI tool is installed on this computer yet.",
    status: ready.length ? "pass" : "fail"
  };
  const aiRows = ai.map((tool) => localToolRow(tool, { group: "AI tools", need: "optional",
    explanation: `Another AI tool Vibe64 can use.` }));
  return [...rows.slice(0, 2), aiRow, ...rows.slice(2), ...aiRows];
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
  const check = { id: "git-identity", label: "Your name in Git", group: "Tools" };
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

async function inspectWorkspace({ packs = true, projectService, studioRoot }) {
  try {
    await access(path.join(studioRoot, "package.json"));
    const catalog = await projectService.listProjects();
    if (catalog?.ok === false) {
      throw new Error(catalog.error || catalog.errors?.[0]?.message || "Project catalog is unavailable.");
    }
    const projectCount = Array.isArray(catalog?.projects) ? catalog.projects.length : 0;
    if (!packs) {
      return passedCheck({
        id: "workspace",
        label: "Vibe64",
        group: "Studio",
        expected: "Vibe64 can read its own files and your projects.",
        observed: `Ready, with ${projectCount} project${projectCount === 1 ? "" : "s"}.`,
        explanation: ""
      });
    }
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

// Without packs the person fixes these themselves, so each says where.
const LOCAL_ACCOUNT_HINTS = Object.freeze({
  github: "Only needed for projects on GitHub. Connect it in Account settings.",
  default: ""
});

async function inspectAccounts({ connectionsService, input, packs = true }) {
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
        explanation: packs ? "Account readiness is inspected by the account service; Studio Health does not attempt a repair."
          : LOCAL_ACCOUNT_HINTS[account.id] || LOCAL_ACCOUNT_HINTS.default
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
      const packs = Boolean(runtimePackRoot());
      const nodeMajor = packs ? "26" : await requiredNodeMajor(studioRoot);
      const check = (definition) => commandCheck({ plainExit: !packs, ...definition });
      // With packs every row is needed, exactly as before; without them the
      // person's own tools come from the shared check.
      const commandChecks = [
        ...(packs ? [] : [gitIdentityCheck({ runCommand, studioRoot })]),
        ...(packs ? [
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
        check({
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
            })
        ] : []),
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
          explanation: packs ? "Genesis supplies project context, prompts, Stack guidance, Program descriptions, and Cities."
            : "Part of Vibe64: it helps the AI understand how your projects are built.",
          isValid: (output) => compactOutput(output).startsWith("Usage:"),
          summarize: () => "Genesis is ready."
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

      const [workspace, accounts, local, commands] = await Promise.all([
        inspectWorkspace({ packs, projectService, studioRoot }),
        inspectAccounts({ connectionsService, input, packs }),
        packs ? [] : inspectLocalTools({ nodeMajor, runCommand, studioRoot }),
        Promise.all(commandChecks)
      ]);
      // Without packs the person's own tools lead; Vibe64's own parts follow.
      const ordered = packs ? [workspace, ...accounts, ...commands] : [...local, ...accounts, workspace, ...commands];
      // One Playwright row is enough: the browser can't run without Playwright.
      const playwrightMissing = !packs && ordered.some((entry) => entry?.id === "playwright" && entry.status !== "pass");
      const checks = ordered.filter((entry) => entry && !(playwrightMissing && entry.id === "playwright-browser")).map((entry) => {
        if (packs) return { ...entry, need: "needed" };
        const need = entry.need || (OPTIONAL_CHECKS.has(entry.id) ? "optional" : "needed");
        const optionalMiss = need === "optional" && entry.status === "fail";
        return {
          ...entry,
          need,
          status: optionalMiss ? "warn" : entry.status,
          ...(optionalMiss && entry.id.startsWith("playwright") ? { tool: playwrightTool() } : {})
        };
      });
      const needed = checks.filter((entry) => entry.need === "needed");
      const failed = needed.filter((entry) => entry.status !== "pass").length;
      return {
        ok: true,
        healthy: failed === 0,
        checks,
        summary: {
          failed,
          passed: needed.length - failed,
          total: needed.length,
          optionalMissing: checks.filter((entry) => entry.need === "optional" && entry.status !== "pass").length
        },
        updatedAt: new Date().toISOString()
      };
    },

    // The rows a screen shows for named tools: run now, nothing remembered.
    async checkTools(input = {}) {
      const ids = String(input.ids || "").split(",").map((id) => id.trim()).filter(Boolean);
      return checkLocalTools(ids, { cwd: studioRoot, runCommand });
    }
  });
}

export {
  commandCheck,
  createService,
  inspectAccounts,
  inspectWorkspace
};
