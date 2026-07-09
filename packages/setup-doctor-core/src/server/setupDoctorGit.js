import path from "node:path";
import process from "node:process";

import {
  createDoctorRepair as createRepair
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  buildDoctorTerminalArgs
} from "./doctorHostCommand.js";
import {
  runDoctorGh as runGh,
  runDoctorGit as runGit
} from "./doctorHostCommands.js";
import {
  buildGithubRepoCreateOrLinkScript
} from "./githubRepoSetupScript.js";
import {
  isGithubRemoteUrl,
  repoSlugFromRemoteUrl
} from "./githubRemote.js";
import {
  gitIdentityEnv,
  gitIdentityReadiness,
  runVibe64Command,
  shellQuote
} from "@local/vibe64-execution/server";
import {
  shellScript
} from "@local/studio-terminal-core/server/shellScript";
import {
  VIBE64_SOURCE_CONTRACT_ROOT_ENTRIES,
  VIBE64_SOURCE_CONTRACT_VIBE64_DIRS
} from "@local/vibe64-core/server/projectManifest";

const GIT_INIT_ACTION_ID = "terminal-git-init";
const GH_CREATE_REPO_ACTION_ID = "terminal-gh-create-repo";
const LINK_GITHUB_REMOTE_ACTION_ID = "terminal-link-github-remote";
const GIT_IDENTITY_ACTION_ID = "terminal-git-identity";
const MIRROR_REMOTE_BRANCH_ACTION_ID = "terminal-mirror-remote-branch";
const CREATE_GIT_CHECKPOINT_ACTION_ID = "terminal-git-checkpoint";
const PUSH_GIT_CHECKPOINT_ACTION_ID = "terminal-git-push-checkpoint";
const DEFAULT_CHECKPOINT_COMMIT_MESSAGE = "Initial project setup";
const VIBE64_SOURCE_BOOTSTRAP_ENTRIES = VIBE64_SOURCE_CONTRACT_ROOT_ENTRIES;
const VIBE64_SOURCE_BOOTSTRAP_VIBE64_DIRS = VIBE64_SOURCE_CONTRACT_VIBE64_DIRS;
const VIBE64_REMOTE_MIRROR_ALLOWED_BOOTSTRAP_ENTRIES = VIBE64_SOURCE_BOOTSTRAP_ENTRIES;
const VIBE64_REMOTE_MIRROR_ALLOWED_BOOTSTRAP_VIBE64_DIRS = VIBE64_SOURCE_BOOTSTRAP_VIBE64_DIRS;

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "vibe64-target")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "vibe64-target";
}

function setupDoctorTerminalArgs(commandArgs, {
  githubToolHomeSource = "",
  targetRoot,
  toolHomeSource = ""
} = {}) {
  return buildDoctorTerminalArgs(commandArgs, {
    githubToolHomeSource,
    targetRoot,
    toolHomeSource
  });
}

function commandPreviewFromArgs(args = []) {
  return Array.isArray(args) ? args.map(shellQuote).join(" ") : "";
}

function setupDoctorTerminalCredentialRequest({
  githubToolHomeSource = "",
  toolHomeSource = "",
  userKey = ""
} = {}) {
  const home = String(toolHomeSource || githubToolHomeSource || "").trim();
  if (!home) {
    return {
      actor: "app",
      credentialHome: {},
      userKey: ""
    };
  }
  const username = String(userKey || path.basename(home) || "").trim();
  return {
    actor: homeRequiresRealUser(home) && username ? "owner-user" : "app",
    credentialHome: {
      home,
      username
    },
    userKey: username
  };
}

function homeRequiresRealUser(home = "") {
  const normalizedHome = String(home || "").trim();
  return normalizedHome === "/home" || normalizedHome.startsWith("/home/");
}

function terminalEnvWithoutHome(env = {}) {
  const clean = env && typeof env === "object" && !Array.isArray(env)
    ? {
        ...env
      }
    : {};
  delete clean.HOME;
  return clean;
}

