import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  closeTerminalSession,
  readTerminalSession,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  VIBE64_APP_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  runDoctorStep
} from "@local/setup-doctor-core/server/doctorStream";
import {
  createRepositoryReadyStatusCache
} from "@local/setup-doctor-core/server/doctorStatusCache";
import {
  isGithubRemoteUrl,
  repoSlugFromRemoteUrl
} from "@local/setup-doctor-core/server/githubRemote";
import {
  failDoctorCheck as failCheck,
  manualDoctorRepair as manualRepair,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  runHostCommand,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  ghRepoCreateRepair,
  ghRepoCreateScript,
  gitIdentityRepair,
  gitInitRepair,
  githubIssueAndPrAccess,
  readGitBranch,
  readGitIdentity,
  readGitInsideWorkTree,
  readGitOriginRemote,
  readGitStatus,
  readGithubRepositorySummary,
  repoNameFromTargetRoot,
  startGhCreateRepoTerminal as startSharedGhCreateRepoTerminal,
  startGitIdentityTerminal as startSharedGitIdentityTerminal,
  startGitInitTerminal as startSharedGitInitTerminal,
  validateGitIdentityInputs
} from "@local/setup-doctor-core/server/setupDoctorGit";

const TERMINAL_NAMESPACE = "adapter-setup-doctor";

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

function isAdapterSetupReady(checks) {
  return checks.every((check) => check.required !== true || check.status === "pass");
}

function normalizeRoot(root) {
  return path.resolve(String(root || process.cwd()));
}

