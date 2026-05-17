import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  readdir
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
  listDoctorPluginChecks,
  runDoctorCheck,
  startDoctorPluginTerminal
} from "../../../../server/lib/doctorPlugins.js";
import {
  buildGithubRepoCreateOrLinkScript
} from "../../../../server/lib/githubRepoSetupScript.js";
import {
  gitSafeDirectoryArgs,
  linkedGitMetadataMountSource
} from "../../../../server/lib/gitToolchainMounts.js";
import {
  shellScript
} from "../../../../server/lib/shellScript.js";
import {
  blockedDoctorCheck as blockedCheck,
  createDoctorRepair as createRepair,
  doctorCheckPassed as checkPassed,
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck,
  pendingDoctorCheck as pendingCheck
} from "../../../../server/lib/doctorCheckItems.js";
import {
  buildDoctorTerminalArgs,
  buildDoctorToolchainArgs
} from "../../../../server/lib/doctorToolchain.js";
import {
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  runHostCommand,
  shellQuote
} from "../../../../server/lib/shellCommands.js";

const TERMINAL_NAMESPACE = "app-setup-doctor";

function workspaceWriteDockerArgs() {
  return [
    ...hostUserDockerArgs(),
    "-e",
    "HOME=/tmp/studio-home"
  ];
}

function gitArgs(targetRoot, args) {
  return ["git", ...gitSafeDirectoryArgs(targetRoot), ...args];
}

async function runToolchain(commandArgs, {
  extraArgs = [],
  targetRoot,
  timeout = 20_000
} = {}) {
  return runHostCommand("docker", buildDoctorToolchainArgs(commandArgs, {
    extraArgs,
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

function appendPendingChecks(stages, checks, startIndex) {
  return [
    ...stages,
    ...checks.slice(startIndex).map(pendingCheck)
  ];
}

function assertUniqueCheckIds(checks) {
  const seen = new Set();
  for (const check of checks) {
    if (seen.has(check.id)) {
      throw new Error(`Duplicate App Setup check id: ${check.id}`);
    }
    seen.add(check.id);
  }
}

function finalizeStatus({
  context,
  stages,
  targetRoot
}) {
  const currentStage = stages.find((item) => item.required !== false && item.status !== "pass") || null;
  const ready = stages.every((item) => item.required === false || item.status === "pass");

  return {
    checks: stages,
    currentStageId: currentStage?.id || "",
    hardStop: stages.some((item) => item.status === "hard-stop"),
    ok: true,
    ready,
    stages,
    targetRoot,
    updatedAt: new Date().toISOString(),
    summary: {
      nonGitEntries: context.nonGitEntries || [],
      originUrl: context.originUrl || "",
      remoteDefaultBranch: context.remoteDefaultBranch || ""
    }
  };
}

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "ai-studio-target")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "ai-studio-target";
}

async function listMeaningfulEntries(targetRoot) {
  const ignored = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
  const entries = await readdir(targetRoot, {
    withFileTypes: true
  });
  return entries
    .map((entry) => entry.name)
    .filter((name) => !ignored.has(name))
    .sort((left, right) => left.localeCompare(right));
}

function gitInitScript() {
  return shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=/workspace init",
    "git -c safe.directory=/workspace branch -M main"
  ]);
}

function buildSetupTerminalArgs(commandArgs, options = {}) {
  return buildDoctorTerminalArgs(commandArgs, options);
}

function gitInitTerminalArgs(targetRoot) {
  return buildSetupTerminalArgs(["bash", "-lc", gitInitScript()], {
    extraArgs: workspaceWriteDockerArgs(),
    targetRoot
  });
}

function gitInitRepair(targetRoot) {
  return createRepair({
    actionId: "terminal-git-init",
    command: dockerCommand(gitInitTerminalArgs(targetRoot)),
    label: "Initialize Git"
  });
}

function ghRepoCreateScript(repoName) {
  return buildGithubRepoCreateOrLinkScript(repoName);
}

