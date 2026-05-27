import path from "node:path";

import {
  createDoctorRepair as createRepair
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  buildDoctorTerminalArgs
} from "./doctorToolchain.js";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  runDoctorGh as runGh,
  runDoctorGit as runGit
} from "./doctorToolchainCommands.js";
import {
  buildGithubRepoCreateOrLinkScript
} from "./githubRepoSetupScript.js";
import {
  isGithubRemoteUrl,
  repoSlugFromRemoteUrl
} from "./githubRemote.js";
import {
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  shellScript
} from "@local/studio-terminal-core/server/shellScript";
import {
  startTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";

const GIT_INIT_ACTION_ID = "terminal-git-init";
const GH_CREATE_REPO_ACTION_ID = "terminal-gh-create-repo";
const LINK_GITHUB_REMOTE_ACTION_ID = "terminal-link-github-remote";
const GIT_IDENTITY_ACTION_ID = "terminal-git-identity";
const ADD_VIBE64_GITIGNORE_RULES_ACTION_ID = "terminal-add-vibe64-gitignore-rules";
const MIRROR_REMOTE_BRANCH_ACTION_ID = "terminal-mirror-remote-branch";
const CREATE_GIT_CHECKPOINT_ACTION_ID = "terminal-git-checkpoint";
const PUSH_GIT_CHECKPOINT_ACTION_ID = "terminal-git-push-checkpoint";
const DEFAULT_CHECKPOINT_COMMIT_MESSAGE = "Initial project setup";
const VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS = Object.freeze([
  ".vibe64/sessions/",
  ".vibe64/runtime/"
]);

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "vibe64-target")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "vibe64-target";
}

function hostWritableWorkspaceDockerArgs() {
  return [
    ...hostUserDockerArgs(),
    "-e",
    "HOME=/tmp/studio-home"
  ];
}

function setupDoctorTerminalArgs(commandArgs, {
  extraArgs = [],
  targetRoot
} = {}) {
  return buildDoctorTerminalArgs(commandArgs, {
    extraArgs,
    targetRoot
  });
}

function gitInitScript() {
  return shellScript([
    "set -e",
    "set -x",
    "git -c safe.directory=/workspace init",
    "git -c safe.directory=/workspace branch -M main"
  ]);
}

function gitInitTerminalArgs(targetRoot, {
  extraArgs = hostUserDockerArgs()
} = {}) {
  return setupDoctorTerminalArgs(["bash", "-lc", gitInitScript()], {
    extraArgs,
    targetRoot
  });
}

function gitInitRepair(targetRoot, options = {}) {
  return createRepair({
    actionId: GIT_INIT_ACTION_ID,
    autoRun: true,
    command: dockerCommand(gitInitTerminalArgs(targetRoot, options)),
    label: "Initialize Git"
  });
}

function ghRepoCreateScript(repoName) {
  return buildGithubRepoCreateOrLinkScript(repoName);
}

function ghRepoCreateTerminalArgs(targetRoot, {
  extraArgs = ["-e", "GH_PROMPT_DISABLED=1"]
} = {}) {
  return setupDoctorTerminalArgs(["bash", "-lc", ghRepoCreateScript(repoNameFromTargetRoot(targetRoot))], {
    extraArgs,
    targetRoot
  });
}

