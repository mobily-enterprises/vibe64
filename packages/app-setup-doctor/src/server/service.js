import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  readdir,
  readFile
} from "node:fs/promises";
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
import {
  shellScript
} from "../../../../server/lib/shellScript.js";

const TOOLCHAIN_IMAGE = "jskit-ai-studio-toolchain:0.1.0";
const TOOL_HOME_VOLUME = "jskit_ai_studio_tool_home";
const MYSQL_CONTAINER = "jskit-ai-studio-mysql";
const MYSQL_ROOT_PASSWORD = "jskit_studio_root";
const TERMINAL_NAMESPACE = "app-setup-doctor";
const CONFIG_IMPORT_FILES = [
  "eslint.config.mjs",
  "playwright.config.mjs",
  "vite.config.mjs",
  "vitest.config.mjs"
];

const STAGE_DEFINITIONS = [
  ["directory", "Directory admissibility", "Target directory is empty or already a Git repository."],
  ["git-ready", "Git ready", "Git repository exists, is non-bare, and has a named branch."],
  ["remote-ready", "Remote ready", "origin points at an accessible GitHub repository."],
  ["remote-sync", "Remote/local sync", "Local HEAD and the remote default branch are not divergent."],
  ["scaffold", "Initial JSKIT scaffold", "Minimal JSKIT scaffold markers exist."],
  ["dependencies", "Dependencies runnable", "Node dependencies are installed enough to run JSKIT commands."],
  ["runtime-services", "Runtime services", "Only runtime services required by the target app are reachable."],
  ["jskit-doctor", "JSKIT doctor", "The official JSKIT verification command passes."],
  ["git-checkpoint", "Git checkpoint", "Working tree is clean and the checkpoint commit is pushed to origin."],
  ["ready", "Ready", "The target app is ready for Studio workflows."]
];

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
    exitCode: result.exitCode,
    ok: result.exitCode === 0,
    output,
    stderr: stderr.trim(),
    stdout: stdout.trim()
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
      exitCode: typeof error.exitCode === "number" ? error.exitCode : 1,
      ok: false,
      output: String(error.all || error.message || "").trim(),
      stderr: String(error.stderr || "").trim(),
      stdout: String(error.stdout || "").trim()
    };
  }
}

function hostUserDockerArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return ["-u", `${process.getuid()}:${process.getgid()}`];
}

function hostUserIdentityEnvArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return [
    "-e",
    `JSKIT_HOST_UID=${process.getuid()}`,
    "-e",
    `JSKIT_HOST_GID=${process.getgid()}`
  ];
}

function writableHostUserDockerArgs() {
  return [
    ...hostUserDockerArgs(),
    "-e",
    "HOME=/tmp/studio-home",
    "-e",
    "npm_config_cache=/tmp/npm-cache"
  ];
}

function buildToolchainArgs(commandArgs, {
  extraArgs = [],
  targetRoot
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
  extraArgs = [],
  targetRoot,
  timeout = 20000
} = {}) {
  return runHostCommand("docker", buildToolchainArgs(commandArgs, {
    extraArgs,
    targetRoot
  }), {
    timeout
  });
}