function ghRepoCreateTerminalArgs(targetRoot) {
  return buildSetupTerminalArgs(["bash", "-lc", ghRepoCreateScript(repoNameFromTargetRoot(targetRoot))], {
    extraArgs: ["-e", "GH_PROMPT_DISABLED=1"],
    targetRoot
  });
}

function ghRepoCreateRepair(targetRoot) {
  return createRepair({
    actionId: "terminal-gh-create-repo",
    command: dockerCommand(ghRepoCreateTerminalArgs(targetRoot)),
    label: "Create/link GitHub repo"
  });
}

function linkRemoteRepair() {
  return createRepair({
    actionId: "terminal-link-github-remote",
    command: "git remote add origin <url>",
    fields: [
      {
        id: "url",
        label: "GitHub remote URL",
        placeholder: "https://github.com/owner/repo.git",
        required: true,
        type: "text"
      }
    ],
    label: "Link existing repo"
  });
}

function gitCheckpointScript() {
  return shellScript([
    "set -e",
    "set -x",
    ": \"${AI_STUDIO_HOST_UID:=0}\"",
    ": \"${AI_STUDIO_HOST_GID:=0}\"",
    "as_host() { setpriv --reuid \"$AI_STUDIO_HOST_UID\" --regid \"$AI_STUDIO_HOST_GID\" --clear-groups \"$@\"; }",
    "set +x",
    "export GIT_PASSWORD=\"$(gh auth token)\"",
    "printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '*Username*) printf \"%s\\\\n\" \"x-access-token\" ;;' '*) printf \"%s\\\\n\" \"$GIT_PASSWORD\" ;;' 'esac' > /tmp/ai-studio-git-askpass",
    "chown \"$AI_STUDIO_HOST_UID:$AI_STUDIO_HOST_GID\" /tmp/ai-studio-git-askpass",
    "chmod 700 /tmp/ai-studio-git-askpass",
    "export GIT_ASKPASS=/tmp/ai-studio-git-askpass",
    "export GIT_TERMINAL_PROMPT=0",
    "set -x",
    "as_host git -c safe.directory=/workspace status --short",
    "if ! as_host git -c safe.directory=/workspace rev-parse --verify HEAD >/dev/null 2>&1; then if [ -z \"$(as_host git -c safe.directory=/workspace status --porcelain=v1)\" ]; then echo 'No files to checkpoint and no commits exist.'; exit 1; fi; as_host git -c safe.directory=/workspace add .; as_host git -c safe.directory=/workspace commit -m \"$AI_STUDIO_COMMIT_MESSAGE\"; elif [ -n \"$(as_host git -c safe.directory=/workspace status --porcelain=v1)\" ]; then as_host git -c safe.directory=/workspace add .; as_host git -c safe.directory=/workspace commit -m \"$AI_STUDIO_COMMIT_MESSAGE\"; fi",
    "branch=\"$(as_host git -c safe.directory=/workspace branch --show-current)\"",
    "if [ -z \"$branch\" ]; then echo 'No current branch.'; exit 1; fi",
    "as_host git -c safe.directory=/workspace -c credential.helper= push -u origin HEAD",
    "as_host git -c safe.directory=/workspace status --short",
    "as_host git -c safe.directory=/workspace -c credential.helper= ls-remote origin \"refs/heads/$branch\""
  ]);
}

function gitCheckpointRepair() {
  return createRepair({
    actionId: "terminal-git-checkpoint",
    command: [
      "git status --short",
      "git add .",
      "git commit -m \"<commitMessage>\"",
      "git push -u origin HEAD"
    ].join("\n"),
    fields: [
      {
        defaultValue: "Initial app setup",
        id: "commitMessage",
        label: "Commit message",
        required: true,
        type: "text"
      }
    ],
    label: "Create and push checkpoint"
  });
}

function validateCommitMessage(value) {
  const commitMessage = String(value || "").trim();
  if (!commitMessage) {
    return {
      error: "Commit message is required.",
      ok: false
    };
  }
  return {
    commitMessage,
    ok: true
  };
}