function ghRepoCreateRepair(targetRoot, options = {}) {
  return createRepair({
    actionId: GH_CREATE_REPO_ACTION_ID,
    autoRun: true,
    command: dockerCommand(ghRepoCreateTerminalArgs(targetRoot, options)),
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

function mirrorRemoteBranchScript() {
  return shellScript([
    "set -e",
    "set -x",
    ": \"${VIBE64_REMOTE_BRANCH:?VIBE64_REMOTE_BRANCH is required}\"",
    "set +x",
    "export GIT_PASSWORD=\"$(gh auth token)\"",
    "printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '*Username*) printf \"%s\\\\n\" \"x-access-token\" ;;' '*) printf \"%s\\\\n\" \"$GIT_PASSWORD\" ;;' 'esac' > /tmp/vibe64-git-askpass",
    "chmod 700 /tmp/vibe64-git-askpass",
    "export GIT_ASKPASS=/tmp/vibe64-git-askpass",
    "export GIT_TERMINAL_PROMPT=0",
    "set -x",
    "git -c safe.directory=/workspace check-ref-format --branch \"$VIBE64_REMOTE_BRANCH\" >/dev/null",
    "if git -c safe.directory=/workspace rev-parse --verify HEAD >/dev/null 2>&1; then echo 'Local commits exist; refusing to mirror remote into a non-empty local history.'; exit 1; fi",
    "unexpected_entries=\"\"",
    "for entry in .[!.]* ..?* *; do [ -e \"$entry\" ] || continue; case \"$entry\" in .git|.gitignore|.vibe64) ;; *) unexpected_entries=\"$unexpected_entries${unexpected_entries:+ }$entry\" ;; esac; done",
    "if [ -n \"$unexpected_entries\" ]; then printf 'Refusing to mirror remote over existing local files:\\n%s\\n' \"$unexpected_entries\"; exit 1; fi",
    "remote_ref=\"refs/remotes/origin/$VIBE64_REMOTE_BRANCH\"",
    "timeout 120s git -c safe.directory=/workspace -c credential.helper= fetch origin \"refs/heads/$VIBE64_REMOTE_BRANCH:$remote_ref\"",
    "git -c safe.directory=/workspace rev-parse --verify \"$remote_ref^{commit}\"",
    "rm -f .gitignore",
    "git -c safe.directory=/workspace reset --hard \"$remote_ref\"",
    "git -c safe.directory=/workspace branch -M \"$VIBE64_REMOTE_BRANCH\"",
    "git -c safe.directory=/workspace status --short"
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

function addVibe64GitignoreRulesCommandPreview() {
  return [
    "touch .gitignore",
    ...VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.map((pattern) => {
      return `grep -qxF ${shellQuote(pattern)} .gitignore || printf '%s\\n' ${shellQuote(pattern)} >> .gitignore`;
    })
  ].join("\n");
}

function addVibe64GitignoreRulesScript() {
  return shellScript([
    "set -e",
    "set -x",
    "touch .gitignore",
    ...VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.map((pattern) => {
      return `grep -qxF ${shellQuote(pattern)} .gitignore || printf '%s\\n' ${shellQuote(pattern)} >> .gitignore`;
    }),
    "cat .gitignore"
  ]);
}

function addVibe64GitignoreRulesRepair() {
  return createRepair({
    actionId: ADD_VIBE64_GITIGNORE_RULES_ACTION_ID,
    autoRun: true,
    command: addVibe64GitignoreRulesCommandPreview(),
    label: "Add Vibe64 ignore rules"
  });
}

function gitCheckpointScript() {
  return shellScript([
    "set -e",
    "set -x",
    ": \"${VIBE64_HOST_UID:=0}\"",
    ": \"${VIBE64_HOST_GID:=0}\"",
    "as_host() { if [ \"$(id -u)\" = \"0\" ] && command -v setpriv >/dev/null 2>&1; then setpriv --reuid \"$VIBE64_HOST_UID\" --regid \"$VIBE64_HOST_GID\" --clear-groups \"$@\"; else \"$@\"; fi; }",
    "set +x",
    "export GIT_PASSWORD=\"$(gh auth token)\"",
    "printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '*Username*) printf \"%s\\\\n\" \"x-access-token\" ;;' '*) printf \"%s\\\\n\" \"$GIT_PASSWORD\" ;;' 'esac' > /tmp/vibe64-git-askpass",
    "if [ \"$(id -u)\" = \"0\" ]; then chown \"$VIBE64_HOST_UID:$VIBE64_HOST_GID\" /tmp/vibe64-git-askpass; fi",
    "chmod 700 /tmp/vibe64-git-askpass",
    "export GIT_ASKPASS=/tmp/vibe64-git-askpass",
    "export GIT_TERMINAL_PROMPT=0",
    "set -x",
    "as_host git -c safe.directory=/workspace status --short",
    "if ! as_host git -c safe.directory=/workspace rev-parse --verify HEAD >/dev/null 2>&1; then if [ \"${VIBE64_CHECKPOINT_ALLOW_CREATE:-0}\" != \"1\" ]; then echo 'No local commit exists to push.'; exit 1; fi; if [ -z \"$(as_host git -c safe.directory=/workspace status --porcelain=v1)\" ]; then echo 'No files to checkpoint and no commits exist.'; exit 1; fi; as_host git -c safe.directory=/workspace add .; as_host git -c safe.directory=/workspace commit -m \"$VIBE64_COMMIT_MESSAGE\"; fi",
    "branch=\"$(as_host git -c safe.directory=/workspace branch --show-current)\"",
    "if [ -z \"$branch\" ]; then echo 'No current branch.'; exit 1; fi",
    "remote_ref=\"refs/heads/$branch\"",
    "printf '[studio] Publishing checkpoint to origin/%s\\n' \"$branch\"",
    "as_host git -c safe.directory=/workspace -c credential.helper= push -u origin \"HEAD:$remote_ref\"",
    "as_host git -c safe.directory=/workspace status --short",
    "as_host git -c safe.directory=/workspace -c credential.helper= ls-remote origin \"refs/heads/$branch\""
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

async function startSetupDoctorDockerTerminal({
  args,
  commandPreview,
  env = {},
  namespace,
  targetRoot
}) {
  if (targetRoot) {
    await ensureTargetRuntimeNetwork(targetRoot);
  }
  return startTerminalSession({
    args,
    command: "docker",
    commandPreview,
    cwd: targetRoot,
    env,
    namespace
  });
}

function startGitInitTerminal({
  env = {},
  extraArgs = hostUserDockerArgs(),
  namespace,
  targetRoot
} = {}) {
  return startSetupDoctorDockerTerminal({
    args: gitInitTerminalArgs(targetRoot, {
      extraArgs
    }),
    commandPreview: gitInitRepair(targetRoot, {
      extraArgs
    }).commandPreview,
    env,
    namespace,
    targetRoot
  });
}

function startGhCreateRepoTerminal({
  env = {},
  namespace,
  targetRoot
} = {}) {
  return startSetupDoctorDockerTerminal({
    args: ghRepoCreateTerminalArgs(targetRoot),
    commandPreview: ghRepoCreateRepair(targetRoot).commandPreview,
    env,
    namespace,
    targetRoot
  });
}

function startLinkGithubRemoteTerminal({
  env = {},
  extraArgs = hostWritableWorkspaceDockerArgs(),
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
    "git -c safe.directory=/workspace remote add origin \"$VIBE64_REMOTE_URL\"",
    "git -c safe.directory=/workspace remote get-url origin"
  ]);
  const args = setupDoctorTerminalArgs(["bash", "-lc", script], {
    extraArgs: [
      ...extraArgs,
      "-e",
      `VIBE64_REMOTE_URL=${validation.url}`
    ],
    targetRoot
  });
  return startSetupDoctorDockerTerminal({
    args,
    commandPreview: `git remote add origin ${shellQuote(validation.url)}`,
    env,
    namespace,
    targetRoot
  });
}

function startGitIdentityTerminal({
  inputs = {},
  namespace,
  targetRoot
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
    extraArgs: [
      "-e",
      `VIBE64_GIT_USER_NAME=${inputValidation.name}`,
      "-e",
      `VIBE64_GIT_USER_EMAIL=${inputValidation.email}`
    ],
    targetRoot
  });
  return startSetupDoctorDockerTerminal({
    args,
    commandPreview: dockerCommand(args),
    namespace,
    targetRoot
  });
}

function startAddVibe64GitignoreRulesTerminal({
  env = {},
  extraArgs = hostWritableWorkspaceDockerArgs(),
  namespace,
  targetRoot
} = {}) {
  const args = setupDoctorTerminalArgs(["bash", "-lc", addVibe64GitignoreRulesScript()], {
    extraArgs,
    targetRoot
  });
  return startSetupDoctorDockerTerminal({
    args,
    commandPreview: addVibe64GitignoreRulesCommandPreview(),
    env,
    namespace,
    targetRoot
  });
}

function startMirrorRemoteBranchTerminal({
  env = {},
  extraArgs = ["-e", "GH_PROMPT_DISABLED=1"],
  input = {},
  namespace,
  targetRoot
} = {}) {
  const branch = String(input.branch || "").trim();
  if (!branch) {
    return {
      error: "Remote branch is required.",
      ok: false
    };
  }
  const args = setupDoctorTerminalArgs(["bash", "-lc", mirrorRemoteBranchScript()], {
    extraArgs: [
      ...extraArgs,
      "-e",
      `VIBE64_REMOTE_BRANCH=${branch}`
    ],
    targetRoot
  });
  return startSetupDoctorDockerTerminal({
    args,
    commandPreview: mirrorRemoteBranchCommandPreview(branch),
    env,
    namespace,
    targetRoot
  });
}

function startGitCheckpointTerminal({
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
  const args = setupDoctorTerminalArgs(["bash", "-lc", gitCheckpointScript()], {
    extraArgs: [
      ...hostUserIdentityEnvArgs(),
      "-e",
      "GH_PROMPT_DISABLED=1",
      "-e",
      `VIBE64_CHECKPOINT_ALLOW_CREATE=${allowCreate ? "1" : "0"}`,
      "-e",
      `VIBE64_COMMIT_MESSAGE=${commitMessage.commitMessage}`
    ],
    targetRoot
  });
  return startSetupDoctorDockerTerminal({
    args,
    commandPreview: gitCheckpointCommandPreview({
      commitMessage: commitMessage.commitMessage,
      includeInitialCommit: allowCreate
    }),
    env,
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

async function readGitIdentity(targetRoot) {
  const [nameResult, emailResult] = await Promise.all([
    runGit(targetRoot, ["config", "--get", "user.name"]),
    runGit(targetRoot, ["config", "--get", "user.email"])
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
  jsonFields = "nameWithOwner,url,defaultBranchRef",
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

async function readGithubRepositorySummary(targetRoot, remoteUrl) {
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
  ]);
  return {
    ...result,
    repoSlug
  };
}

async function githubIssueAndPrAccess(targetRoot, repoSlug) {
  if (!repoSlug) {
    return {
      ok: false,
      output: "Target GitHub repository is unknown."
    };
  }
  const [issueResult, prResult] = await Promise.all([
    runGh(targetRoot, ["issue", "list", "--repo", repoSlug, "--limit", "1"]),
    runGh(targetRoot, ["pr", "list", "--repo", repoSlug, "--limit", "1"])
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

async function readRemoteBranchShaWithGit(targetRoot, branch) {
  const result = await runGit(targetRoot, ["ls-remote", "origin", `refs/heads/${branch}`], {
    timeout: 20_000
  });
  return {
    ...result,
    sha: result.stdout.split(/\s+/u)[0] || ""
  };
}

async function readRemoteBranchShaWithGh(targetRoot, repoSlug, branch) {
  const result = await runGh(targetRoot, [
    "api",
    githubBranchRefApiPath(repoSlug, branch),
    "--jq",
    ".object.sha"
  ], {
    timeout: 20_000
  });
  return {
    ...result,
    sha: result.stdout.trim()
  };
}

export {
  ADD_VIBE64_GITIGNORE_RULES_ACTION_ID,
  VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS,
  CREATE_GIT_CHECKPOINT_ACTION_ID,
  DEFAULT_CHECKPOINT_COMMIT_MESSAGE,
  GH_CREATE_REPO_ACTION_ID,
  GIT_IDENTITY_ACTION_ID,
  GIT_INIT_ACTION_ID,
  LINK_GITHUB_REMOTE_ACTION_ID,
  MIRROR_REMOTE_BRANCH_ACTION_ID,
  PUSH_GIT_CHECKPOINT_ACTION_ID,
  addVibe64GitignoreRulesCommandPreview,
  addVibe64GitignoreRulesRepair,
  addVibe64GitignoreRulesScript,
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
  hostWritableWorkspaceDockerArgs,
  linkGithubRemoteRepair,
  mirrorRemoteBranchCommandPreview,
  mirrorRemoteBranchRepair,
  mirrorRemoteBranchScript,
  readGitBranch,
  readGitIdentity,
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
  startAddVibe64GitignoreRulesTerminal,
  startGhCreateRepoTerminal,
  startGitCheckpointTerminal,
  startGitIdentityTerminal,
  startGitInitTerminal,
  startLinkGithubRemoteTerminal,
  startMirrorRemoteBranchTerminal,
  validateCommitMessage,
  validateGitIdentityInputs,
  validateGithubRemoteInput
};