function terminalProject(targetRoot = "") {
  return {
    targetRoot: String(targetRoot || "").trim()
  };
}

function terminalRequestEnv(env = {}) {
  return terminalEnvWithoutHome(env);
}

function terminalHelperPayloadRoot({
  env = {},
  targetRoot = ""
} = {}) {
  return String(env.VIBE64_SYSTEM_ROOT || process.env.VIBE64_SYSTEM_ROOT || targetRoot || "").trim();
}

function setupDoctorGitIdentityEnv(env = {}) {
  return gitIdentityEnv({
    env: {
      ...process.env,
      ...env
    }
  });
}

function readGitIdentityReadiness(options = {}) {
  return gitIdentityReadiness(options);
}

function gitInitScript() {
  return shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=\"$PWD\" init",
    "git -c safe.directory=\"$PWD\" branch -M main"
  ]);
}

function gitInitTerminalArgs(targetRoot) {
  return setupDoctorTerminalArgs(["bash", "-lc", gitInitScript()], {
    targetRoot
  });
}

function gitInitRepair() {
  return createRepair({
    actionId: GIT_INIT_ACTION_ID,
    autoRun: true,
    command: gitInitScript(),
    label: "Initialize Git"
  });
}

function ghRepoCreateScript(repoName) {
  return buildGithubRepoCreateOrLinkScript(repoName);
}

function ghRepoCreateTerminalArgs(targetRoot, {
  githubToolHomeSource = "",
  toolHomeSource = ""
} = {}) {
  return setupDoctorTerminalArgs(["bash", "-lc", ghRepoCreateScript(repoNameFromTargetRoot(targetRoot))], {
    githubToolHomeSource,
    targetRoot,
    toolHomeSource
  });
}

function ghRepoCreateRepair(targetRoot) {
  return createRepair({
    actionId: GH_CREATE_REPO_ACTION_ID,
    autoRun: true,
    command: ghRepoCreateScript(repoNameFromTargetRoot(targetRoot)),
    label: "Create/link GitHub repo"
  });
}