function isGithubRemoteUrl(url) {
  return /^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?|git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?)$/u.test(String(url || ""));
}

function repoSlugFromRemoteUrl(url) {
  const value = String(url || "").trim();
  const httpsMatch = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u.exec(value);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u.exec(value);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  return "";
}

function githubBranchRefApiPath(repoSlug, branch) {
  const branchPath = String(branch || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `repos/${repoSlug}/git/ref/heads/${branchPath}`;
}

function validateGithubRemoteInput(input = {}) {
  const url = String(input.url || "").trim();
  if (!isGithubRemoteUrl(url)) {
    return {
      error: "Remote URL must be a GitHub HTTPS or SSH URL.",
      ok: false
    };
  }
  return {
    ok: true,
    url
  };
}

async function checkDirectory(targetRoot, context) {
  try {
    await access(targetRoot, fsConstants.R_OK | fsConstants.W_OK);
  } catch (error) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory exists and is readable/writable.",
      observed: String(error?.message || error),
      explanation: "Studio cannot operate until the target directory is reachable."
    });
  }

  const entries = await listMeaningfulEntries(targetRoot);
  const nonGitEntries = entries.filter((entry) => entry !== ".git");
  context.entries = entries;
  context.nonGitEntries = nonGitEntries;

  let gitStat = null;
  try {
    gitStat = await lstat(path.join(targetRoot, ".git"));
  } catch {
    gitStat = null;
  }

  if (!gitStat && nonGitEntries.length) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "A directory without .git is empty.",
      observed: `No .git directory, but files exist:\n${formatList(nonGitEntries)}`,
      explanation: "Studio will not initialize Git over existing files because it cannot know their ownership."
    });
  }

  if (!gitStat) {
    context.directoryMode = "empty-no-git";
    return passCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory is empty or already a Git repository.",
      observed: "Empty directory with no .git.",
      explanation: "Studio can safely initialize this directory."
    });
  }

  if (!gitStat.isDirectory() && linkedGitMetadataMountSource(targetRoot)) {
    context.directoryMode = "git-repo";
    return passCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory is empty or already a Git work tree.",
      observed: ".git file points to linked Git metadata.",
      explanation: "Studio can continue with Git safety checks."
    });
  }

  if (!gitStat.isDirectory()) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: ".git is a directory or a valid linked worktree metadata file.",
      observed: ".git is not a directory.",
      explanation: "Studio could not resolve the .git file to existing Git metadata."
    });
  }

  context.directoryMode = "git-repo";
  return passCheck({
    id: "directory",
    label: "Directory admissibility",
    expected: "Target directory is empty or already a Git repository.",
    observed: ".git directory exists.",
    explanation: "Studio can continue with Git safety checks."
  });
}

async function checkGitReady(targetRoot, context) {
  if (context.directoryMode === "empty-no-git") {
    return blockedCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "A non-bare Git repository exists with a named branch.",
      observed: "No .git directory.",
      explanation: "Initialize Git before Studio creates or links a remote repository.",
      repair: gitInitRepair(targetRoot)
    });
  }

  const runGitCommand = context.runGitCommand || runGit;
  const inside = await runGitCommand(targetRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout !== "true") {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Target root is inside a Git work tree.",
      observed: inside.output,
      explanation: "The .git directory exists, but Git does not recognize the target as a normal work tree."
    });
  }

  const [bare, branch] = await Promise.all([
    runGitCommand(targetRoot, ["rev-parse", "--is-bare-repository"]),
    runGitCommand(targetRoot, ["branch", "--show-current"])
  ]);

  if (bare.stdout === "true") {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository is a non-bare work tree.",
      observed: "Bare repository.",
      explanation: "Studio only operates inside normal working trees."
    });
  }

  if (!branch.stdout) {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository has a named branch.",
      observed: "Detached or unborn branch with no branch name.",
      explanation: "Create or switch to a named branch before Studio continues."
    });
  }

  context.branch = branch.stdout;
  return passCheck({
    id: "git-ready",
    label: "Git ready",
    expected: "A non-bare Git repository exists with a named branch.",
    observed: `Branch: ${branch.stdout}`,
    explanation: "Git has the minimum local shape Studio needs."
  });
}

