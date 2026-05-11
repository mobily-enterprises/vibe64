import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execa } from "execa";

import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  runDoctorStep
} from "../../../../server/lib/doctorStream.js";
import {
  createReadyStatusCache
} from "../../../../server/lib/doctorStatusCache.js";
import {
  buildGithubRepoCreateOrLinkScript
} from "../../../../server/lib/githubRepoSetupScript.js";

const TOOLCHAIN_IMAGE = "jskit-ai-studio-toolchain:0.1.0";
const TOOL_HOME_VOLUME = "jskit_ai_studio_tool_home";
const REQUIRED_GH_SCOPES = ["repo", "read:org", "gist", "workflow"];
const TERMINAL_NAMESPACE = "target-app-doctor";

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function dockerCommand(args) {
  return ["docker", ...args].map(shellQuote).join(" ");
}

function normalizeRunResult(result) {
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const output = String(result.all || [stdout, stderr].filter(Boolean).join("\n")).trim();

  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    output
  };
}

async function runHostCommand(command, args, { cwd, timeout = 15000 } = {}) {
  try {
    const result = await execa(command, args, {
      all: true,
      cwd,
      reject: false,
      timeout
    });
    return normalizeRunResult(result);
  } catch (error) {
    return {
      ok: false,
      exitCode: typeof error.exitCode === "number" ? error.exitCode : 1,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || "").trim(),
      output: String(error.all || error.message || "").trim()
    };
  }
}

function hostUserDockerArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return ["-u", `${process.getuid()}:${process.getgid()}`];
}

function buildToolchainArgs(commandArgs, {
  targetRoot,
  extraArgs = []
} = {}) {
  return [
    "run",
    "--rm",
    "-v",
    `${TOOL_HOME_VOLUME}:/home/studio`,
    "-e",
    "HOME=/home/studio",
    "-v",
    `${targetRoot}:/workspace`,
    "-w",
    "/workspace",
    ...extraArgs,
    TOOLCHAIN_IMAGE,
    ...commandArgs
  ];
}

function buildTerminalArgs(commandArgs, options = {}) {
  return buildToolchainArgs(commandArgs, {
    ...options,
    extraArgs: ["-it", ...(options.extraArgs || [])]
  });
}

function gitArgs(args) {
  return ["git", "-c", "safe.directory=/workspace", ...args];
}

async function runToolchain(commandArgs, {
  targetRoot,
  timeout = 20000
} = {}) {
  return runHostCommand("docker", buildToolchainArgs(commandArgs, {
    targetRoot
  }), {
    timeout
  });
}