function linkGithubRemoteRepair() {
  return createRepair({
    actionId: LINK_GITHUB_REMOTE_ACTION_ID,
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

function mirrorRemoteBranchCommandPreview(branch = "<branch>") {
  const branchName = String(branch || "<branch>");
  const remoteRef = `refs/remotes/origin/${branchName}`;
  return [
    `git fetch origin refs/heads/${branchName}:${remoteRef}`,
    "rm -f .gitignore",
    `git reset --hard ${remoteRef}`
  ].join("\n");
}

function shellCaseEntryPattern(entries = []) {
  return entries.map((entry) => String(entry)).join("|");
}

function mirrorRemoteBranchScript() {
  const allowedEntryCasePattern = shellCaseEntryPattern([
    ".git",
    ".vibe64",
    ...VIBE64_REMOTE_MIRROR_ALLOWED_BOOTSTRAP_ENTRIES
  ]);
  const allowedVibe64EntryCasePattern = shellCaseEntryPattern([
    ...VIBE64_REMOTE_MIRROR_ALLOWED_BOOTSTRAP_VIBE64_DIRS
  ]);
  return shellScript([
    "set -e",
    "set -x",
    ": \"${VIBE64_REMOTE_BRANCH:?VIBE64_REMOTE_BRANCH is required}\"",
    "set +x",
    "set -x",
    "git -c safe.directory=\"$PWD\" check-ref-format --branch \"$VIBE64_REMOTE_BRANCH\" >/dev/null",
    "if git -c safe.directory=\"$PWD\" rev-parse --verify HEAD >/dev/null 2>&1; then echo 'Local commits exist; refusing to mirror remote into a non-empty local history.'; exit 1; fi",
    "unexpected_entries=\"\"",
    `for entry in .[!.]* ..?* *; do [ -e "$entry" ] || continue; case "$entry" in ${allowedEntryCasePattern}) ;; *) unexpected_entries="$unexpected_entries\${unexpected_entries:+ }$entry" ;; esac; done`,
    `if [ -e .vibe64 ]; then if [ ! -d .vibe64 ]; then unexpected_entries="$unexpected_entries\${unexpected_entries:+ }.vibe64"; else for entry in .vibe64/.[!.]* .vibe64/..?* .vibe64/*; do [ -e "$entry" ] || continue; child="\${entry##*/}"; case "$child" in ${allowedVibe64EntryCasePattern}) ;; *) unexpected_entries="$unexpected_entries\${unexpected_entries:+ }.vibe64/$child" ;; esac; done; fi; fi`,
    "if [ -n \"$unexpected_entries\" ]; then printf 'Refusing to mirror remote over existing local files:\\n%s\\n' \"$unexpected_entries\"; exit 1; fi",
    "remote_ref=\"refs/remotes/origin/$VIBE64_REMOTE_BRANCH\"",
    "timeout 120s git -c safe.directory=\"$PWD\" fetch origin \"refs/heads/$VIBE64_REMOTE_BRANCH:$remote_ref\"",
    "git -c safe.directory=\"$PWD\" rev-parse --verify \"$remote_ref^{commit}\"",
    "rm -f .gitignore",
    "git -c safe.directory=\"$PWD\" reset --hard \"$remote_ref\"",
    "git -c safe.directory=\"$PWD\" branch -M \"$VIBE64_REMOTE_BRANCH\"",
    "git -c safe.directory=\"$PWD\" status --short"
  ]);
}

function mirrorRemoteBranchRepair(branch = "") {
  return createRepair({
    actionId: MIRROR_REMOTE_BRANCH_ACTION_ID,
    autoRun: true,
    command: mirrorRemoteBranchCommandPreview(branch),
    input: {
      branch
    },
    label: "Mirror existing remote"
  });
}

function gitIdentityRepair() {
  return createRepair({
    actionId: GIT_IDENTITY_ACTION_ID,
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

function gitCheckpointScript() {
  return shellScript([
    "set -e",
    "set -x",
    "set +x",
    "set -x",
    "git -c safe.directory=\"$PWD\" status --short",
    "if ! git -c safe.directory=\"$PWD\" rev-parse --verify HEAD >/dev/null 2>&1; then if [ \"${VIBE64_CHECKPOINT_ALLOW_CREATE:-0}\" != \"1\" ]; then echo 'No local commit exists to push.'; exit 1; fi; if [ -z \"$(git -c safe.directory=\"$PWD\" status --porcelain=v1)\" ]; then echo 'No files to checkpoint and no commits exist.'; exit 1; fi; git -c safe.directory=\"$PWD\" add .; git -c safe.directory=\"$PWD\" commit -m \"$VIBE64_COMMIT_MESSAGE\"; fi",
    "branch=\"$(git -c safe.directory=\"$PWD\" branch --show-current)\"",
    "if [ -z \"$branch\" ]; then echo 'No current branch.'; exit 1; fi",
    "remote_ref=\"refs/heads/$branch\"",
    "printf '[studio] Publishing checkpoint to origin/%s\\n' \"$branch\"",
    "git -c safe.directory=\"$PWD\" push -u origin \"HEAD:$remote_ref\"",
    "git -c safe.directory=\"$PWD\" status --short",
    "git -c safe.directory=\"$PWD\" ls-remote origin \"refs/heads/$branch\""
  ]);
}

function localGitCheckpointScript() {
  return shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=\"$PWD\" status --short",
    "if ! git -c safe.directory=\"$PWD\" rev-parse --verify HEAD >/dev/null 2>&1; then if [ \"${VIBE64_CHECKPOINT_ALLOW_CREATE:-0}\" != \"1\" ]; then echo 'No local commit exists.'; exit 1; fi; if [ -z \"$(git -c safe.directory=\"$PWD\" status --porcelain=v1)\" ]; then echo 'No files to checkpoint and no commits exist.'; exit 1; fi; git -c safe.directory=\"$PWD\" add .; git -c safe.directory=\"$PWD\" commit -m \"$VIBE64_COMMIT_MESSAGE\"; fi",
    "branch=\"$(git -c safe.directory=\"$PWD\" branch --show-current)\"",
    "if [ -z \"$branch\" ]; then echo 'No current branch.'; exit 1; fi",
    "git -c safe.directory=\"$PWD\" status --short",
    "git -c safe.directory=\"$PWD\" rev-parse --verify HEAD"
  ]);
}

function gitCheckpointCommandPreview({
  commitMessage = "<commitMessage>",
  includeInitialCommit = true
} = {}) {
  const commands = ["git status --short"];
  if (includeInitialCommit) {
    commands.push(
      "git add .",
      `git commit -m "${commitMessage}"`
    );
  }
  commands.push(
    "branch=\"$(git branch --show-current)\"",
    "git push -u origin \"HEAD:refs/heads/$branch\""
  );
  return commands.join("\n");
}

function localGitCheckpointCommandPreview({
  commitMessage = "<commitMessage>",
  includeInitialCommit = true
} = {}) {
  const commands = ["git status --short"];
  if (includeInitialCommit) {
    commands.push(
      "git add .",
      `git commit -m "${commitMessage}"`
    );
  }
  commands.push(
    "git branch --show-current",
    "git rev-parse --verify HEAD"
  );
  return commands.join("\n");
}

function gitCheckpointRepair({
  includeInitialCommit = true
} = {}) {
  return createRepair({
    actionId: includeInitialCommit ? CREATE_GIT_CHECKPOINT_ACTION_ID : PUSH_GIT_CHECKPOINT_ACTION_ID,
    autoRun: true,
    command: gitCheckpointCommandPreview({
      includeInitialCommit
    }),
    fields: includeInitialCommit ? [
      {
        defaultValue: DEFAULT_CHECKPOINT_COMMIT_MESSAGE,
        id: "commitMessage",
        label: "Commit message",
        required: true,
        type: "text"
      }
    ] : [],
    label: includeInitialCommit ? "Create and push checkpoint" : "Push checkpoint"
  });
}

function localGitCheckpointRepair({
  includeInitialCommit = true
} = {}) {
  return createRepair({
    actionId: CREATE_GIT_CHECKPOINT_ACTION_ID,
    autoRun: true,
    command: localGitCheckpointCommandPreview({
      includeInitialCommit
    }),
    fields: includeInitialCommit ? [
      {
        defaultValue: DEFAULT_CHECKPOINT_COMMIT_MESSAGE,
        id: "commitMessage",
        label: "Commit message",
        required: true,
        type: "text"
      }
    ] : [],
    label: includeInitialCommit ? "Create local checkpoint" : "Verify local checkpoint"
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

function githubBranchRefApiPath(repoSlug, branch) {
  const branchPath = String(branch || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `repos/${repoSlug}/git/ref/heads/${branchPath}`;
}

async function startSetupDoctorHostTerminal({
  args,
  commandPreview,
  env = {},
  gitTransport = "none",
  githubToolHomeSource = "",
  namespace,
  targetRoot,
  toolHomeSource = "",
  userKey = ""
}) {
  const [command, ...commandArgs] = Array.isArray(args) ? args.map(String) : [];
  const credentialRequest = setupDoctorTerminalCredentialRequest({
    githubToolHomeSource,
    toolHomeSource,
    userKey
  });
  return runVibe64Command({
    ...credentialRequest,
    allowedRoots: [
      targetRoot
    ].filter(Boolean),
    args: commandArgs,
    command,
    cwd: targetRoot,
    env: terminalRequestEnv(env),
    envPolicy: "project",
    gitTransport,
    mode: "pty",
    project: terminalProject(targetRoot),
    purpose: "setup",
    runtimes: ["git", "gh"],
    terminal: {
      commandPreview: commandPreview || commandPreviewFromArgs(args),
      helperPayloadRoot: terminalHelperPayloadRoot({
        env,
        targetRoot
      }),
      namespace
    }
  });
}

function startGitInitTerminal({
  env = {},
  namespace,
  targetRoot
} = {}) {
  return startSetupDoctorHostTerminal({
    args: gitInitTerminalArgs(targetRoot),
    commandPreview: gitInitRepair(targetRoot).commandPreview,
    env,
    namespace,
    targetRoot
  });
}

function startGhCreateRepoTerminal({
  env = {},
  githubToolHomeSource = "",
  namespace,
  targetRoot,
  toolHomeSource = "",
  userKey = ""
} = {}) {
  return startSetupDoctorHostTerminal({
    args: ghRepoCreateTerminalArgs(targetRoot, {
      githubToolHomeSource,
      toolHomeSource
    }),
    commandPreview: ghRepoCreateRepair(targetRoot, {
      githubToolHomeSource,
      toolHomeSource
    }).commandPreview,
    env: {
      ...env,
      GH_PROMPT_DISABLED: "1"
    },
    githubToolHomeSource,
    gitTransport: "github-https",
    namespace,
    targetRoot,
    toolHomeSource,
    userKey
  });
}

function startLinkGithubRemoteTerminal({
  env = {},
  input = {},
  namespace,
  targetRoot
} = {}) {
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
    "git -c safe.directory=\"$PWD\" remote add origin \"$VIBE64_REMOTE_URL\"",
    "git -c safe.directory=\"$PWD\" remote get-url origin"
  ]);
  const args = setupDoctorTerminalArgs(["bash", "-lc", script], {
    targetRoot
  });
  return startSetupDoctorHostTerminal({
    args,
    commandPreview: `git remote add origin ${shellQuote(validation.url)}`,
    env: {
      ...env,
      VIBE64_REMOTE_URL: validation.url
    },
    namespace,
    targetRoot
  });
}

function startGitIdentityTerminal({
  env = {},
  githubToolHomeSource = "",
  inputs = {},
  namespace,
  targetRoot,
  toolHomeSource = "",
  userKey = ""
} = {}) {
  const inputValidation = validateGitIdentityInputs(inputs);
  if (!inputValidation.ok) {
    return {
      error: inputValidation.error,
      ok: false
    };
  }

  const script = shellScript([
    "set -e",
    "set -x",
    "git config --global user.name \"$VIBE64_GIT_USER_NAME\"",
    "git config --global user.email \"$VIBE64_GIT_USER_EMAIL\"",
    "git config --global --get user.name",
    "git config --global --get user.email"
  ]);
  const args = setupDoctorTerminalArgs(["bash", "-lc", script], {
    githubToolHomeSource,
    targetRoot,
    toolHomeSource
  });
  return startSetupDoctorHostTerminal({
    args,
    commandPreview: commandPreviewFromArgs(args),
    env: {
      ...env,
      VIBE64_GIT_USER_EMAIL: inputValidation.email,
      VIBE64_GIT_USER_NAME: inputValidation.name
    },
    githubToolHomeSource,
    namespace,
    targetRoot,
    toolHomeSource,
    userKey
  });
}

function startMirrorRemoteBranchTerminal({
  env = {},
  githubToolHomeSource = "",
  input = {},
  namespace,
  targetRoot,
  toolHomeSource = "",
  userKey = ""
} = {}) {
  const branch = String(input.branch || "").trim();
  if (!branch) {
    return {
      error: "Remote branch is required.",
      ok: false
    };
  }
  const args = setupDoctorTerminalArgs(["bash", "-lc", mirrorRemoteBranchScript()], {
    githubToolHomeSource,
    targetRoot,
    toolHomeSource
  });
  return startSetupDoctorHostTerminal({
    args,
    commandPreview: mirrorRemoteBranchCommandPreview(branch),
    env: {
      ...env,
      GH_PROMPT_DISABLED: "1",
      VIBE64_REMOTE_BRANCH: branch
    },
    githubToolHomeSource,
    gitTransport: "github-https",
    namespace,
    targetRoot,
    toolHomeSource,
    userKey
  });
}

function startGitCheckpointTerminal({
  allowCreate = true,
  env = {},
  githubToolHomeSource = "",
  input = {},
  namespace,
  targetRoot,
  toolHomeSource = "",
  userKey = ""
} = {}) {
  const commitMessage = allowCreate
    ? validateCommitMessage(input.commitMessage)
    : {
        commitMessage: DEFAULT_CHECKPOINT_COMMIT_MESSAGE,
        ok: true
      };
  if (!commitMessage.ok) {
    return {
      error: commitMessage.error,
      ok: false
    };
  }
  const args = setupDoctorTerminalArgs(["bash", "-lc", gitCheckpointScript()], {
    githubToolHomeSource,
    targetRoot,
    toolHomeSource
  });
  return startSetupDoctorHostTerminal({
    args,
    commandPreview: gitCheckpointCommandPreview({
      commitMessage: commitMessage.commitMessage,
      includeInitialCommit: allowCreate
    }),
    env: {
      ...env,
      ...setupDoctorGitIdentityEnv(env),
      GH_PROMPT_DISABLED: "1",
      VIBE64_CHECKPOINT_ALLOW_CREATE: allowCreate ? "1" : "0",
      VIBE64_COMMIT_MESSAGE: commitMessage.commitMessage
    },
    githubToolHomeSource,
    gitTransport: "github-https",
    namespace,
    targetRoot,
    toolHomeSource,
    userKey
  });
}

function startLocalGitCheckpointTerminal({
  allowCreate = true,
  env = {},
  input = {},
  namespace,
  targetRoot
} = {}) {
  const commitMessage = allowCreate
    ? validateCommitMessage(input.commitMessage)
    : {
        commitMessage: DEFAULT_CHECKPOINT_COMMIT_MESSAGE,
        ok: true
      };
  if (!commitMessage.ok) {
    return {
      error: commitMessage.error,
      ok: false
    };
  }
  const args = setupDoctorTerminalArgs(["bash", "-lc", localGitCheckpointScript()], {
    targetRoot
  });
  return startSetupDoctorHostTerminal({
    args,
    commandPreview: localGitCheckpointCommandPreview({
      commitMessage: commitMessage.commitMessage,
      includeInitialCommit: allowCreate
    }),
    env: {
      ...env,
      ...setupDoctorGitIdentityEnv(env),
      VIBE64_CHECKPOINT_ALLOW_CREATE: allowCreate ? "1" : "0",
      VIBE64_COMMIT_MESSAGE: commitMessage.commitMessage
    },
    namespace,
    targetRoot
  });
}

async function readGitInsideWorkTree(targetRoot) {
  return runGit(targetRoot, ["rev-parse", "--is-inside-work-tree"]);
}

async function readGitRepositoryShape(targetRoot) {
  const [inside, bare, branch] = await Promise.all([
    readGitInsideWorkTree(targetRoot),
    runGit(targetRoot, ["rev-parse", "--is-bare-repository"]),
    runGit(targetRoot, ["branch", "--show-current"])
  ]);
  return {
    bare,
    branch,
    inside
  };
}

async function readGitStatus(targetRoot) {
  return runGit(targetRoot, ["status", "--porcelain=v1"], {
    timeout: 15_000
  });
}

async function readGitBranch(targetRoot) {
  return runGit(targetRoot, ["branch", "--show-current"]);
}

async function readGitIdentity(targetRoot, {
  githubToolHomeSource = "",
  toolHomeSource = ""
} = {}) {
  const [nameResult, emailResult] = await Promise.all([
    runGit(targetRoot, ["config", "--get", "user.name"], {
      githubToolHomeSource,
      toolHomeSource
    }),
    runGit(targetRoot, ["config", "--get", "user.email"], {
      githubToolHomeSource,
      toolHomeSource
    })
  ]);
  return {
    emailResult,
    nameResult
  };
}

async function readGitLocalHead(targetRoot) {
  return runGit(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
}

async function readGitOriginRemote(targetRoot) {
  return runGit(targetRoot, ["remote", "get-url", "origin"]);
}

async function readGithubRepository(targetRoot, remoteUrl, {
  githubToolHomeSource = "",
  jsonFields = "nameWithOwner,url,defaultBranchRef",
  toolHomeSource = "",
  timeout = 20_000
} = {}) {
  const repoSlug = repoSlugFromRemoteUrl(remoteUrl);
  if (!repoSlug) {
    return {
      ok: false,
      output: "origin is not a GitHub remote.",
      repoInfo: null,
      repoSlug
    };
  }

  const result = await runGh(targetRoot, [
    "repo",
    "view",
    repoSlug,
    "--json",
    jsonFields
  ], {
    githubToolHomeSource,
    toolHomeSource,
    timeout
  });
  if (!result.ok) {
    return {
      ...result,
      repoInfo: null,
      repoSlug
    };
  }

  try {
    return {
      ...result,
      repoInfo: JSON.parse(result.stdout),
      repoSlug
    };
  } catch (error) {
    return {
      ok: false,
      output: String(error?.message || error),
      repoInfo: null,
      repoSlug,
      stderr: String(error?.message || error),
      stdout: result.stdout
    };
  }
}

async function readGithubRepositorySummary(targetRoot, remoteUrl, {
  githubToolHomeSource = "",
  toolHomeSource = ""
} = {}) {
  const repoSlug = repoSlugFromRemoteUrl(remoteUrl);
  if (!repoSlug) {
    return {
      ok: false,
      output: "Target GitHub repository is unknown.",
      repoSlug,
      stdout: ""
    };
  }
  const result = await runGh(targetRoot, [
    "repo",
    "view",
    repoSlug,
    "--json",
    "nameWithOwner,url",
    "--jq",
    ".nameWithOwner + \" \" + .url"
  ], {
    githubToolHomeSource,
    toolHomeSource
  });
  return {
    ...result,
    repoSlug
  };
}

async function githubIssueAndPrAccess(targetRoot, repoSlug, {
  githubToolHomeSource = "",
  toolHomeSource = ""
} = {}) {
  if (!repoSlug) {
    return {
      ok: false,
      output: "Target GitHub repository is unknown."
    };
  }
  const [issueResult, prResult] = await Promise.all([
    runGh(targetRoot, ["issue", "list", "--repo", repoSlug, "--limit", "1"], {
      githubToolHomeSource,
      toolHomeSource
    }),
    runGh(targetRoot, ["pr", "list", "--repo", repoSlug, "--limit", "1"], {
      githubToolHomeSource,
      toolHomeSource
    })
  ]);
  return {
    issueResult,
    ok: issueResult.ok && prResult.ok,
    output: [issueResult.output, prResult.output].filter(Boolean).join("\n"),
    prResult
  };
}

async function remoteHeadIsAncestorOfLocalHead(targetRoot, remoteSha) {
  const result = await runGit(targetRoot, ["merge-base", "--is-ancestor", remoteSha, "HEAD"], {
    timeout: 15_000
  });
  return result.ok;
}

async function readRemoteBranchShaWithGit(targetRoot, branch, {
  githubToolHomeSource = "",
  toolHomeSource = ""
} = {}) {
  const result = await runGit(targetRoot, ["ls-remote", "origin", `refs/heads/${branch}`], {
    githubToolHomeSource,
    toolHomeSource,
    timeout: 20_000
  });
  return {
    ...result,
    sha: result.stdout.split(/\s+/u)[0] || ""
  };
}

async function readRemoteBranchShaWithGh(targetRoot, repoSlug, branch, {
  githubToolHomeSource = "",
  toolHomeSource = ""
} = {}) {
  const result = await runGh(targetRoot, [
    "api",
    githubBranchRefApiPath(repoSlug, branch),
    "--jq",
    ".object.sha"
  ], {
    githubToolHomeSource,
    toolHomeSource,
    timeout: 20_000
  });
  return normalizeRemoteBranchShaWithGhResult(result, {
    branch,
    repoSlug
  });
}

function ghBranchRefLookupHasNoSha(output = "") {
  const text = String(output || "");
  return /Git Repository is empty/u.test(text)
    || /\(HTTP 404\)/u.test(text);
}

function normalizeRemoteBranchShaWithGhResult(result = {}, {
  branch = "",
  repoSlug = ""
} = {}) {
  const sha = String(result.stdout || "").trim();
  if (result.ok || !ghBranchRefLookupHasNoSha(result.output)) {
    return {
      ...result,
      sha
    };
  }

  const branchLabel = branch ? `refs/heads/${branch}` : "the requested branch";
  const repoLabel = repoSlug ? `${repoSlug} ` : "";
  return {
    ...result,
    ok: true,
    output: `GitHub repository ${repoLabel}does not have ${branchLabel} yet.`,
    sha: ""
  };
}

export {
  VIBE64_REMOTE_MIRROR_ALLOWED_BOOTSTRAP_ENTRIES,
  VIBE64_REMOTE_MIRROR_ALLOWED_BOOTSTRAP_VIBE64_DIRS,
  VIBE64_SOURCE_BOOTSTRAP_ENTRIES,
  VIBE64_SOURCE_BOOTSTRAP_VIBE64_DIRS,
  CREATE_GIT_CHECKPOINT_ACTION_ID,
  DEFAULT_CHECKPOINT_COMMIT_MESSAGE,
  GH_CREATE_REPO_ACTION_ID,
  GIT_IDENTITY_ACTION_ID,
  GIT_INIT_ACTION_ID,
  LINK_GITHUB_REMOTE_ACTION_ID,
  MIRROR_REMOTE_BRANCH_ACTION_ID,
  PUSH_GIT_CHECKPOINT_ACTION_ID,
  ghRepoCreateRepair,
  ghRepoCreateScript,
  ghRepoCreateTerminalArgs,
  gitCheckpointCommandPreview,
  gitCheckpointRepair,
  gitCheckpointScript,
  gitIdentityRepair,
  gitInitRepair,
  gitInitScript,
  githubBranchRefApiPath,
  githubIssueAndPrAccess,
  linkGithubRemoteRepair,
  localGitCheckpointCommandPreview,
  localGitCheckpointRepair,
  localGitCheckpointScript,
  mirrorRemoteBranchCommandPreview,
  mirrorRemoteBranchRepair,
  mirrorRemoteBranchScript,
  normalizeRemoteBranchShaWithGhResult,
  readGitBranch,
  readGitIdentity,
  readGitIdentityReadiness,
  readGitInsideWorkTree,
  readGitLocalHead,
  readGitOriginRemote,
  readGitRepositoryShape,
  readGitStatus,
  readGithubRepository,
  readGithubRepositorySummary,
  readRemoteBranchShaWithGh,
  readRemoteBranchShaWithGit,
  remoteHeadIsAncestorOfLocalHead,
  repoNameFromTargetRoot,
  setupDoctorTerminalArgs,
  startGhCreateRepoTerminal,
  startGitCheckpointTerminal,
  startGitIdentityTerminal,
  startGitInitTerminal,
  startLinkGithubRemoteTerminal,
  startLocalGitCheckpointTerminal,
  startMirrorRemoteBranchTerminal,
  validateCommitMessage,
  validateGitIdentityInputs,
  validateGithubRemoteInput
};