async function checkRemoteReady(targetRoot, context) {
  const result = await runGit(targetRoot, ["remote", "get-url", "origin"]);
  if (!result.ok || !result.stdout) {
    return blockedCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin points at an accessible GitHub repository.",
      observed: result.output || "origin is missing.",
      explanation: "Create or link a GitHub repository before target-specific setup begins.",
      repairs: [
        ghRepoCreateRepair(targetRoot),
        linkRemoteRepair()
      ]
    });
  }

  if (!isGithubRemoteUrl(result.stdout)) {
    return hardStopCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin is a GitHub remote.",
      observed: result.stdout,
      explanation: "Studio relies on gh for issues and PRs, so the primary remote must be GitHub."
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(result.stdout);
  const repoResult = await runGh(targetRoot, [
    "repo",
    "view",
    repoSlug,
    "--json",
    "nameWithOwner,url,defaultBranchRef"
  ], {
    timeout: 20_000
  });

  if (!repoResult.ok) {
    return hardStopCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "GitHub remote is accessible through gh.",
      observed: repoResult.output,
      explanation: "Studio cannot continue unless gh can inspect the target repository."
    });
  }

  let repoInfo = null;
  try {
    repoInfo = JSON.parse(repoResult.stdout);
  } catch (error) {
    return hardStopCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "gh returns repository metadata.",
      observed: String(error?.message || error),
      explanation: "Studio could not parse gh repository metadata."
    });
  }

  context.originUrl = result.stdout;
  context.remoteDefaultBranch = repoInfo?.defaultBranchRef?.name || "";
  return passCheck({
    id: "remote-ready",
    label: "Remote ready",
    expected: "origin points at an accessible GitHub repository.",
    observed: [
      repoInfo?.nameWithOwner || repoSlug,
      repoInfo?.url || result.stdout,
      context.remoteDefaultBranch ? `default: ${context.remoteDefaultBranch}` : "remote has no default branch yet"
    ].join("\n"),
    explanation: "gh can inspect the repository Studio will use for issues and PRs."
  });
}

async function checkRemoteSync(targetRoot, context) {
  const localHead = await runGit(targetRoot, ["rev-parse", "--verify", "HEAD"]);
  const hasLocalHead = localHead.ok && Boolean(localHead.stdout);
  const remoteBranch = context.remoteDefaultBranch;

  if (!hasLocalHead && !remoteBranch) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: "No local commits and remote has no default branch.",
      explanation: "This is a fresh repository pair."
    });
  }

  if (!hasLocalHead && remoteBranch) {
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote content is mirrored locally before Studio writes files.",
      observed: `Remote default branch exists: ${remoteBranch}; local has no commits.`,
      explanation: "Clone the existing repository into this target directory. Studio will not overlay remote files into an empty local repo."
    });
  }

  if (hasLocalHead && !remoteBranch) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: `Local HEAD: ${localHead.stdout}\nRemote has no default branch.`,
      explanation: "The remote is empty, so there is no remote history to reconcile."
    });
  }

  const remoteHead = await runGit(targetRoot, ["ls-remote", "origin", `refs/heads/${remoteBranch}`], {
    timeout: 20_000
  });
  const remoteSha = remoteHead.stdout.split(/\s+/u)[0] || "";

  if (!remoteHead.ok || !remoteSha) {
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote default branch SHA can be read.",
      observed: remoteHead.output,
      explanation: "Studio cannot prove local and remote histories agree."
    });
  }

  if (remoteSha !== localHead.stdout) {
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local HEAD equals origin default branch HEAD.",
      observed: `Local HEAD: ${localHead.stdout}\norigin/${remoteBranch}: ${remoteSha}`,
      explanation: "Studio hard-stops on divergent histories. Pull, clone, or reconcile manually before continuing."
    });
  }

  return passCheck({
    id: "remote-sync",
    label: "Remote/local sync",
    expected: "Local HEAD equals origin default branch HEAD.",
    observed: `HEAD ${localHead.stdout} matches origin/${remoteBranch}.`,
    explanation: "Local and remote histories are aligned."
  });
}