async function runGit(targetRoot, args, options = {}) {
  return runToolchain(gitArgs(args), {
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

function createRepair({
  actionId,
  command,
  fields = [],
  kind = "terminal",
  label
}) {
  return {
    actionId,
    commandPreview: command,
    fields,
    kind,
    label
  };
}

function manualRepair({
  actionId,
  command,
  label
}) {
  return createRepair({
    actionId,
    command,
    kind: "manual",
    label
  });
}

function checkItem({
  id,
  label,
  status,
  expected,
  observed,
  explanation,
  repair = null
}) {
  return {
    id,
    label,
    status,
    required: true,
    expected,
    observed: String(observed || "").trim() || "not available",
    explanation,
    repair,
    repairs: [repair].filter(Boolean)
  };
}

function passCheck(details) {
  return checkItem({
    ...details,
    status: "pass"
  });
}

function failCheck(details) {
  return checkItem({
    ...details,
    status: "fail"
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
  return String(path.basename(targetRoot) || "jskit-app")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "jskit-app";
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
  const args = buildTerminalArgs(["bash", "-lc", script], {
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
  const args = buildTerminalArgs(["bash", "-lc", script], {
    targetRoot,
    extraArgs: ["-e", "GH_PROMPT_DISABLED=1"]
  });

  return createRepair({
    actionId: "terminal-gh-create-repo",
    command: dockerCommand(args),
    label: "Create/link GitHub repo"
  });
}

function ghLoginRepair(targetRoot) {
  const args = buildTerminalArgs([
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
  ], {
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

  if (studioRoot === targetRoot) {
    return failCheck({
      id: "target-identity",
      label: "Target identity",
      expected: "Target root is different from the Studio implementation root.",
      observed,
      explanation: "Studio is currently targeting itself. Start Studio from the app you want to operate on, or pass JSKIT_STUDIO_TARGET_ROOT from the launcher."
    });
  }

  if (studioRepoRoot && (targetRoot === studioRepoRoot || pathIsInside(studioRepoRoot, targetRoot))) {
    return failCheck({
      id: "target-identity",
      label: "Target identity",
      expected: "Target root is outside Studio's own repository.",
      observed,
      explanation: "Studio should not operate on its own repository unless an explicit self-development mode is added later."
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
    expected: "Target root and Studio root are separate.",
    observed,
    explanation: "Studio is pointed at a separate target directory."
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
      explanation: "Detached or unknown branches are blocked for V0."
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
      expected: "Working tree state is known and clean for V0.",
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

function remoteLooksLikeGitHub(remoteUrl) {
  return /(^git@github\.com:|github\.com[:/])/iu.test(String(remoteUrl || ""));
}

async function checkGitHubRepository(targetRoot, remoteCheck) {
  const remoteUrl = remoteCheck.status === "pass" ? remoteCheck.observed : "";
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
  if (!remoteLooksLikeGitHub(remoteUrl)) {
    return failCheck({
      id: "github-repository",
      label: "GitHub repository",
      expected: "origin remote is hosted on GitHub.",
      observed: remoteUrl,
      explanation: "V0 issue and PR flows require a GitHub remote."
    });
  }

  const result = await runGh(targetRoot, ["repo", "view", "--json", "nameWithOwner,url", "--jq", ".nameWithOwner + \" \" + .url"]);
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

async function checkGitHubIssuePrAccess(targetRoot, repoCheck) {
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

  const [issueResult, prResult] = await Promise.all([
    runGh(targetRoot, ["issue", "list", "--limit", "1"]),
    runGh(targetRoot, ["pr", "list", "--limit", "1"])
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
        expected: "Working tree state is known and clean for V0.",
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
    run: () => checkGitHubIssuePrAccess(normalizedTargetRoot, githubRepository)
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
  studioRoot = process.env.JSKIT_STUDIO_APP_ROOT || process.cwd(),
  targetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT || process.cwd()
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
        const repair = gitInitRepair(resolvedTargetRoot);
        const script = [
          "set -e",
          "git -c safe.directory=/workspace init",
          "git -c safe.directory=/workspace branch -M main"
        ].join("\n");
        const args = buildTerminalArgs(["bash", "-lc", script], {
          targetRoot: resolvedTargetRoot,
          extraArgs: hostUserDockerArgs()
        });
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: repair.commandPreview,
          cwd: resolvedTargetRoot,
          namespace: TERMINAL_NAMESPACE
        });
      }

      if (actionId === "terminal-gh-create-repo") {
        const repair = ghRepoCreateRepair(resolvedTargetRoot);
        const repoName = repoNameFromTargetRoot(resolvedTargetRoot);
        const script = ghRepoCreateScript(repoName);
        const args = buildTerminalArgs(["bash", "-lc", script], {
          targetRoot: resolvedTargetRoot,
          extraArgs: ["-e", "GH_PROMPT_DISABLED=1"]
        });
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: repair.commandPreview,
          cwd: resolvedTargetRoot,
          namespace: TERMINAL_NAMESPACE
        });
      }

      if (actionId === "terminal-git-identity") {
        const inputValidation = validateGitIdentityInputs(input.inputs || {});
        if (!inputValidation.ok) {
          return {
            ok: false,
            error: inputValidation.error
          };
        }

        const script = [
          "set -e",
          "set -x",
          "git config --global user.name \"$JSKIT_GIT_USER_NAME\"",
          "git config --global user.email \"$JSKIT_GIT_USER_EMAIL\"",
          "git config --global --get user.name",
          "git config --global --get user.email"
        ].join("\n");
        const args = buildTerminalArgs(["bash", "-lc", script], {
          targetRoot: resolvedTargetRoot,
          extraArgs: [
            "-e",
            `JSKIT_GIT_USER_NAME=${inputValidation.name}`,
            "-e",
            `JSKIT_GIT_USER_EMAIL=${inputValidation.email}`
          ]
        });
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: dockerCommand(args),
          cwd: resolvedTargetRoot,
          namespace: TERMINAL_NAMESPACE
        });
      }

      if (actionId === "terminal-gh-login") {
        const repair = ghLoginRepair(resolvedTargetRoot);
        const args = buildTerminalArgs([
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
        ], {
          targetRoot: resolvedTargetRoot
        });
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: repair.commandPreview,
          cwd: resolvedTargetRoot,
          namespace: TERMINAL_NAMESPACE
        });
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
