import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  AI_STUDIO_APP_ROOT_ENV,
  AI_STUDIO_TARGET_ROOT_ENV
} from "../../../../server/lib/studioRuntimeIdentity.js";
import {
  runDoctorStep
} from "../../../../server/lib/doctorStream.js";
import {
  createReadyStatusCache
} from "../../../../server/lib/doctorStatusCache.js";
import {
  buildGithubRepoCreateOrLinkScript
} from "../../../../server/lib/githubRepoSetupScript.js";
import {
  isGithubRemoteUrl,
  repoSlugFromRemoteUrl
} from "../../../../server/lib/githubRemote.js";
import {
  gitSafeDirectoryArgs
} from "../../../../server/lib/gitToolchainMounts.js";
import {
  createDoctorRepair as createRepair,
  doctorCheckItem as checkItem,
  failDoctorCheck as failCheck,
  manualDoctorRepair as manualRepair,
  passDoctorCheck as passCheck
} from "../../../../server/lib/doctorCheckItems.js";
import {
  buildDoctorTerminalArgs,
  buildDoctorToolchainArgs
} from "../../../../server/lib/doctorToolchain.js";
import {
  dockerCommand,
  hostUserDockerArgs,
  runHostCommand,
  shellQuote
} from "../../../../server/lib/shellCommands.js";

const REQUIRED_GH_SCOPES = ["repo", "read:org", "gist", "workflow"];
const TERMINAL_NAMESPACE = "target-app-doctor";

function gitArgs(targetRoot, args) {
  return ["git", ...gitSafeDirectoryArgs(targetRoot), ...args];
}

async function runToolchain(commandArgs, {
  targetRoot,
  timeout = 20000
} = {}) {
  return runHostCommand("docker", buildDoctorToolchainArgs(commandArgs, {
    targetRoot
  }), {
    timeout
  });
}

async function runGit(targetRoot, args, options = {}) {
  return runToolchain(gitArgs(targetRoot, args), {
    targetRoot,
    ...options
  });
}

async function runGh(targetRoot, args, options = {}) {
  return runToolchain(["gh", ...args], {
    targetRoot,
    ...options
  });
}

function blockedCheck({
  id,
  label,
  expected,
  observed,
  repair = null
}) {
  return failCheck({
    id,
    label,
    expected,
    observed,
    explanation: "This check runs after the target directory and identity are safe.",
    repair
  });
}

function isTargetAppReady(checks) {
  return checks.every((check) => check.required !== true || check.status === "pass");
}

function normalizeRoot(root) {
  return path.resolve(String(root || process.cwd()));
}

function pathIsInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function hostGitRoot(root) {
  const result = await runHostCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    timeout: 5000
  });
  return result.ok ? path.resolve(result.stdout) : "";
}

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "ai-studio-target")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "ai-studio-target";
}

async function runTargetStep(emit, {
  id,
  label,
  run
}) {
  if (!emit) {
    return run();
  }
  return runDoctorStep({
    emit,
    id,
    label,
    run
  });
}

function gitInitRepair(targetRoot) {
  const script = [
    "set -e",
    "git -c safe.directory=/workspace init",
    "git -c safe.directory=/workspace branch -M main"
  ].join("\n");
  const args = buildDoctorTerminalArgs(["bash", "-lc", script], {
    targetRoot,
    extraArgs: hostUserDockerArgs()
  });

  return createRepair({
    actionId: "terminal-git-init",
    command: dockerCommand(args),
    label: "Initialize Git"
  });
}

function ghRepoCreateScript(repoName) {
  return buildGithubRepoCreateOrLinkScript(repoName);
}