async function checkGitCheckpoint(targetRoot, context) {
  const status = await runGit(targetRoot, ["status", "--porcelain=v1"], {
    timeout: 15_000
  });

  if (!status.ok) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "Git working tree status can be read.",
      observed: status.output,
      explanation: "Studio cannot create a setup checkpoint until Git status is readable."
    });
  }

  if (status.stdout) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "Working tree is clean and the checkpoint commit is pushed to origin.",
      observed: status.stdout.split(/\r?\n/u).slice(0, 40).join("\n"),
      explanation: "App Setup created or left files in the target app. Review the exact file list, then create and push the baseline checkpoint before Studio continues.",
      repair: gitCheckpointRepair()
    });
  }

  const localHead = await runGit(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
  if (!localHead.ok || !localHead.stdout) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A setup checkpoint commit exists and is pushed to origin.",
      observed: localHead.output || "No local commits exist.",
      explanation: "Create the first setup checkpoint commit and push it before Studio continues.",
      repair: gitCheckpointRepair()
    });
  }

  const branchResult = context?.branch
    ? { ok: true, stdout: context.branch }
    : await runGit(targetRoot, ["branch", "--show-current"], {
      timeout: 15_000
    });
  const branch = String(branchResult.stdout || "").trim();
  if (!branchResult.ok || !branch) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A named branch is available for pushing the setup checkpoint.",
      observed: branchResult.output || "No current branch.",
      explanation: "Studio cannot push a baseline from a detached or unnamed branch."
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(context?.originUrl || "");
  if (!repoSlug) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "origin is a GitHub remote that can be checked through gh.",
      observed: context?.originUrl || "origin URL is unavailable.",
      explanation: "Studio cannot prove the setup checkpoint was published without the GitHub repository identity."
    });
  }

  const remoteHead = await runGh(targetRoot, [
    "api",
    githubBranchRefApiPath(repoSlug, branch),
    "--jq",
    ".object.sha"
  ], {
    timeout: 20_000
  });
  const remoteSha = remoteHead.stdout.trim();
  if (!remoteHead.ok || !remoteSha) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD is present on origin/${branch}.`,
      observed: remoteHead.output || `origin/${branch} is missing.`,
      explanation: "The setup checkpoint exists locally but has not been published to the GitHub remote yet.",
      repair: gitCheckpointRepair()
    });
  }

  if (remoteSha !== localHead.stdout) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD matches origin/${branch}.`,
      observed: `Local HEAD: ${localHead.stdout}\norigin/${branch}: ${remoteSha}`,
      explanation: "Push the setup checkpoint to origin. If Git rejects the push, reconcile the remote branch manually before continuing.",
      repair: gitCheckpointRepair()
    });
  }

  return passCheck({
    id: "git-checkpoint",
    label: "Git checkpoint",
    expected: "Working tree is clean and the checkpoint commit is pushed to origin.",
    observed: `Clean\nHEAD ${localHead.stdout} matches origin/${branch}.`,
    explanation: "Setup changes are committed locally and published as the baseline remote branch."
  });
}

function readyStage() {
  return passCheck({
    id: "ready",
    label: "Ready",
    expected: "The target app is ready for Studio workflows.",
    observed: "All setup stages passed.",
    explanation: "Studio can now inspect and operate on this app."
  });
}