async function runDocker(args, options = {}) {
  return runHostCommand("docker", args, options);
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

function stage({
  explanation,
  expected,
  id,
  label,
  observed,
  repair = null,
  repairs = null,
  status
}) {
  const normalizedRepairs = Array.isArray(repairs)
    ? repairs.filter(Boolean)
    : [repair].filter(Boolean);
  return {
    explanation,
    expected,
    id,
    label,
    observed: String(observed || "").trim() || "not available",
    repair: normalizedRepairs[0] || null,
    repairs: normalizedRepairs,
    required: true,
    status
  };
}

function passStage(details) {
  return stage({
    ...details,
    status: "pass"
  });
}

function blockedStage(details) {
  return stage({
    ...details,
    status: "blocked"
  });
}

function hardStopStage(details) {
  return stage({
    ...details,
    status: "hard-stop"
  });
}

function pendingStage(definition) {
  const [id, label, expected] = definition;
  return stage({
    explanation: "This stage runs after the previous required stages pass.",
    expected,
    id,
    label,
    observed: "Waiting for previous stage.",
    status: "pending"
  });
}

function appendPending(stages, startIndex) {
  return [
    ...stages,
    ...STAGE_DEFINITIONS.slice(startIndex).map(pendingStage)
  ];
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

async function runAppSetupStep(emit, {
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

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "jskit-app")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "jskit-app";
}

function titleFromRepoName(repoName) {
  return repoName
    .split(/[-_.\s]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "JSKIT App";
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return {
      ok: true,
      value: JSON.parse(text)
    };
  } catch (error) {
    return {
      error: String(error?.message || error),
      ok: false,
      value: null
    };
  }
}

function formatList(items, limit = 12) {
  const values = items.filter(Boolean);
  if (!values.length) {
    return "none";
  }
  const visible = values.slice(0, limit);
  const suffix = values.length > visible.length ? `\n...and ${values.length - visible.length} more` : "";
  return `${visible.join("\n")}${suffix}`;
}

async function listMeaningfulEntries(targetRoot) {
  const ignored = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
  const entries = await readdir(targetRoot, {
    withFileTypes: true
  });
  return entries
    .map((entry) => entry.name)
    .filter((name) => !ignored.has(name))
    .sort((a, b) => a.localeCompare(b));
}

function gitInitRepair(targetRoot) {
  const script = shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=/workspace init",
    "git -c safe.directory=/workspace branch -M main"
  ]);
  const args = buildTerminalArgs(["bash", "-lc", script], {
    extraArgs: writableHostUserDockerArgs(),
    targetRoot
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
  const args = buildTerminalArgs(["bash", "-lc", ghRepoCreateScript(repoName)], {
    extraArgs: ["-e", "GH_PROMPT_DISABLED=1"],
    targetRoot
  });

  return createRepair({
    actionId: "terminal-gh-create-repo",
    command: dockerCommand(args),
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

function scaffoldRepair(targetRoot) {
  const repoName = repoNameFromTargetRoot(targetRoot);
  const appTitle = titleFromRepoName(repoName);
  const script = shellScript([
    "set -e",
    "set -x",
    "npx @jskit-ai/create-app \"$JSKIT_APP_NAME\" --target . --force --tenancy-mode none --title \"$JSKIT_APP_TITLE\" --initial-bundles none"
  ]);
  const args = buildTerminalArgs(["bash", "-lc", script], {
    extraArgs: [
      ...writableHostUserDockerArgs(),
      "-e",
      `JSKIT_APP_NAME=${repoName}`,
      "-e",
      `JSKIT_APP_TITLE=${appTitle}`
    ],
    targetRoot
  });

  return createRepair({
    actionId: "terminal-scaffold-jskit",
    command: dockerCommand(args),
    label: "Create JSKIT scaffold"
  });
}

function npmInstallScript() {
  return shellScript([
    "set -e",
    "set -x",
    "npm install",
    "jskit_deps=$(node -e \"const p=require('./package.json'); const deps={...(p.dependencies||{}), ...(p.devDependencies||{})}; console.log(Object.keys(deps).filter((name) => name.startsWith('@jskit-ai/')).join(' '));\")",
    "if [ -n \"$jskit_deps\" ]; then npm update $jskit_deps; fi"
  ]);
}

function npmInstallRepair(targetRoot) {
  const script = npmInstallScript();
  const args = buildTerminalArgs(["bash", "-lc", script], {
    extraArgs: writableHostUserDockerArgs(),
    targetRoot
  });

  return createRepair({
    actionId: "terminal-npm-install",
    command: dockerCommand(args),
    label: "Install dependencies"
  });
}

function jskitDoctorScript() {
  return shellScript([
    "set -e",
    "set -x",
    "if node -e \"const p=require('./package.json'); process.exit(p.scripts && p.scripts.verify ? 0 : 1)\"; then npm run verify; else npx jskit app verify; fi"
  ]);
}

function jskitDoctorRepair(targetRoot) {
  const args = buildTerminalArgs(["bash", "-lc", jskitDoctorScript()], {
    extraArgs: writableHostUserDockerArgs(),
    targetRoot
  });

  return createRepair({
    actionId: "terminal-jskit-doctor",
    command: dockerCommand(args),
    label: "Run JSKIT doctor"
  });
}

function doctorIssueLines(output) {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^-\s+\[[^\]]+\]/u.test(line));
}

function isUiVerificationDoctorIssue(line) {
  return /^-\s+\[ui:verification\]/u.test(String(line || "").trim());
}

function onlyUiVerificationDoctorIssues(output) {
  const issues = doctorIssueLines(output);
  return issues.length > 0 && issues.every(isUiVerificationDoctorIssue);
}

function gitCheckpointScript() {
  return shellScript([
    "set -e",
    "set -x",
    ": \"${JSKIT_HOST_UID:=0}\"",
    ": \"${JSKIT_HOST_GID:=0}\"",
    "as_host() { setpriv --reuid \"$JSKIT_HOST_UID\" --regid \"$JSKIT_HOST_GID\" --clear-groups \"$@\"; }",
    "set +x",
    "export GIT_PASSWORD=\"$(gh auth token)\"",
    "printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '*Username*) printf \"%s\\\\n\" \"x-access-token\" ;;' '*) printf \"%s\\\\n\" \"$GIT_PASSWORD\" ;;' 'esac' > /tmp/jskit-git-askpass",
    "chown \"$JSKIT_HOST_UID:$JSKIT_HOST_GID\" /tmp/jskit-git-askpass",
    "chmod 700 /tmp/jskit-git-askpass",
    "export GIT_ASKPASS=/tmp/jskit-git-askpass",
    "export GIT_TERMINAL_PROMPT=0",
    "set -x",
    "as_host git -c safe.directory=/workspace status --short",
    "if ! as_host git -c safe.directory=/workspace rev-parse --verify HEAD >/dev/null 2>&1; then if [ -z \"$(as_host git -c safe.directory=/workspace status --porcelain=v1)\" ]; then echo 'No files to checkpoint and no commits exist.'; exit 1; fi; as_host git -c safe.directory=/workspace add .; as_host git -c safe.directory=/workspace commit -m \"$JSKIT_COMMIT_MESSAGE\"; elif [ -n \"$(as_host git -c safe.directory=/workspace status --porcelain=v1)\" ]; then as_host git -c safe.directory=/workspace add .; as_host git -c safe.directory=/workspace commit -m \"$JSKIT_COMMIT_MESSAGE\"; fi",
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
        defaultValue: "Initial JSKIT app setup",
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

function validateGithubRemoteInput(inputs = {}) {
  const url = String(inputs.url || "").trim();
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
    return hardStopStage({
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
    return hardStopStage({
      id: "directory",
      label: "Directory admissibility",
      expected: "A directory without .git is empty.",
      observed: `No .git directory, but files exist:\n${formatList(nonGitEntries)}`,
      explanation: "V0 will not initialize Git over existing files because it cannot know their ownership."
    });
  }

  if (!gitStat) {
    context.directoryMode = "empty-no-git";
    return passStage({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory is empty or already a Git repository.",
      observed: "Empty directory with no .git.",
      explanation: "Studio can safely initialize this directory."
    });
  }

  if (!gitStat.isDirectory()) {
    return hardStopStage({
      id: "directory",
      label: "Directory admissibility",
      expected: ".git is a directory in V0.",
      observed: ".git is not a directory.",
      explanation: "V0 does not operate on linked worktrees or submodule-style .git files."
    });
  }

  context.directoryMode = "git-repo";
  return passStage({
    id: "directory",
    label: "Directory admissibility",
    expected: "Target directory is empty or already a Git repository.",
    observed: ".git directory exists.",
    explanation: "Studio can continue with Git safety checks."
  });
}

async function checkGitReady(targetRoot, context) {
  if (context.directoryMode === "empty-no-git") {
    return blockedStage({
      id: "git-ready",
      label: "Git ready",
      expected: "A non-bare Git repository exists with a named branch.",
      observed: "No .git directory.",
      explanation: "Initialize Git before Studio creates or links a remote repository.",
      repair: gitInitRepair(targetRoot)
    });
  }

  const inside = await runGit(targetRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout !== "true") {
    return hardStopStage({
      id: "git-ready",
      label: "Git ready",
      expected: "Target root is inside a Git work tree.",
      observed: inside.output,
      explanation: "The .git directory exists, but Git does not recognize the target as a normal work tree."
    });
  }

  const [bare, branch] = await Promise.all([
    runGit(targetRoot, ["rev-parse", "--is-bare-repository"]),
    runGit(targetRoot, ["branch", "--show-current"])
  ]);

  if (bare.stdout === "true") {
    return hardStopStage({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository is a non-bare work tree.",
      observed: "Bare repository.",
      explanation: "V0 only operates inside normal working trees."
    });
  }

  if (!branch.stdout) {
    return hardStopStage({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository has a named branch.",
      observed: "Detached or unborn branch with no branch name.",
      explanation: "Create or switch to a named branch before Studio continues."
    });
  }

  context.branch = branch.stdout;
  return passStage({
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
    return blockedStage({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin points at an accessible GitHub repository.",
      observed: result.output || "origin is missing.",
      explanation: "Create or link a GitHub repository before scaffolding begins.",
      repairs: [
        ghRepoCreateRepair(targetRoot),
        linkRemoteRepair()
      ]
    });
  }

  if (!isGithubRemoteUrl(result.stdout)) {
    return hardStopStage({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin is a GitHub remote.",
      observed: result.stdout,
      explanation: "V0 relies on gh for issues and PRs, so the primary remote must be GitHub."
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
    timeout: 20000
  });

  if (!repoResult.ok) {
    return hardStopStage({
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
    return hardStopStage({
      id: "remote-ready",
      label: "Remote ready",
      expected: "gh returns repository metadata.",
      observed: String(error?.message || error),
      explanation: "Studio could not parse gh repository metadata."
    });
  }

  context.originUrl = result.stdout;
  context.remoteDefaultBranch = repoInfo?.defaultBranchRef?.name || "";
  return passStage({
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
    return passStage({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: "No local commits and remote has no default branch.",
      explanation: "This is a fresh repository pair."
    });
  }

  if (!hasLocalHead && remoteBranch) {
    return hardStopStage({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote content is mirrored locally before Studio writes files.",
      observed: `Remote default branch exists: ${remoteBranch}; local has no commits.`,
      explanation: "Clone the existing repository into this target directory. V0 will not overlay remote files into an empty local repo."
    });
  }

  if (hasLocalHead && !remoteBranch) {
    return passStage({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: `Local HEAD: ${localHead.stdout}\nRemote has no default branch.`,
      explanation: "The remote is empty, so there is no remote history to reconcile."
    });
  }

  const remoteHead = await runGit(targetRoot, ["ls-remote", "origin", `refs/heads/${remoteBranch}`], {
    timeout: 20000
  });
  const remoteSha = remoteHead.stdout.split(/\s+/u)[0] || "";

  if (!remoteHead.ok || !remoteSha) {
    return hardStopStage({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote default branch SHA can be read.",
      observed: remoteHead.output,
      explanation: "Studio cannot prove local and remote histories agree."
    });
  }

  if (remoteSha !== localHead.stdout) {
    return hardStopStage({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local HEAD equals origin default branch HEAD.",
      observed: `Local HEAD: ${localHead.stdout}\norigin/${remoteBranch}: ${remoteSha}`,
      explanation: "V0 hard-stops on divergent histories. Pull, clone, or reconcile manually before continuing."
    });
  }

  return passStage({
    id: "remote-sync",
    label: "Remote/local sync",
    expected: "Local HEAD equals origin default branch HEAD.",
    observed: `HEAD ${localHead.stdout} matches origin/${remoteBranch}.`,
    explanation: "Local and remote histories are aligned."
  });
}

async function checkScaffold(targetRoot, context) {
  const lockPath = path.join(targetRoot, ".jskit", "lock.json");
  const markers = {
    configPublic: await fileExists(path.join(targetRoot, "config", "public.js")),
    lock: await fileExists(lockPath),
    packageJson: await fileExists(path.join(targetRoot, "package.json"))
  };

  if (markers.lock) {
    const lock = await readJsonFile(lockPath);
    if (!lock.ok) {
      return hardStopStage({
        id: "scaffold",
        label: "Initial JSKIT scaffold",
        expected: ".jskit/lock.json is valid JSON.",
        observed: lock.error,
        explanation: "Malformed JSKIT metadata needs manual recovery before Studio can reason about the app."
      });
    }
    context.jskitLock = lock.value;
  }

  if (markers.packageJson && markers.lock && markers.configPublic) {
    return passStage({
      id: "scaffold",
      label: "Initial JSKIT scaffold",
      expected: "package.json, .jskit/lock.json, and config/public.js exist.",
      observed: "Minimal JSKIT scaffold markers are present.",
      explanation: "Studio can now use official JSKIT tooling for deeper checks."
    });
  }

  const nonGitEntries = (context.nonGitEntries || []).filter((entry) => entry !== "node_modules");
  if (nonGitEntries.length) {
    return hardStopStage({
      id: "scaffold",
      label: "Initial JSKIT scaffold",
      expected: "Existing files are already a recognizable JSKIT scaffold.",
      observed: `Missing markers: ${Object.entries(markers).filter(([, present]) => !present).map(([name]) => name).join(", ")}\nFiles: ${formatList(nonGitEntries)}`,
      explanation: "V0 will not run the JSKIT app generator over an existing non-JSKIT file tree."
    });
  }

  return blockedStage({
    id: "scaffold",
    label: "Initial JSKIT scaffold",
    expected: "Minimal JSKIT scaffold markers exist.",
    observed: "No scaffold files are present yet.",
    explanation: "Create the smallest JSKIT app scaffold before installing dependencies or running doctor.",
    repair: scaffoldRepair(targetRoot)
  });
}

async function readPackageJson(targetRoot) {
  const result = await readJsonFile(path.join(targetRoot, "package.json"));
  return result.ok ? result.value : null;
}

function directDependencyNames(packageJson) {
  const names = new Set();
  for (const bucket of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(packageJson?.[bucket] || {})) {
      names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function nodeModulePackageJsonPath(targetRoot, packageName) {
  return path.join(targetRoot, "node_modules", ...String(packageName || "").split("/"), "package.json");
}

async function missingDirectDependencies(targetRoot, packageJson) {
  const missing = [];
  for (const packageName of directDependencyNames(packageJson)) {
    if (!await fileExists(nodeModulePackageJsonPath(targetRoot, packageName))) {
      missing.push(packageName);
    }
  }
  return missing;
}

function packageSpecifierInfo(specifier) {
  const normalized = String(specifier || "").trim();
  if (!normalized || normalized.startsWith(".") || normalized.startsWith("/") || normalized.startsWith("node:")) {
    return null;
  }

  const parts = normalized.split("/");
  if (normalized.startsWith("@")) {
    if (parts.length < 2) {
      return null;
    }
    return {
      packageName: parts.slice(0, 2).join("/"),
      subpath: parts.slice(2).join("/")
    };
  }

  return {
    packageName: parts[0],
    subpath: parts.slice(1).join("/")
  };
}

function configImportSpecifiersFromText(text) {
  const specifiers = new Set();
  const importPattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gmu;
  for (const match of String(text || "").matchAll(importPattern)) {
    const specifier = match[1] || match[2] || match[3] || "";
    if (packageSpecifierInfo(specifier)) {
      specifiers.add(specifier);
    }
  }
  return [...specifiers].sort((left, right) => left.localeCompare(right));
}

function exportMapHasSubpath(exportsMap, subpathKey) {
  if (!exportsMap) {
    return false;
  }
  if (typeof exportsMap === "string") {
    return subpathKey === ".";
  }
  if (Array.isArray(exportsMap)) {
    return subpathKey === ".";
  }
  if (typeof exportsMap !== "object") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(exportsMap, subpathKey)) {
    return true;
  }
  for (const key of Object.keys(exportsMap)) {
    if (!key.includes("*")) {
      continue;
    }
    const [prefix, suffix] = key.split("*");
    if (subpathKey.startsWith(prefix) && subpathKey.endsWith(suffix || "")) {
      return true;
    }
  }
  return false;
}

async function legacySubpathExists(packageRoot, subpath) {
  const basePath = path.join(packageRoot, ...subpath.split("/"));
  for (const candidate of [
    basePath,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.js"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.cjs")
  ]) {
    if (await fileExists(candidate)) {
      return true;
    }
  }
  return false;
}

async function configImportProblems(targetRoot) {
  const problems = [];
  for (const fileName of CONFIG_IMPORT_FILES) {
    let text = "";
    try {
      text = await readFile(path.join(targetRoot, fileName), "utf8");
    } catch {
      continue;
    }

    for (const specifier of configImportSpecifiersFromText(text)) {
      const info = packageSpecifierInfo(specifier);
      if (!info?.subpath) {
        continue;
      }

      const packageRoot = path.join(targetRoot, "node_modules", ...info.packageName.split("/"));
      const packageJsonPath = path.join(packageRoot, "package.json");
      const packageJson = await readJsonFile(packageJsonPath);
      if (!packageJson.ok) {
        problems.push(`${fileName}: ${specifier} package metadata is missing.`);
        continue;
      }

      const subpathKey = `./${info.subpath}`;
      if (packageJson.value.exports) {
        if (!exportMapHasSubpath(packageJson.value.exports, subpathKey)) {
          problems.push(`${fileName}: ${specifier} is not exported by ${info.packageName}@${packageJson.value.version || "unknown"} (${subpathKey}).`);
        }
        continue;
      }

      if (!await legacySubpathExists(packageRoot, info.subpath)) {
        problems.push(`${fileName}: ${specifier} is not present in ${info.packageName}@${packageJson.value.version || "unknown"}.`);
      }
    }
  }
  return problems.sort((left, right) => left.localeCompare(right));
}

async function checkDependencies(targetRoot, context) {
  const packageJson = await readPackageJson(targetRoot);
  context.packageJson = packageJson;
  if (!packageJson) {
    return blockedStage({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "package.json exists before npm install.",
      observed: "package.json is missing.",
      explanation: "Dependencies can only be installed after the scaffold exists."
    });
  }

  const missingDependencies = await missingDirectDependencies(targetRoot, packageJson);
  if (missingDependencies.length) {
    return blockedStage({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "All direct non-optional package.json dependencies are installed.",
      observed: `Missing node_modules packages:\n${formatList(missingDependencies)}`,
      explanation: "Install dependencies before running the official JSKIT doctor.",
      repair: npmInstallRepair(targetRoot)
    });
  }

  const importProblems = await configImportProblems(targetRoot);
  if (importProblems.length) {
    return blockedStage({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "Config-file package imports resolve from installed node_modules.",
      observed: formatList(importProblems, 8),
      explanation: "The target lockfile can pin stale JSKIT packages that install successfully but do not provide exports used by generated config files.",
      repair: npmInstallRepair(targetRoot)
    });
  }

  const hasJskitBin = await fileExists(path.join(targetRoot, "node_modules", ".bin", "jskit"));
  const hasJskitCli = await fileExists(path.join(targetRoot, "node_modules", "@jskit-ai", "jskit-cli"));
  if (hasJskitBin || hasJskitCli) {
    return passStage({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "JSKIT CLI dependency is installed locally.",
      observed: "node_modules contains JSKIT CLI tooling.",
      explanation: "Local JSKIT commands can run in the target app.",
      repair: npmInstallRepair(targetRoot)
    });
  }

  return blockedStage({
    id: "dependencies",
    label: "Dependencies runnable",
    expected: "Local dependencies are installed.",
    observed: "node_modules does not contain JSKIT CLI tooling.",
    explanation: "Install dependencies before running the official JSKIT doctor.",
    repair: npmInstallRepair(targetRoot)
  });
}

function dependencyNames(packageJson, jskitLock) {
  const names = new Set();
  for (const bucket of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(packageJson?.[bucket] || {})) {
      names.add(name);
    }
  }
  for (const name of Object.keys(jskitLock?.installedPackages || {})) {
    names.add(name);
  }
  return names;
}

function parseEnvText(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function readEnv(targetRoot) {
  const env = {};
  for (const fileName of [".env", ".env.local"]) {
    try {
      Object.assign(env, parseEnvText(await readFile(path.join(targetRoot, fileName), "utf8")));
    } catch {
      // Missing env files are valid; many JSKIT apps do not need runtime services.
    }
  }
  return env;
}

function databaseNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/u, "").split("/")[0] || "";
  } catch {
    return "";
  }
}

function escapeMysqlIdentifier(value) {
  return String(value).replaceAll("`", "``");
}

function validateDatabaseName(value) {
  const databaseName = String(value || "").trim();
  if (!/^[A-Za-z0-9_]+$/u.test(databaseName)) {
    return {
      databaseName,
      ok: false
    };
  }
  return {
    databaseName,
    ok: true
  };
}

function mysqlCreateDatabaseRepair(databaseName) {
  const escaped = escapeMysqlIdentifier(databaseName);
  const sql = `CREATE DATABASE IF NOT EXISTS \`${escaped}\`; SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${databaseName}';`;
  const args = [
    "exec",
    "-it",
    MYSQL_CONTAINER,
    "mysql",
    "-uroot",
    `-p${MYSQL_ROOT_PASSWORD}`,
    "-e",
    sql
  ];

  return createRepair({
    actionId: "terminal-create-app-db",
    command: dockerCommand(args),
    fields: [
      {
        defaultValue: databaseName,
        id: "databaseName",
        label: "Database name",
        required: true,
        type: "text"
      }
    ],
    label: "Create app database"
  });
}

async function checkRuntimeServices(targetRoot, context) {
  const packageJson = context.packageJson || await readPackageJson(targetRoot);
  const names = dependencyNames(packageJson, context.jskitLock);
  const hasDatabase = [...names].some((name) => name.includes("database-runtime"));
  const wantsMysql = [...names].some((name) => name.includes("database-runtime-mysql"));
  const wantsPostgres = [...names].some((name) => name.includes("database-runtime-postgres"));

  if (!hasDatabase) {
    return passStage({
      id: "runtime-services",
      label: "Runtime services",
      expected: "No runtime service is required unless the target app asks for one.",
      observed: "No JSKIT database runtime package detected.",
      explanation: "Fresh minimal scaffolds do not require a database."
    });
  }

  if (wantsPostgres && !wantsMysql) {
    return hardStopStage({
      id: "runtime-services",
      label: "Runtime services",
      expected: "V0 supports managed MySQL checks only.",
      observed: "Postgres runtime package detected.",
      explanation: "Postgres service orchestration is outside this V0 slice."
    });
  }

  const env = await readEnv(targetRoot);
  const databaseName = env.DB_NAME || databaseNameFromUrl(env.DATABASE_URL);
  const validation = validateDatabaseName(databaseName);
  if (!validation.ok) {
    return hardStopStage({
      id: "runtime-services",
      label: "Runtime services",
      expected: "Database apps declare a valid DB_NAME or DATABASE_URL.",
      observed: databaseName || "No database name found in .env or .env.local.",
      explanation: "Studio cannot create or verify an app database without an explicit database name."
    });
  }

  const ping = await runDocker([
    "exec",
    MYSQL_CONTAINER,
    "mysqladmin",
    "ping",
    "-uroot",
    `-p${MYSQL_ROOT_PASSWORD}`,
    "--silent"
  ], {
    timeout: 12000
  });

  if (!ping.ok) {
    return blockedStage({
      id: "runtime-services",
      label: "Runtime services",
      expected: "Managed MySQL is reachable.",
      observed: ping.output,
      explanation: "Bootup must provide a working MySQL container before database apps can proceed."
    });
  }

  const schema = await runDocker([
    "exec",
    MYSQL_CONTAINER,
    "mysql",
    "-uroot",
    `-p${MYSQL_ROOT_PASSWORD}`,
    "-N",
    "-B",
    "-e",
    `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${validation.databaseName}';`
  ], {
    timeout: 15000
  });

  if (!schema.ok || !schema.stdout.split(/\s+/u).includes(validation.databaseName)) {
    return blockedStage({
      id: "runtime-services",
      label: "Runtime services",
      expected: `${validation.databaseName} exists in managed MySQL.`,
      observed: schema.output || "Database not found.",
      explanation: "Create the app database before running JSKIT doctor.",
      repair: mysqlCreateDatabaseRepair(validation.databaseName)
    });
  }

  if (env.DB_USER) {
    const appLogin = await runDocker([
      "exec",
      MYSQL_CONTAINER,
      "mysql",
      `-u${env.DB_USER}`,
      env.DB_PASSWORD ? `-p${env.DB_PASSWORD}` : "",
      validation.databaseName,
      "-e",
      "SELECT 1;"
    ].filter(Boolean), {
      timeout: 15000
    });

    if (!appLogin.ok) {
      return hardStopStage({
        id: "runtime-services",
        label: "Runtime services",
        expected: "Configured DB_USER can connect to the app database.",
        observed: appLogin.output,
        explanation: "Fix database credentials or grants manually before Studio continues."
      });
    }
  }

  return passStage({
    id: "runtime-services",
    label: "Runtime services",
    expected: "Required runtime services are reachable.",
    observed: env.DB_USER
      ? `${validation.databaseName} exists and ${env.DB_USER} can connect.`
      : `${validation.databaseName} exists in managed MySQL.`,
    explanation: "The target app's database dependency has a reachable database."
  });
}

async function checkJskitDoctor(targetRoot) {
  const result = await runToolchain(["bash", "-lc", jskitDoctorScript()], {
    extraArgs: writableHostUserDockerArgs(),
    targetRoot,
    timeout: 180000
  });

  if (!result.ok) {
    if (onlyUiVerificationDoctorIssues(result.output)) {
      return passStage({
        id: "jskit-doctor",
        label: "JSKIT doctor",
        expected: "Official JSKIT verification passes, or only the fresh scaffold UI receipt gate remains before the setup checkpoint.",
        observed: [
          "JSKIT doctor reported only UI verification receipt issue(s).",
          formatList(doctorIssueLines(result.output), 4)
        ].join("\n"),
        explanation: "Fresh scaffold UI files are the setup baseline, not Studio feature work yet. App Setup continues to the Git checkpoint so later UI changes still require real verification receipts."
      });
    }

    return blockedStage({
      id: "jskit-doctor",
      label: "JSKIT doctor",
      expected: "Official JSKIT verification passes.",
      observed: result.output.split(/\r?\n/u).slice(-24).join("\n"),
      explanation: "Studio does not duplicate JSKIT internals; fix the reported doctor issues and refresh.",
      repair: jskitDoctorRepair(targetRoot)
    });
  }

  return passStage({
    id: "jskit-doctor",
    label: "JSKIT doctor",
    expected: "Official JSKIT verification passes.",
    observed: result.output.split(/\r?\n/u).slice(-12).join("\n") || "Verification passed.",
    explanation: "The target app passes the authoritative JSKIT readiness check."
  });
}

async function checkGitCheckpoint(targetRoot, context) {
  const status = await runGit(targetRoot, ["status", "--porcelain=v1"], {
    timeout: 15000
  });

  if (!status.ok) {
    return hardStopStage({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "Git working tree status can be read.",
      observed: status.output,
      explanation: "Studio cannot create a setup checkpoint until Git status is readable."
    });
  }

  if (status.stdout) {
    return blockedStage({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "Working tree is clean and the checkpoint commit is pushed to origin.",
      observed: status.stdout.split(/\r?\n/u).slice(0, 40).join("\n"),
      explanation: "App Setup created or left files in the target app. Review the exact file list, then create and push the baseline checkpoint before Studio continues.",
      repair: gitCheckpointRepair()
    });
  }

  const localHead = await runGit(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15000
  });
  if (!localHead.ok || !localHead.stdout) {
    return blockedStage({
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
      timeout: 15000
    });
  const branch = String(branchResult.stdout || "").trim();
  if (!branchResult.ok || !branch) {
    return hardStopStage({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A named branch is available for pushing the setup checkpoint.",
      observed: branchResult.output || "No current branch.",
      explanation: "Studio cannot push a baseline from a detached or unnamed branch."
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(context?.originUrl || "");
  if (!repoSlug) {
    return hardStopStage({
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
    timeout: 20000
  });
  const remoteSha = remoteHead.stdout.trim();
  if (!remoteHead.ok || !remoteSha) {
    return blockedStage({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD is present on origin/${branch}.`,
      observed: remoteHead.output || `origin/${branch} is missing.`,
      explanation: "The setup checkpoint exists locally but has not been published to the GitHub remote yet.",
      repair: gitCheckpointRepair()
    });
  }

  if (remoteSha !== localHead.stdout) {
    return blockedStage({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD matches origin/${branch}.`,
      observed: `Local HEAD: ${localHead.stdout}\norigin/${branch}: ${remoteSha}`,
      explanation: "Push the setup checkpoint to origin. If Git rejects the push, reconcile the remote branch manually before continuing.",
      repair: gitCheckpointRepair()
    });
  }

  return passStage({
    id: "git-checkpoint",
    label: "Git checkpoint",
    expected: "Working tree is clean and the checkpoint commit is pushed to origin.",
    observed: `Clean\nHEAD ${localHead.stdout} matches origin/${branch}.`,
    explanation: "Setup changes are committed locally and published as the baseline remote branch."
  });
}

function readyStage() {
  return passStage({
    id: "ready",
    label: "Ready",
    expected: "The target app is ready for Studio workflows.",
    observed: "All setup stages passed.",
    explanation: "Studio can now inspect and operate on this app."
  });
}

async function inspectAppSetup({
  emit = null,
  targetRoot
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || process.cwd()));
  const context = {};
  const stages = [];

  const checks = [
    {
      id: "directory",
      label: "Directory admissibility",
      run: () => checkDirectory(resolvedTargetRoot, context)
    },
    {
      id: "git-ready",
      label: "Git ready",
      run: () => checkGitReady(resolvedTargetRoot, context)
    },
    {
      id: "remote-ready",
      label: "Remote ready",
      run: () => checkRemoteReady(resolvedTargetRoot, context)
    },
    {
      id: "remote-sync",
      label: "Remote/local sync",
      run: () => checkRemoteSync(resolvedTargetRoot, context)
    },
    {
      id: "scaffold",
      label: "Initial JSKIT scaffold",
      run: () => checkScaffold(resolvedTargetRoot, context)
    },
    {
      id: "dependencies",
      label: "Dependencies runnable",
      run: () => checkDependencies(resolvedTargetRoot, context)
    },
    {
      id: "runtime-services",
      label: "Runtime services",
      run: () => checkRuntimeServices(resolvedTargetRoot, context)
    },
    {
      id: "jskit-doctor",
      label: "JSKIT doctor",
      run: () => checkJskitDoctor(resolvedTargetRoot)
    },
    {
      id: "git-checkpoint",
      label: "Git checkpoint",
      run: () => checkGitCheckpoint(resolvedTargetRoot, context)
    }
  ];

  for (let index = 0; index < checks.length; index += 1) {
    const result = await runAppSetupStep(emit, checks[index]);
    stages.push(result);
    if (result.status !== "pass") {
      return finalizeStatus({
        context,
        stages: appendPending(stages, index + 1),
        targetRoot: resolvedTargetRoot
      });
    }
  }

  stages.push(readyStage());
  return finalizeStatus({
    context,
    stages,
    targetRoot: resolvedTargetRoot
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
  const script = shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=/workspace init",
    "git -c safe.directory=/workspace branch -M main"
  ]);
  const args = buildTerminalArgs(["bash", "-lc", script], {
    extraArgs: writableHostUserDockerArgs(),
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
  const args = buildTerminalArgs(["bash", "-lc", ghRepoCreateScript(repoNameFromTargetRoot(targetRoot))], {
    extraArgs: ["-e", "GH_PROMPT_DISABLED=1"],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

function startLinkRemoteTerminal(targetRoot, inputs) {
  const validation = validateGithubRemoteInput(inputs);
  if (!validation.ok) {
    return {
      error: validation.error,
      ok: false
    };
  }
  const script = shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=/workspace remote add origin \"$JSKIT_REMOTE_URL\"",
    "git -c safe.directory=/workspace remote get-url origin"
  ]);
  const args = buildTerminalArgs(["bash", "-lc", script], {
    extraArgs: [
      ...writableHostUserDockerArgs(),
      "-e",
      `JSKIT_REMOTE_URL=${validation.url}`
    ],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: `git remote add origin ${shellQuote(validation.url)}`,
    targetRoot
  });
}

function startScaffoldTerminal(targetRoot) {
  const repair = scaffoldRepair(targetRoot);
  const repoName = repoNameFromTargetRoot(targetRoot);
  const script = shellScript([
    "set -e",
    "set -x",
    "npx @jskit-ai/create-app \"$JSKIT_APP_NAME\" --target . --force --tenancy-mode none --title \"$JSKIT_APP_TITLE\" --initial-bundles none"
  ]);
  const args = buildTerminalArgs(["bash", "-lc", script], {
    extraArgs: [
      ...writableHostUserDockerArgs(),
      "-e",
      `JSKIT_APP_NAME=${repoName}`,
      "-e",
      `JSKIT_APP_TITLE=${titleFromRepoName(repoName)}`
    ],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

function startNpmInstallTerminal(targetRoot) {
  const repair = npmInstallRepair(targetRoot);
  const args = buildTerminalArgs(["bash", "-lc", npmInstallScript()], {
    extraArgs: writableHostUserDockerArgs(),
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

function startCreateDatabaseTerminal(targetRoot, inputs = {}) {
  const validation = validateDatabaseName(inputs.databaseName);
  if (!validation.ok) {
    return {
      error: "A valid databaseName input is required.",
      ok: false
    };
  }
  const repair = mysqlCreateDatabaseRepair(validation.databaseName);
  const escaped = escapeMysqlIdentifier(validation.databaseName);
  const args = [
    "exec",
    "-it",
    MYSQL_CONTAINER,
    "mysql",
    "-uroot",
    `-p${MYSQL_ROOT_PASSWORD}`,
    "-e",
    `CREATE DATABASE IF NOT EXISTS \`${escaped}\`; SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${validation.databaseName}';`
  ];
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

function startJskitDoctorTerminal(targetRoot) {
  const repair = jskitDoctorRepair(targetRoot);
  const args = buildTerminalArgs(["bash", "-lc", jskitDoctorScript()], {
    extraArgs: writableHostUserDockerArgs(),
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview,
    targetRoot
  });
}

function startGitCheckpointTerminal(targetRoot, inputs = {}) {
  const validation = validateCommitMessage(inputs.commitMessage);
  if (!validation.ok) {
    return {
      error: validation.error,
      ok: false
    };
  }
  const repair = gitCheckpointRepair();
  const script = gitCheckpointScript();
  const args = buildTerminalArgs(["bash", "-lc", script], {
    extraArgs: [
      ...hostUserIdentityEnvArgs(),
      "-e",
      "GH_PROMPT_DISABLED=1",
      "-e",
      `JSKIT_COMMIT_MESSAGE=${validation.commitMessage}`
    ],
    targetRoot
  });
  return startDockerTerminal({
    args,
    commandPreview: repair.commandPreview.replace("<commitMessage>", validation.commitMessage),
    targetRoot
  });
}

function createService({
  targetRoot
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || process.cwd()));
  const readyStatusCache = createReadyStatusCache();

  return Object.freeze({
    getStatus() {
      const cachedStatus = readyStatusCache.read();
      if (cachedStatus) {
        return cachedStatus;
      }
      return readyStatusCache.remember(inspectAppSetup({
        targetRoot: resolvedTargetRoot
      }));
    },

    streamStatus({ emit } = {}) {
      return readyStatusCache.remember(inspectAppSetup({
        emit,
        targetRoot: resolvedTargetRoot
      }));
    },

    startTerminal({
      actionId,
      inputs = {}
    } = {}) {
      if (actionId === "terminal-git-init") {
        return startGitInitTerminal(resolvedTargetRoot);
      }
      if (actionId === "terminal-gh-create-repo") {
        return startGhCreateRepoTerminal(resolvedTargetRoot);
      }
      if (actionId === "terminal-link-github-remote") {
        return startLinkRemoteTerminal(resolvedTargetRoot, inputs);
      }
      if (actionId === "terminal-scaffold-jskit") {
        return startScaffoldTerminal(resolvedTargetRoot);
      }
      if (actionId === "terminal-npm-install") {
        return startNpmInstallTerminal(resolvedTargetRoot);
      }
      if (actionId === "terminal-create-app-db") {
        return startCreateDatabaseTerminal(resolvedTargetRoot, inputs);
      }
      if (actionId === "terminal-jskit-doctor") {
        return startJskitDoctorTerminal(resolvedTargetRoot);
      }
      if (actionId === "terminal-git-checkpoint") {
        return startGitCheckpointTerminal(resolvedTargetRoot, inputs);
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
  configImportProblems,
  configImportSpecifiersFromText,
  createService,
  directDependencyNames,
  doctorIssueLines,
  gitCheckpointScript,
  githubBranchRefApiPath,
  ghRepoCreateScript,
  inspectAppSetup,
  missingDirectDependencies,
  npmInstallScript,
  onlyUiVerificationDoctorIssues
};