function refreshRequested(input = {}) {
  return input?.refresh === true || input?.refresh === "true" || input?.refresh === "1";
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
  selfTargetAllowed = false,
  selfTargetPolicyError = "",
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

  const targetIsStudioRoot = studioRoot === targetRoot ||
    (studioRepoRoot && targetRepoRoot && studioRepoRoot === targetRepoRoot && targetRoot === targetRepoRoot);

  if (targetIsStudioRoot && selfTargetAllowed) {
    return passCheck({
      id: "target-identity",
      label: "Target identity",
      expected: "Target root is Studio's own repository root or a separate app root.",
      observed,
      explanation: "Studio is targeting itself in self-development mode. Vibe64 sessions will make changes in managed session worktrees."
    });
  }

  if (targetIsStudioRoot) {
    if (selfTargetPolicyError) {
      return failCheck({
        id: "target-identity",
        label: "Target identity",
        expected: "The selected adapter can evaluate whether self-targeting is allowed.",
        observed: `${observed}\nPolicy error: ${selfTargetPolicyError}`,
        explanation: "Studio is targeting itself, but Adapter Setup could not evaluate the selected adapter's self-target policy."
      });
    }

    return failCheck({
      id: "target-identity",
      label: "Target identity",
      expected: "Target root is separate from Studio unless the selected adapter supports this self-target.",
      observed,
      explanation: "Studio is targeting itself, but the selected adapter does not support this target as a self-development project."
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
      explanation: "Studio resolved the same git repository for itself and the target project."
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
  const result = await readGitInsideWorkTree(targetRoot);
  if (!result.ok || result.stdout !== "true") {
    return failCheck({
      id: "git-repository",
      label: "Git repository",
      expected: "Target root is inside a git work tree.",
      observed: result.output,
      explanation: "Adapter Setup Doctor needs a git repository before Studio can create branches, commits, issues, or PRs.",
      repair: gitInitRepair(targetRoot)
    });
  }

  return passCheck({
    id: "git-repository",
    label: "Git repository",
    expected: "Target root is inside a git work tree.",
    observed: result.stdout,
    explanation: "Git is available for the target project."
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

  const result = await readGitBranch(targetRoot);
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

  const {
    emailResult,
    nameResult
  } = await readGitIdentity(targetRoot);
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

  const result = await readGitStatus(targetRoot);
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
      explanation: "The tree is dirty, but that is handled by Project Setup or Review. Adapter Setup only proves Git state is readable."
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

  const result = await readGitOriginRemote(targetRoot);
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

  const result = await readGithubRepositorySummary(targetRoot, remoteUrl);
  if (!result.ok) {
    return failCheck({
      id: "github-repository",
      label: "GitHub repository",
      expected: "gh repo view works for the target remote.",
      observed: result.output,
      explanation: "GitHub CLI cannot resolve this target repository. Re-authenticate the local GitHub CLI credentials if authentication expired."
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

  const accessResult = await githubIssueAndPrAccess(targetRoot, repoSlug);
  if (!accessResult.ok) {
    return failCheck({
      id: "github-issues-prs",
      label: "GitHub issues and PRs",
      expected: "gh can list issues and pull requests for the target repo.",
      observed: accessResult.output,
      explanation: "Studio needs issue and PR API access for the next workflow stage. Re-authenticate the local GitHub CLI credentials if authentication expired."
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

function startGitInitTerminal(targetRoot) {
  return startSharedGitInitTerminal({
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startGhCreateRepoTerminal(targetRoot) {
  return startSharedGhCreateRepoTerminal({
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startGitIdentityTerminal(targetRoot, inputs = {}) {
  return startSharedGitIdentityTerminal({
    inputs,
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

async function readAdapterSelfTargetPolicy({
  projectService = null,
  studioRoot = "",
  targetRoot = ""
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    return {
      allowed: false,
      error: "Adapter project service is unavailable."
    };
  }

  try {
    const runtime = await projectService.createRuntime();
    if (typeof runtime.adapter?.allowsStudioSelfTarget !== "function") {
      return {
        allowed: false,
        error: "Active adapter does not declare a self-target policy."
      };
    }

    return {
      allowed: await runtime.adapter.allowsStudioSelfTarget({
        config: runtime.projectConfig,
        studioRoot,
        targetRoot
      }) === true,
      error: ""
    };
  } catch (error) {
    return {
      allowed: false,
      error: String(error?.message || error || "Adapter self-target policy could not be evaluated.")
    };
  }
}

async function inspectAdapterSetup({
  emit = null,
  projectService = null,
  studioRoot,
  targetRoot
}) {
  const normalizedStudioRoot = normalizeRoot(studioRoot);
  const normalizedTargetRoot = normalizeRoot(targetRoot);
  const [studioRepoRoot, targetRepoRoot] = await Promise.all([
    hostGitRoot(normalizedStudioRoot),
    hostGitRoot(normalizedTargetRoot)
  ]);
  const selfTargetPolicy = await readAdapterSelfTargetPolicy({
    projectService,
    studioRoot: normalizedStudioRoot,
    targetRoot: normalizedTargetRoot
  });
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
      selfTargetAllowed: selfTargetPolicy.allowed,
      selfTargetPolicyError: selfTargetPolicy.error,
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
      blockedReason: "Adapter Setup is incomplete.",
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
    githubRepository,
    githubIssuesPrs
  ];

  return {
    ok: true,
    blockedReason: isAdapterSetupReady(checks) ? "" : "Adapter Setup is incomplete.",
    ready: isAdapterSetupReady(checks),
    studioRoot: normalizedStudioRoot,
    targetRoot: normalizedTargetRoot,
    studioRepoRoot,
    targetRepoRoot,
    checks,
    updatedAt: new Date().toISOString()
  };
}

function createService({
  projectService = null,
  studioRoot = process.env[VIBE64_APP_ROOT_ENV] || process.cwd(),
  targetRoot = process.env[VIBE64_TARGET_ROOT_ENV] || ""
} = {}) {
  const resolvedStudioRoot = normalizeRoot(studioRoot);

  function currentTargetRoot() {
    const selectedTargetRoot = String(targetRoot || projectServiceTargetRoot(projectService)).trim();
    return selectedTargetRoot ? normalizeRoot(selectedTargetRoot) : "";
  }

  function noProjectSelectedStatus() {
    return {
      blockedReason: "Choose a project before running Adapter Setup.",
      checks: [],
      ok: true,
      ready: false,
      studioRoot: resolvedStudioRoot,
      targetRoot: "",
      updatedAt: new Date().toISOString()
    };
  }

  function readyStatusCache(targetRootValue) {
    return createRepositoryReadyStatusCache({
      doctorId: "adapter-setup",
      studioRoot: resolvedStudioRoot,
      targetRoot: targetRootValue
    });
  }

  return Object.freeze({
    async getStatus(input = {}) {
      const resolvedTargetRoot = currentTargetRoot();
      if (!resolvedTargetRoot) {
        return noProjectSelectedStatus();
      }
      const cache = readyStatusCache(resolvedTargetRoot);
      if (!refreshRequested(input)) {
        const cachedStatus = await cache.read();
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      return cache.remember(await inspectAdapterSetup({
        projectService,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async streamStatus({
      emit,
      refresh = false
    } = {}) {
      const resolvedTargetRoot = currentTargetRoot();
      if (!resolvedTargetRoot) {
        return noProjectSelectedStatus();
      }
      const cache = readyStatusCache(resolvedTargetRoot);
      if (!refreshRequested({ refresh })) {
        const cachedStatus = await cache.read();
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      return cache.remember(await inspectAdapterSetup({
        emit,
        projectService,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    startTerminal(input = {}) {
      const resolvedTargetRoot = currentTargetRoot();
      if (!resolvedTargetRoot) {
        return {
          ok: false,
          error: "Choose a project before running Adapter Setup terminal actions."
        };
      }
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
  inspectAdapterSetup,
  isAdapterSetupReady,
  repoNameFromTargetRoot,
  validateGitIdentityInputs
};