function genericSetupChecks(targetRoot, context) {
  return [
    {
      expected: "Target directory is empty or already a Git repository.",
      id: "directory",
      label: "Directory admissibility",
      run: () => checkDirectory(targetRoot, context)
    },
    {
      expected: "Git repository exists, is non-bare, and has a named branch.",
      id: "git-ready",
      label: "Git ready",
      run: () => checkGitReady(targetRoot, context)
    },
    {
      expected: "origin points at an accessible GitHub repository.",
      id: "remote-ready",
      label: "Remote ready",
      run: () => checkRemoteReady(targetRoot, context)
    },
    {
      expected: "Local HEAD and the remote default branch are not divergent.",
      id: "remote-sync",
      label: "Remote/local sync",
      run: () => checkRemoteSync(targetRoot, context)
    }
  ];
}

function finalSetupChecks(targetRoot, context) {
  return [
    {
      expected: "Working tree is clean and the checkpoint commit is pushed to origin.",
      id: "git-checkpoint",
      label: "Git checkpoint",
      run: () => checkGitCheckpoint(targetRoot, context)
    },
    {
      expected: "The target app is ready for Studio workflows.",
      id: "ready",
      label: "Ready",
      run: readyStage
    }
  ];
}

async function setupCheckChain({
  context,
  setupPlugins = [],
  targetRoot
}) {
  const checks = [
    ...genericSetupChecks(targetRoot, context),
    ...await listDoctorPluginChecks({
      context,
      plugins: setupPlugins
    }),
    ...finalSetupChecks(targetRoot, context)
  ];
  assertUniqueCheckIds(checks);
  return checks;
}

async function runCoreSetupChecks({
  config = {},
  configEnvironment = {},
  emit = null,
  runGitCommand = null,
  setupPlugins = [],
  studioRoot = "",
  targetRoot
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || process.cwd()));
  const context = {
    config,
    configEnvironment,
    runGitCommand,
    studioRoot,
    targetRoot: resolvedTargetRoot
  };
  const checks = await setupCheckChain({
    context,
    setupPlugins,
    targetRoot: resolvedTargetRoot
  });
  const stages = [];

  for (let index = 0; index < checks.length; index += 1) {
    const result = await runDoctorCheck({
      check: checks[index],
      context,
      emit
    });
    stages.push(result);
    if (!checkPassed(result)) {
      return finalizeStatus({
        context,
        stages: appendPendingChecks(stages, checks, index + 1),
        targetRoot: resolvedTargetRoot
      });
    }
  }

  return finalizeStatus({
    context,
    stages,
    targetRoot: resolvedTargetRoot
  });
}

async function inspectAppSetup(options = {}) {
  return runCoreSetupChecks(options);
}

function startDockerTerminal({
  args,
  commandPreview,
  env = {},
  targetRoot
}) {
  return startTerminalSession({
    args,
    command: "docker",
    commandPreview,
    cwd: targetRoot,
    env,
    namespace: TERMINAL_NAMESPACE
  });
}

function startGitInitTerminal(targetRoot, env = {}) {
  return startDockerTerminal({
    args: gitInitTerminalArgs(targetRoot),
    commandPreview: gitInitRepair(targetRoot).commandPreview,
    env,
    targetRoot
  });
}

function startGhCreateRepoTerminal(targetRoot, env = {}) {
  return startDockerTerminal({
    args: ghRepoCreateTerminalArgs(targetRoot),
    commandPreview: ghRepoCreateRepair(targetRoot).commandPreview,
    env,
    targetRoot
  });
}

function startLinkRemoteTerminal(targetRoot, input = {}, env = {}) {
  const validation = validateGithubRemoteInput(input);
  if (!validation.ok) {
    return {
      error: validation.error,
      ok: false
    };
  }
  const script = shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=/workspace remote add origin \"$AI_STUDIO_REMOTE_URL\"",
    "git -c safe.directory=/workspace remote get-url origin"
  ]);
  const args = buildSetupTerminalArgs(["bash", "-lc", script], {
    extraArgs: [
      ...workspaceWriteDockerArgs(),
      "-e",
      `AI_STUDIO_REMOTE_URL=${validation.url}`
    ],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: `git remote add origin ${shellQuote(validation.url)}`,
    env,
    targetRoot
  });
}