function ghRepoCreateRepair(targetRoot) {
  const repoName = repoNameFromTargetRoot(targetRoot);
  const script = ghRepoCreateScript(repoName);
  const args = buildDoctorTerminalArgs(["bash", "-lc", script], {
    targetRoot,
    extraArgs: ["-e", "GH_PROMPT_DISABLED=1"]
  });

  return createRepair({
    actionId: "terminal-gh-create-repo",
    command: dockerCommand(args),
    label: "Create/link GitHub repo"
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

function ghLoginRepair(targetRoot) {
  const args = buildDoctorTerminalArgs(ghLoginCommandArgs(), {
    targetRoot
  });

  return createRepair({
    actionId: "terminal-gh-login",
    command: dockerCommand(args),
    label: "Log in to GitHub"
  });
}

function gitIdentityRepair() {
  return createRepair({
    actionId: "terminal-git-identity",
    command: [
      "git config --global user.name \"<name>\"",
      "git config --global user.email \"<email>\""
    ].join("\n"),
    fields: [
      {
        id: "name",
        label: "Git user.name",
        placeholder: "Your Name",
        required: true,
        type: "text"
      },
      {
        id: "email",
        label: "Git user.email",
        placeholder: "you@example.com",
        required: true,
        type: "email"
      }
    ],
    kind: "terminal",
    label: "Set Git identity"
  });
}

function validateGitIdentityInputs(inputs = {}) {
  const name = String(inputs.name || "").trim();
  const email = String(inputs.email || "").trim();
  if (!name) {
    return {
      ok: false,
      error: "Git user.name is required."
    };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return {
      ok: false,
      error: "Git user.email must be a valid email address."
    };
  }
  return {
    email,
    name,
    ok: true
  };
}

async function checkTargetDirectory(targetRoot) {
  try {
    await access(targetRoot, fsConstants.R_OK | fsConstants.W_OK);

    return passCheck({
      id: "target-directory",
      label: "Target directory",
      expected: "Target root exists and is readable/writable by Studio.",
      observed: targetRoot,
      explanation: "Studio can reach the target root without reading app metadata."
    });
  } catch (error) {
    return failCheck({
      id: "target-directory",
      label: "Target directory",
      expected: "Target root exists and is readable/writable by Studio.",
      observed: String(error?.message || error),
      explanation: "Studio cannot operate until the target directory is reachable and writable.",
      repair: manualRepair({
        actionId: "manual-target-directory",
        command: `test -w ${shellQuote(targetRoot)}`,
        label: "Fix directory access"
      })
    });
  }
}

async function checkTargetIdentity({
  studioRoot,
  targetRoot,
  studioRepoRoot,
  targetRepoRoot
}) {
  const observed = [
    `Studio root: ${studioRoot}`,
    `Target root: ${targetRoot}`,
    studioRepoRoot ? `Studio repo: ${studioRepoRoot}` : "",
    targetRepoRoot ? `Target repo: ${targetRepoRoot}` : ""
  ].filter(Boolean).join("\n");

  if (studioRoot === targetRoot || (studioRepoRoot && targetRepoRoot && studioRepoRoot === targetRepoRoot && targetRoot === targetRepoRoot)) {
    return passCheck({
      id: "target-identity",
      label: "Target identity",
      expected: "Target root is Studio's own repository root or a separate app root.",
      observed,
      explanation: "Studio is targeting itself in self-development mode. AI Studio sessions will make changes in managed session worktrees."
    });
  }

  if (studioRepoRoot && targetRepoRoot === studioRepoRoot && pathIsInside(studioRepoRoot, targetRoot)) {
    return failCheck({
      id: "target-identity",
      label: "Target identity",
      expected: "Target root is Studio's repository root, a separate repository, or a separate git worktree.",
      observed,
      explanation: "Studio cannot safely target an arbitrary subdirectory of its own repository. Target the repository root for self-development."
    });
  }

  if (studioRepoRoot && targetRepoRoot && studioRepoRoot === targetRepoRoot) {
    return failCheck({
      id: "target-identity",
      label: "Target identity",
      expected: "Target git repository is different from Studio's repository.",
      observed,
      explanation: "Studio resolved the same git repository for itself and the target app."
    });
  }

  return passCheck({
    id: "target-identity",
    label: "Target identity",
    expected: "Target root is Studio's own repository root or a separate app root.",
    observed,
    explanation: "Studio is pointed at an app root that can be checked independently."
  });
}

async function checkGitRepository(targetRoot) {
  const result = await runGit(targetRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!result.ok || result.stdout !== "true") {
    return failCheck({
      id: "git-repository",
      label: "Git repository",
      expected: "Target root is inside a git work tree.",
      observed: result.output,
      explanation: "Target App Doctor needs a git repository before Studio can create branches, commits, issues, or PRs.",
      repair: gitInitRepair(targetRoot)
    });
  }

  return passCheck({
    id: "git-repository",
    label: "Git repository",
    expected: "Target root is inside a git work tree.",
    observed: result.stdout,
    explanation: "Git is available for the target app."
  });
}

async function checkGitBranch(targetRoot, gitReady) {
  if (!gitReady) {
    return failCheck({
      id: "git-branch",
      label: "Git branch",
      expected: "Current branch is known.",
      observed: "Git repository is not ready.",
      explanation: "Studio needs a named branch before it can plan safe edit and PR flows.",
      repair: gitInitRepair(targetRoot)
    });
  }

  const result = await runGit(targetRoot, ["branch", "--show-current"]);
  if (!result.ok || !result.stdout) {
    return failCheck({
      id: "git-branch",
      label: "Git branch",
      expected: "Current branch is known.",
      observed: result.output,
      explanation: "Detached or unknown branches are blocked for Studio workflows."
    });
  }

  return passCheck({
    id: "git-branch",
    label: "Git branch",
    expected: "Current branch is known.",
    observed: result.stdout,
    explanation: "Studio can name the branch it is operating on."
  });
}

async function checkGitIdentity(targetRoot, gitReady) {
  if (!gitReady) {
    return failCheck({
      id: "git-identity",
      label: "Git identity",
      expected: "Git user.name and user.email are configured.",
      observed: "Git repository is not ready.",
      explanation: "Studio needs commit identity before file-writing workflows.",
      repair: gitIdentityRepair()
    });
  }

  const [nameResult, emailResult] = await Promise.all([
    runGit(targetRoot, ["config", "--get", "user.name"]),
    runGit(targetRoot, ["config", "--get", "user.email"])
  ]);
  if (!nameResult.stdout || !emailResult.stdout) {
    return failCheck({
      id: "git-identity",
      label: "Git identity",
      expected: "Git user.name and user.email are configured.",
      observed: [
        `user.name: ${nameResult.stdout || "missing"}`,
        `user.email: ${emailResult.stdout || "missing"}`
      ].join("\n"),
      explanation: "Studio will not write files until commit identity is configured.",
      repair: gitIdentityRepair()
    });
  }

  return passCheck({
    id: "git-identity",
    label: "Git identity",
    expected: "Git user.name and user.email are configured.",
    observed: `${nameResult.stdout} <${emailResult.stdout}>`,
    explanation: "Git commit identity is configured."
  });
}

async function checkGitStatus(targetRoot, gitReady) {
  if (!gitReady) {
    return failCheck({
      id: "git-status",
      label: "Git working tree",
      expected: "Working tree state can be read.",
      observed: "Git repository is not ready.",
      explanation: "Studio needs a known git state before editing.",
      repair: gitInitRepair(targetRoot)
    });
  }

  const result = await runGit(targetRoot, ["status", "--porcelain=v1"]);
  if (!result.ok) {
    return failCheck({
      id: "git-status",
      label: "Git working tree",
      expected: "Working tree state can be read.",
      observed: result.output,
      explanation: "Studio could not read the working tree state."
    });
  }
  if (result.stdout) {
    return passCheck({
      id: "git-status",
      label: "Git working tree",
      expected: "Working tree state can be read.",
      observed: result.stdout.split(/\r?\n/u).slice(0, 12).join("\n"),
      explanation: "The tree is dirty, but that is handled by App Setup or Review. App Bootup only proves Git state is readable."
    });
  }

  return passCheck({
    id: "git-status",
    label: "Git working tree",
    expected: "Working tree state can be read.",
    observed: "Clean",
    explanation: "The target repo Git state is readable."
  });
}

async function checkGitRemote(targetRoot, gitReady) {
  if (!gitReady) {
    return failCheck({
      id: "git-remote",
      label: "Git remote",
      expected: "origin remote is configured.",
      observed: "Git repository is not ready.",
      explanation: "A remote is needed before Studio can create PRs.",
      repair: gitInitRepair(targetRoot)
    });
  }

  const result = await runGit(targetRoot, ["remote", "get-url", "origin"]);
  if (!result.ok || !result.stdout) {
    return failCheck({
      id: "git-remote",
      label: "Git remote",
      expected: "origin remote is configured.",
      observed: result.output,
      explanation: "Create or link a GitHub repository before app work begins.",
      repair: ghRepoCreateRepair(targetRoot)
    });
  }

  return passCheck({
    id: "git-remote",
    label: "Git remote",
    expected: "origin remote is configured.",
    observed: result.stdout,
    explanation: "Git origin is configured."
  });
}

async function checkGitHubAuth(targetRoot) {
  const [statusResult, userResult] = await Promise.all([
    runGh(targetRoot, ["auth", "status", "--hostname", "github.com"]),
    runGh(targetRoot, ["api", "user", "--jq", ".login"])
  ]);
  if (!statusResult.ok || !userResult.ok || !userResult.stdout) {
    return failCheck({
      id: "github-auth",
      label: "GitHub CLI auth",
      expected: "gh is authenticated and can call the GitHub API.",
      observed: [statusResult.output, userResult.output].filter(Boolean).join("\n"),
      explanation: "Studio needs GitHub API access before creating issues, branches, PRs, or merge flows.",
      repair: ghLoginRepair(targetRoot)
    });
  }

  return passCheck({
    id: "github-auth",
    label: "GitHub CLI auth",
    expected: "gh is authenticated and can call the GitHub API.",
    observed: userResult.stdout,
    explanation: "GitHub CLI can call the GitHub API from the managed toolchain."
  });
}

async function checkGitHubRepository(targetRoot, remoteCheck) {
  const remoteUrl = remoteCheck.status === "pass" ? String(remoteCheck.observed || "").trim() : "";
  if (!remoteUrl) {
    return failCheck({
      id: "github-repository",
      label: "GitHub repository",
      expected: "Target origin resolves to a GitHub repository.",
      observed: "origin remote is not configured.",
      explanation: "Studio can create a GitHub repo for the target after confirmation.",
      repair: ghRepoCreateRepair(targetRoot)
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(remoteUrl);
  if (!isGithubRemoteUrl(remoteUrl) || !repoSlug) {
    return failCheck({
      id: "github-repository",
      label: "GitHub repository",
      expected: "origin remote is hosted on GitHub.",
      observed: remoteUrl,
      explanation: "Studio issue and PR flows require a GitHub remote."
    });
  }

  const result = await runGh(targetRoot, ["repo", "view", repoSlug, "--json", "nameWithOwner,url", "--jq", ".nameWithOwner + \" \" + .url"]);
  if (!result.ok) {
    return failCheck({
      id: "github-repository",
      label: "GitHub repository",
      expected: "gh repo view works for the target remote.",
      observed: result.output,
      explanation: "GitHub CLI cannot resolve this target repository.",
      repair: ghLoginRepair(targetRoot)
    });
  }

  return passCheck({
    id: "github-repository",
    label: "GitHub repository",
    expected: "gh repo view works for the target remote.",
    observed: result.stdout,
    explanation: "GitHub CLI can resolve the target repository."
  });
}

async function checkGitHubIssuePrAccess(targetRoot, repoCheck, remoteCheck) {
  if (repoCheck.status !== "pass") {
    return failCheck({
      id: "github-issues-prs",
      label: "GitHub issues and PRs",
      expected: "gh can list issues and pull requests for the target repo.",
      observed: "GitHub repository is not ready.",
      explanation: "Issue and PR capability is checked after the target GitHub repository resolves.",
      repair: repoCheck.repair || ghRepoCreateRepair(targetRoot)
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(remoteCheck.status === "pass" ? remoteCheck.observed : "");
  if (!repoSlug) {
    return failCheck({
      id: "github-issues-prs",
      label: "GitHub issues and PRs",
      expected: "gh can list issues and pull requests for the target repo.",
      observed: "Target GitHub repository is unknown.",
      explanation: "Studio needs issue and PR API access for the next workflow stage.",
      repair: ghRepoCreateRepair(targetRoot)
    });
  }

  const [issueResult, prResult] = await Promise.all([
    runGh(targetRoot, ["issue", "list", "--repo", repoSlug, "--limit", "1"]),
    runGh(targetRoot, ["pr", "list", "--repo", repoSlug, "--limit", "1"])
  ]);
  if (!issueResult.ok || !prResult.ok) {
    return failCheck({
      id: "github-issues-prs",
      label: "GitHub issues and PRs",
      expected: "gh can list issues and pull requests for the target repo.",
      observed: [issueResult.output, prResult.output].filter(Boolean).join("\n"),
      explanation: "Studio needs issue and PR API access for the next workflow stage.",
      repair: ghLoginRepair(targetRoot)
    });
  }

  return passCheck({
    id: "github-issues-prs",
    label: "GitHub issues and PRs",
    expected: "gh can list issues and pull requests for the target repo.",
    observed: "Issue and PR list commands succeeded.",
    explanation: "GitHub issue and PR access is available."
  });
}

function startDockerTerminal({
  args,
  commandPreview,
  targetRoot
}) {
  return startTerminalSession({
    args,
    command: "docker",
    commandPreview,
    cwd: targetRoot,
    namespace: TERMINAL_NAMESPACE
  });
}

function startGitInitTerminal(targetRoot) {
  const repair = gitInitRepair(targetRoot);
  const script = [
    "set -e",
    "git -c safe.directory=/workspace init",
    "git -c safe.directory=/workspace branch -M main"
  ].join("\n");
  const args = buildDoctorTerminalArgs(["bash", "-lc", script], {
    extraArgs: hostUserDockerArgs(),
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

function startGhCreateRepoTerminal(targetRoot) {
  const repair = ghRepoCreateRepair(targetRoot);
  const repoName = repoNameFromTargetRoot(targetRoot);
  const args = buildDoctorTerminalArgs(["bash", "-lc", ghRepoCreateScript(repoName)], {
    extraArgs: ["-e", "GH_PROMPT_DISABLED=1"],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

function startGitIdentityTerminal(targetRoot, inputs = {}) {
  const inputValidation = validateGitIdentityInputs(inputs);
  if (!inputValidation.ok) {
    return {
      error: inputValidation.error,
      ok: false
    };
  }

  const script = [
    "set -e",
    "set -x",
    "git config --global user.name \"$AI_STUDIO_GIT_USER_NAME\"",
    "git config --global user.email \"$AI_STUDIO_GIT_USER_EMAIL\"",
    "git config --global --get user.name",
    "git config --global --get user.email"
  ].join("\n");
  const args = buildDoctorTerminalArgs(["bash", "-lc", script], {
    extraArgs: [
      "-e",
      `AI_STUDIO_GIT_USER_NAME=${inputValidation.name}`,
      "-e",
      `AI_STUDIO_GIT_USER_EMAIL=${inputValidation.email}`
    ],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: dockerCommand(args),
    targetRoot
  });
}

function startGhLoginTerminal(targetRoot) {
  const repair = ghLoginRepair(targetRoot);
  const args = buildDoctorTerminalArgs(ghLoginCommandArgs(), {
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

async function inspectTargetApp({
  emit = null,
  studioRoot,
  targetRoot
}) {
  const normalizedStudioRoot = normalizeRoot(studioRoot);
  const normalizedTargetRoot = normalizeRoot(targetRoot);
  const [studioRepoRoot, targetRepoRoot] = await Promise.all([
    hostGitRoot(normalizedStudioRoot),
    hostGitRoot(normalizedTargetRoot)
  ]);
  const directory = await runTargetStep(emit, {
    id: "target-directory",
    label: "Target directory",
    run: () => checkTargetDirectory(normalizedTargetRoot)
  });
  const identity = await runTargetStep(emit, {
    id: "target-identity",
    label: "Target identity",
    run: () => checkTargetIdentity({
      studioRoot: normalizedStudioRoot,
      targetRoot: normalizedTargetRoot,
      studioRepoRoot,
      targetRepoRoot
    })
  });
  if (directory.status !== "pass" || identity.status !== "pass") {
    const observed = directory.status !== "pass"
      ? "Target directory is not ready."
      : "Target identity is blocked.";
    const checks = [
      directory,
      identity,
      blockedCheck({
        id: "git-repository",
        label: "Git repository",
        expected: "Target root is inside a git work tree.",
        observed,
        repair: directory.status === "pass" ? gitInitRepair(normalizedTargetRoot) : null
      }),
      blockedCheck({
        id: "git-branch",
        label: "Git branch",
        expected: "Current branch is known.",
        observed
      }),
      blockedCheck({
        id: "git-identity",
        label: "Git identity",
        expected: "Git user.name and user.email are configured.",
        observed
      }),
      blockedCheck({
        id: "git-status",
        label: "Git working tree",
        expected: "Working tree state can be read.",
        observed
      }),
      blockedCheck({
        id: "git-remote",
        label: "Git remote",
        expected: "origin remote is configured.",
        observed
      }),
      blockedCheck({
        id: "github-auth",
        label: "GitHub CLI auth",
        expected: "gh is authenticated and can call the GitHub API.",
        observed
      }),
      blockedCheck({
        id: "github-repository",
        label: "GitHub repository",
        expected: "Target origin resolves to a GitHub repository.",
        observed
      }),
      blockedCheck({
        id: "github-issues-prs",
        label: "GitHub issues and PRs",
        expected: "gh can list issues and pull requests for the target repo.",
        observed
      })
    ];

    return {
      ok: true,
      blockedReason: "Target app readiness is incomplete.",
      ready: false,
      studioRoot: normalizedStudioRoot,
      targetRoot: normalizedTargetRoot,
      studioRepoRoot,
      targetRepoRoot,
      checks,
      updatedAt: new Date().toISOString()
    };
  }

  const gitRepository = await runTargetStep(emit, {
    id: "git-repository",
    label: "Git repository",
    run: () => checkGitRepository(normalizedTargetRoot)
  });
  const gitReady = gitRepository.status === "pass";
  const gitBranch = await runTargetStep(emit, {
    id: "git-branch",
    label: "Git branch",
    run: () => checkGitBranch(normalizedTargetRoot, gitReady)
  });
  const gitIdentity = await runTargetStep(emit, {
    id: "git-identity",
    label: "Git identity",
    run: () => checkGitIdentity(normalizedTargetRoot, gitReady)
  });
  const gitStatus = await runTargetStep(emit, {
    id: "git-status",
    label: "Git working tree",
    run: () => checkGitStatus(normalizedTargetRoot, gitReady)
  });
  const gitRemote = await runTargetStep(emit, {
    id: "git-remote",
    label: "Git remote",
    run: () => checkGitRemote(normalizedTargetRoot, gitReady)
  });
  const githubAuth = await runTargetStep(emit, {
    id: "github-auth",
    label: "GitHub CLI auth",
    run: () => checkGitHubAuth(normalizedTargetRoot)
  });
  const githubRepository = await runTargetStep(emit, {
    id: "github-repository",
    label: "GitHub repository",
    run: () => checkGitHubRepository(normalizedTargetRoot, gitRemote)
  });
  const githubIssuesPrs = await runTargetStep(emit, {
    id: "github-issues-prs",
    label: "GitHub issues and PRs",
    run: () => checkGitHubIssuePrAccess(normalizedTargetRoot, githubRepository, gitRemote)
  });
  const checks = [
    directory,
    identity,
    gitRepository,
    gitBranch,
    gitIdentity,
    gitStatus,
    gitRemote,
    githubAuth,
    githubRepository,
    githubIssuesPrs
  ];

  return {
    ok: true,
    blockedReason: isTargetAppReady(checks) ? "" : "Target app readiness is incomplete.",
    ready: isTargetAppReady(checks),
    studioRoot: normalizedStudioRoot,
    targetRoot: normalizedTargetRoot,
    studioRepoRoot,
    targetRepoRoot,
    checks,
    updatedAt: new Date().toISOString()
  };
}

function createService({
  studioRoot = process.env[AI_STUDIO_APP_ROOT_ENV] || process.cwd(),
  targetRoot = process.env[AI_STUDIO_TARGET_ROOT_ENV] || process.cwd()
} = {}) {
  const resolvedStudioRoot = normalizeRoot(studioRoot);
  const resolvedTargetRoot = normalizeRoot(targetRoot);
  const readyStatusCache = createReadyStatusCache();

  return Object.freeze({
    async getStatus() {
      const cachedStatus = readyStatusCache.read();
      if (cachedStatus) {
        return cachedStatus;
      }
      return readyStatusCache.remember(await inspectTargetApp({
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async streamStatus({ emit } = {}) {
      return readyStatusCache.remember(await inspectTargetApp({
        emit,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    startTerminal(input = {}) {
      const actionId = String(input.actionId || "");

      if (actionId === "terminal-git-init") {
        return startGitInitTerminal(resolvedTargetRoot);
      }

      if (actionId === "terminal-gh-create-repo") {
        return startGhCreateRepoTerminal(resolvedTargetRoot);
      }

      if (actionId === "terminal-git-identity") {
        return startGitIdentityTerminal(resolvedTargetRoot, input.inputs || {});
      }

      if (actionId === "terminal-gh-login") {
        return startGhLoginTerminal(resolvedTargetRoot);
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
  createService,
  gitIdentityRepair,
  gitInitRepair,
  ghRepoCreateScript,
  ghRepoCreateRepair,
  inspectTargetApp,
  isTargetAppReady,
  repoNameFromTargetRoot,
  validateGitIdentityInputs
};