function startGitCheckpointTerminal(targetRoot, input = {}, env = {}) {
  const validation = validateCommitMessage(input.commitMessage);
  if (!validation.ok) {
    return {
      error: validation.error,
      ok: false
    };
  }
  const args = buildSetupTerminalArgs(["bash", "-lc", gitCheckpointScript()], {
    extraArgs: [
      ...hostUserIdentityEnvArgs(),
      "-e",
      "GH_PROMPT_DISABLED=1",
      "-e",
      `AI_STUDIO_COMMIT_MESSAGE=${validation.commitMessage}`
    ],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: gitCheckpointRepair().commandPreview.replace("<commitMessage>", validation.commitMessage),
    env,
    targetRoot
  });
}

function createService({
  projectService = null,
  studioRoot = "",
  targetRoot
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || process.cwd()));
  const resolvedStudioRoot = path.resolve(String(studioRoot || process.cwd()));
  const readyStatusCache = createReadyStatusCache();

  async function loadAdapterSetupRuntime() {
    if (!projectService || typeof projectService.createRuntime !== "function") {
      return {
        config: {},
        configEnvironment: {},
        setupPlugins: []
      };
    }
    const runtime = await projectService.createRuntime();
    if (typeof runtime.adapter?.getSetupDoctorPlugins !== "function") {
      return {
        config: runtime.projectConfig || {},
        configEnvironment: {},
        setupPlugins: []
      };
    }
    const configEnvironment = typeof projectService.projectConfigEnvironment === "function"
      ? await projectService.projectConfigEnvironment()
      : {};
    return {
      config: runtime.projectConfig || {},
      configEnvironment,
      setupPlugins: await runtime.adapter.getSetupDoctorPlugins({
        config: runtime.projectConfig || {},
        configEnvironment,
        startTerminalSession,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot,
        terminalNamespace: TERMINAL_NAMESPACE
      })
    };
  }

  return Object.freeze({
    async getStatus() {
      const cachedStatus = readyStatusCache.read();
      if (cachedStatus) {
        return cachedStatus;
      }
      const setupRuntime = await loadAdapterSetupRuntime();
      return readyStatusCache.remember(await inspectAppSetup({
        config: setupRuntime.config,
        configEnvironment: setupRuntime.configEnvironment,
        setupPlugins: setupRuntime.setupPlugins,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async streamStatus({ emit } = {}) {
      const setupRuntime = await loadAdapterSetupRuntime();
      return readyStatusCache.remember(await inspectAppSetup({
        config: setupRuntime.config,
        configEnvironment: setupRuntime.configEnvironment,
        emit,
        setupPlugins: setupRuntime.setupPlugins,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async startTerminal({
      actionId,
      inputs = {}
    } = {}) {
      const setupRuntime = await loadAdapterSetupRuntime();
      if (actionId === "terminal-git-init") {
        return startGitInitTerminal(resolvedTargetRoot, setupRuntime.configEnvironment);
      }
      if (actionId === "terminal-gh-create-repo") {
        return startGhCreateRepoTerminal(resolvedTargetRoot, setupRuntime.configEnvironment);
      }
      if (actionId === "terminal-link-github-remote") {
        return startLinkRemoteTerminal(resolvedTargetRoot, inputs, setupRuntime.configEnvironment);
      }
      if (actionId === "terminal-git-checkpoint") {
        return startGitCheckpointTerminal(resolvedTargetRoot, inputs, setupRuntime.configEnvironment);
      }

      const pluginTerminal = await startDoctorPluginTerminal({
        actionId,
        context: {
          config: setupRuntime.config,
          configEnvironment: setupRuntime.configEnvironment,
          studioRoot: resolvedStudioRoot,
          targetRoot: resolvedTargetRoot
        },
        input: inputs,
        plugins: setupRuntime.setupPlugins
      });
      if (pluginTerminal) {
        return pluginTerminal;
      }
      return {
        error: "Unknown terminal action.",
        ok: false
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
  ghRepoCreateScript,
  gitCheckpointScript,
  githubBranchRefApiPath,
  inspectAppSetup
};
