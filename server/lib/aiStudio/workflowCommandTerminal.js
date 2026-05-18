import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  shellQuote
} from "../shellCommands.js";
import {
  artifactFilePath,
  metadataFilePath,
  recordCommandFactScript,
  requiredArtifactScript,
} from "./workflowCommandFacts.js";
import {
  normalizeText,
  pathExists
} from "./core.js";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 30_000;
const GIT_OUTPUT_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_INSTALL_COMMAND = "NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_YES=true npm_config_audit=false npm_config_fund=false npm_config_yes=true npm install --foreground-scripts --no-audit --no-fund";
const DEFAULT_AUTOMATED_CHECK_COMMAND = "npm run build";

function commandOutput(error = {}) {
  return normalizeText(`${error.stdout || ""}\n${error.stderr || ""}`) ||
    normalizeText(error.message);
}

async function gitOutput(cwd, args, {
  timeout = GIT_COMMAND_TIMEOUT_MS
} = {}) {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
    timeout
  });
  return normalizeText(result.stdout);
}

async function gitResult(cwd, args, {
  timeout = GIT_COMMAND_TIMEOUT_MS
} = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
      timeout
    });
    return {
      ok: true,
      output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`)
    };
  } catch (error) {
    return {
      ok: false,
      output: commandOutput(error)
    };
  }
}

async function gitCommandSucceeds(cwd, args) {
  const result = await gitResult(cwd, args);
  return result.ok;
}

async function readCurrentBranch(targetRoot) {
  return gitOutput(targetRoot, ["branch", "--show-current"], {
    timeout: 15_000
  });
}

async function readCurrentCommit(targetRoot) {
  return gitOutput(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
}

async function isGitWorktree(worktreePath) {
  if (!await pathExists(worktreePath)) {
    return false;
  }
  return gitCommandSucceeds(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
}

function completedMetadataSpec({
  applySuccessFacts = null,
  commandPreview = "",
  cwd = "",
  label = "",
  metadata = {},
  script = ""
} = {}) {
  return {
    args: ["-lc", script],
    command: "bash",
    commandPreview,
    cwd,
    ok: true,
    ...(typeof applySuccessFacts === "function" ? { applySuccessFacts } : {}),
    successMessage: `${label} completed.`,
    successMetadata: metadata
  };
}

async function worktreeCommandSpec({
  applySuccessFacts = null,
  commandPreview = "",
  label = "",
  metadata = {},
  script = "",
  session = {}
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running this command."
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      ok: false,
      message: `Session worktree is not ready: ${worktreePath}`
    };
  }
  return completedMetadataSpec({
    commandPreview,
    cwd: worktreePath,
    label,
    metadata,
    applySuccessFacts,
    script
  });
}

function commandMetadataResult({
  deleteMetadata = [],
  metadata = {}
} = {}) {
  return {
    deleteMetadata,
    metadata
  };
}

function metadataFromFacts(facts = {}, names = []) {
  return Object.fromEntries(names
    .map((name) => [name, normalizeText(facts[name])])
    .filter(([, value]) => Boolean(value)));
}

function worktreeMetadata({
  baseBranch = "",
  baseCommit = "",
  branch = "",
  worktreePath = ""
} = {}) {
  return {
    base_branch: baseBranch,
    base_commit: baseCommit,
    branch,
    worktree_path: worktreePath
  };
}

function createWorktreeSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  if (normalizeText(session.metadata?.work_source) !== "existing_pr") {
    return commandMetadataResult();
  }

  const updateMode = normalizeText(facts.source_pr_update_mode);
  if (updateMode === "direct") {
    return commandMetadataResult({
      metadata: {
        pr_source: "existing",
        pr_url: normalizeText(facts.pr_url) || normalizeText(session.metadata?.source_pr_url),
        source_pr_update_mode: "direct"
      }
    });
  }

  if (updateMode === "replacement") {
    return commandMetadataResult({
      deleteMetadata: ["pr_url"],
      metadata: {
        source_pr_update_mode: "replacement"
      }
    });
  }

  return commandMetadataResult();
}

function commitChangesSuccessMetadataFromFacts({ facts = {} } = {}) {
  return commandMetadataResult({
    metadata: metadataFromFacts(facts, [
      "accepted_commit",
      "branch_pushed"
    ])
  });
}

function createIssueSuccessMetadataFromFacts({ facts = {} } = {}) {
  const metadata = metadataFromFacts(facts, [
    "issue_number",
    "issue_title",
    "issue_url"
  ]);
  if (!metadata.issue_url) {
    return commandMetadataResult();
  }
  return commandMetadataResult({
    metadata: {
      issue_source: "created",
      ...metadata
    }
  });
}

function createPrSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  const metadata = metadataFromFacts(facts, ["pr_url"]);
  if (!metadata.pr_url) {
    return commandMetadataResult();
  }
  return commandMetadataResult({
    metadata: {
      ...metadata,
      pr_source: normalizeText(session.metadata?.source_pr_url) ? "replacement" : "created"
    }
  });
}

function createWorktreePath(session = {}) {
  return session.sessionRoot ? path.join(session.sessionRoot, "worktree") : "";
}

function createWorktreeBranch(session = {}) {
  return `ai-studio/${session.sessionId}`;
}

function createWorktreeScript({
  branch = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const quotedBranch = shellQuote(branch);
  const quotedBranchRef = shellQuote(`refs/heads/${branch}`);
  const quotedTargetRoot = shellQuote(targetRoot);
  const quotedWorktreePath = shellQuote(worktreePath);
  const workSource = normalizeText(session.metadata?.work_source) || "new_branch";
  const sourcePrNumber = normalizeText(session.metadata?.source_pr_number);
  const sourcePrHeadRef = normalizeText(session.metadata?.source_pr_head_ref);
  const sourcePrHeadRepo = normalizeText(session.metadata?.source_pr_head_repo);
  const sourcePrUrl = normalizeText(session.metadata?.source_pr_url);
  const requestedUpdateMode = normalizeText(session.metadata?.source_pr_update_mode);
  return [
    "set -e",
    `printf '[studio] Preparing worktree %s\\n' ${quotedWorktreePath}`,
    `mkdir -p "$(dirname ${quotedWorktreePath})"`,
    `if [ -e ${quotedWorktreePath} ]; then`,
    `  if git -C ${quotedWorktreePath} rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    "    printf '[studio] Reusing existing worktree.\\n'",
    "    exit 0",
    "  fi",
    `  if [ -d ${quotedWorktreePath} ] && [ -z "$(find ${quotedWorktreePath} -mindepth 1 -maxdepth 1 -print -quit)" ]; then`,
    `    rmdir ${quotedWorktreePath}`,
    "  else",
    "    printf '[studio] Worktree path exists but is not a Git worktree.\\n' >&2",
    "    exit 1",
    "  fi",
    "fi",
    ...(workSource === "existing_pr" ? [
      `SOURCE_PR_NUMBER=${shellQuote(sourcePrNumber)}`,
      `SOURCE_PR_HEAD_REF=${shellQuote(sourcePrHeadRef)}`,
      `SOURCE_PR_HEAD_REPO=${shellQuote(sourcePrHeadRepo)}`,
      `SOURCE_PR_URL=${shellQuote(sourcePrUrl)}`,
      `REQUESTED_UPDATE_MODE=${shellQuote(requestedUpdateMode)}`,
      "if [ -z \"$SOURCE_PR_NUMBER\" ]; then",
      "  printf '[studio] Existing PR metadata is incomplete. Abandon this session and start again.\\n' >&2",
      "  exit 1",
      "fi",
      "PR_FETCH_REF=\"refs/remotes/ai-studio/pr/$SOURCE_PR_NUMBER\"",
      "printf '[studio] Fetching PR #%s\\n' \"$SOURCE_PR_NUMBER\"",
      `git -C ${quotedTargetRoot} fetch origin "pull/$SOURCE_PR_NUMBER/head:$PR_FETCH_REF"`,
      `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
      `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
      "else",
      `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} "$PR_FETCH_REF"`,
      "fi",
      "if [ \"$REQUESTED_UPDATE_MODE\" = \"direct\" ]; then",
      "  if [ -z \"$SOURCE_PR_HEAD_REF\" ] || [ -z \"$SOURCE_PR_HEAD_REPO\" ]; then",
      "    printf '[studio] Existing PR push target is incomplete; this session will create a replacement PR.\\n'",
      `    ${recordCommandFactScript("source_pr_update_mode", "replacement")}`,
      "    exit 0",
      "  fi",
      "  PR_HEAD_REMOTE=\"ai-studio-pr-head\"",
      `  git -C ${quotedWorktreePath} remote remove "$PR_HEAD_REMOTE" >/dev/null 2>&1 || true`,
      `  git -C ${quotedWorktreePath} remote add "$PR_HEAD_REMOTE" "https://github.com/$SOURCE_PR_HEAD_REPO.git"`,
      `  if git -C ${quotedWorktreePath} push --dry-run "$PR_HEAD_REMOTE" "HEAD:refs/heads/$SOURCE_PR_HEAD_REF"; then`,
      "    printf '[studio] Existing PR can be updated directly.\\n'",
      `    ${recordCommandFactScript("source_pr_update_mode", "direct")}`,
      `    ${recordCommandFactScript("pr_url", "\"$SOURCE_PR_URL\"")}`,
      "  else",
      "    printf '[studio] Existing PR cannot be pushed directly; this session will create a replacement PR.\\n'",
      `    ${recordCommandFactScript("source_pr_update_mode", "replacement")}`,
      "  fi",
      "fi",
      "exit 0"
    ] : []),
    `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
    `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
    "else",
    `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} HEAD`,
    "fi"
  ].join("\n");
}

async function createWorktreeTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  const worktreePath = normalizeText(session.metadata?.worktree_path) || createWorktreePath(session);
  const branch = normalizeText(session.metadata?.branch) || createWorktreeBranch(session);
  if (!worktreePath || !branch) {
    return {
      ok: false,
      message: "Cannot create a worktree before the AI Studio session has a root path."
    };
  }
  const [baseBranch, baseCommit] = await Promise.all([
    readCurrentBranch(resolvedTargetRoot),
    readCurrentCommit(resolvedTargetRoot)
  ]);
  const workSource = normalizeText(session.metadata?.work_source) || "new_branch";
  const metadataBaseBranch = workSource === "existing_pr"
    ? normalizeText(session.metadata?.source_pr_base_ref) || baseBranch
    : baseBranch;
  const metadataBaseCommit = workSource === "existing_pr"
    ? normalizeText(session.metadata?.source_pr_head_sha) || baseCommit
    : baseCommit;
  return {
    args: ["-lc", createWorktreeScript({
      branch,
      session,
      targetRoot: resolvedTargetRoot,
      worktreePath
    })],
    command: "bash",
    commandPreview: `git worktree add ${worktreePath}`,
    cwd: resolvedTargetRoot,
    ok: true,
    applySuccessFacts: createWorktreeSuccessMetadataFromFacts,
    successMessage: `Created worktree ${worktreePath} on branch ${branch}.`,
    successMetadata: worktreeMetadata({
      baseBranch: metadataBaseBranch,
      baseCommit: metadataBaseCommit,
      branch,
      worktreePath
    })
  };
}

function normalizeMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata || {}).map(([key, value]) => [
    normalizeText(key),
    normalizeText(value)
  ]));
}

function commandScript(command = "", {
  intro = ""
} = {}) {
  const normalizedCommand = normalizeText(command);
  return [
    "set -e",
    intro ? `printf '[studio] ${intro}\\n'` : "",
    `printf '[studio] $ %s\\n\\n' ${shellQuote(normalizedCommand)}`,
    normalizedCommand
  ].filter(Boolean).join("\n");
}

function normalizeHookCommandResult(result = {}, fallback = {}) {
  if (typeof result === "string") {
    return normalizeHookCommandResult({
      command: result
    }, fallback);
  }
  const command = normalizeText(result.command || fallback.command);
  const script = normalizeText(result.script) || commandScript(command, {
    intro: result.intro || fallback.intro
  });
  return {
    command,
    commandPreview: normalizeText(result.commandPreview || fallback.commandPreview || command),
    metadata: normalizeMetadata({
      ...(fallback.metadata || {}),
      ...(result.metadata || {})
    }),
    script
  };
}

async function resolveHookCommand({
  fallback = {},
  hookContext = {},
  hookName = "",
  hooks = {}
} = {}) {
  const hook = hooks?.[hookName];
  const result = typeof hook === "function" ? await hook(hookContext) : {};
  return normalizeHookCommandResult(result, fallback);
}

async function installDependenciesTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before installing dependencies."
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      ok: false,
      message: `Session worktree is not ready: ${worktreePath}`
    };
  }
  const command = await resolveHookCommand({
    fallback: {
      command: DEFAULT_INSTALL_COMMAND,
      commandPreview: "npm install --foreground-scripts --no-audit --no-fund",
      intro: `Installing dependencies in ${worktreePath}`,
      metadata: {
        dependencies_installed: "yes",
        dependencies_path: worktreePath
      }
    },
    hookContext: {
      context,
      session,
      targetRoot,
      worktreePath
    },
    hookName: "installDependencies",
    hooks
  });
  return {
    args: ["-lc", command.script],
    command: "bash",
    commandPreview: command.commandPreview,
    cwd: worktreePath,
    ok: true,
    successMessage: `Installed dependencies in ${worktreePath}.`,
    successMetadata: {
      dependencies_installed: "yes",
      dependencies_path: worktreePath,
      ...command.metadata
    }
  };
}

function commitChangesScript(session = {}) {
  const issueTitlePath = metadataFilePath(session, "issue_title");
  const directExistingPr = normalizeText(session.metadata?.work_source) === "existing_pr" &&
    normalizeText(session.metadata?.source_pr_update_mode) === "direct";
  const baseBranch = normalizeText(session.metadata?.base_branch) ||
    normalizeText(session.metadata?.source_pr_base_ref) ||
    "main";
  const sourcePrHeadRef = normalizeText(session.metadata?.source_pr_head_ref);
  const sourcePrHeadRepo = normalizeText(session.metadata?.source_pr_head_repo);
  return [
    "set -e",
    `COMMIT_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="AI Studio session ${session.sessionId}"`,
    "fi",
    "if [ -n \"$(git status --short)\" ]; then",
    "  printf '[studio] Committing changes: %s\\n' \"$COMMIT_TITLE\"",
    "  git add -A",
    "  git commit -m \"$COMMIT_TITLE\"",
    "else",
    "  printf '[studio] No working tree changes to commit; checking existing branch commits.\\n'",
    "fi",
    "CURRENT_BRANCH=\"$(git branch --show-current)\"",
    "if [ -z \"$CURRENT_BRANCH\" ]; then",
    "  printf '[studio] Cannot push from a detached HEAD.\\n' >&2",
    "  exit 1",
    "fi",
    `BASE_BRANCH=${shellQuote(baseBranch)}`,
    "git fetch origin \"$BASE_BRANCH\"",
    "BASE_REF=\"origin/$BASE_BRANCH\"",
    "COMMITS_AHEAD=\"$(git rev-list --count \"$BASE_REF\"..HEAD)\"",
    "if [ \"$COMMITS_AHEAD\" = \"0\" ]; then",
    "  printf '[studio] No commits exist between %s and %s. Nothing to push.\\n' \"$BASE_REF\" \"$CURRENT_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    ...(directExistingPr ? [
      `SOURCE_PR_HEAD_REF=${shellQuote(sourcePrHeadRef)}`,
      `SOURCE_PR_HEAD_REPO=${shellQuote(sourcePrHeadRepo)}`,
      "if [ -z \"$SOURCE_PR_HEAD_REF\" ] || [ -z \"$SOURCE_PR_HEAD_REPO\" ]; then",
      "  printf '[studio] Existing PR push target is missing.\\n' >&2",
      "  exit 1",
      "fi",
      "PR_HEAD_REMOTE=\"ai-studio-pr-head\"",
      "git remote remove \"$PR_HEAD_REMOTE\" >/dev/null 2>&1 || true",
      "git remote add \"$PR_HEAD_REMOTE\" \"https://github.com/$SOURCE_PR_HEAD_REPO.git\"",
      "printf '[studio] Pushing changes to existing PR branch %s/%s\\n' \"$SOURCE_PR_HEAD_REPO\" \"$SOURCE_PR_HEAD_REF\"",
      "git push \"$PR_HEAD_REMOTE\" \"HEAD:refs/heads/$SOURCE_PR_HEAD_REF\"",
      recordCommandFactScript("branch_pushed", "\"$SOURCE_PR_HEAD_REF\"")
    ] : [
      "printf '[studio] Pushing branch %s\\n' \"$CURRENT_BRANCH\"",
      "git push -u origin \"$CURRENT_BRANCH\"",
      recordCommandFactScript("branch_pushed", "\"$CURRENT_BRANCH\"")
    ]),
    recordCommandFactScript("accepted_commit", "\"$ACCEPTED_COMMIT\""),
    "printf '[studio] Committed %s\\n' \"$ACCEPTED_COMMIT\""
  ].join("\n");
}

async function commitChangesTerminalSpec({ session = {} } = {}) {
  return worktreeCommandSpec({
    applySuccessFacts: commitChangesSuccessMetadataFromFacts,
    commandPreview: "git add -A && git commit && git push",
    label: "Commit and push changes",
    script: commitChangesScript(session),
    session
  });
}

async function runAutomatedChecksTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  const command = await resolveHookCommand({
    fallback: {
      command: DEFAULT_AUTOMATED_CHECK_COMMAND,
      commandPreview: DEFAULT_AUTOMATED_CHECK_COMMAND,
      intro: "Running automated checks.",
      metadata: {
        automated_checks_passed: "yes"
      }
    },
    hookContext: {
      context,
      session,
      targetRoot,
      worktreePath
    },
    hookName: "automatedChecks",
    hooks
  });
  return worktreeCommandSpec({
    commandPreview: command.commandPreview,
    label: "Run automated checks",
    metadata: {
      automated_checks_passed: "yes",
      ...command.metadata
    },
    script: command.script,
    session
  });
}

function createIssueOnGhScript(session = {}) {
  const issueTitlePath = artifactFilePath(session, "issue_title");
  const issueBodyPath = artifactFilePath(session, "issue.md");
  return [
    "set -e",
    requiredArtifactScript(session, "issue_title", "issue title artifact"),
    requiredArtifactScript(session, "issue.md", "issue body artifact"),
    `ISSUE_TITLE="$(head -n 1 ${shellQuote(issueTitlePath)} | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$ISSUE_TITLE\" ]; then",
    "  printf '[studio] Issue title is empty.\\n' >&2",
    "  exit 1",
    "fi",
    "printf '[studio] Creating GitHub issue: %s\\n' \"$ISSUE_TITLE\"",
    `ISSUE_URL="$(gh issue create --title "$ISSUE_TITLE" --body-file ${shellQuote(issueBodyPath)})"`,
    "printf '%s\\n' \"$ISSUE_URL\"",
    recordCommandFactScript("issue_url", "\"$ISSUE_URL\""),
    recordCommandFactScript("issue_title", "\"$ISSUE_TITLE\""),
    "ISSUE_NUMBER=\"$(printf '%s\\n' \"$ISSUE_URL\" | sed -n 's#.*/issues/\\([0-9][0-9]*\\).*#\\1#p' | head -n 1)\"",
    "if [ -n \"$ISSUE_NUMBER\" ]; then",
    `  ${recordCommandFactScript("issue_number", "\"$ISSUE_NUMBER\"")}`,
    "fi"
  ].join("\n");
}

function createPrOnGhScript(session = {}) {
  const prBodyPath = artifactFilePath(session, "pull_request.md");
  const issueTitlePath = metadataFilePath(session, "issue_title");
  const sourcePrUrl = normalizeText(session.metadata?.source_pr_url);
  const branch = normalizeText(session.metadata?.branch);
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  const quotedBaseBranch = shellQuote(baseBranch);
  const quotedBranch = shellQuote(branch);
  return [
    "set -e",
    requiredArtifactScript(session, "pull_request.md", "pull request artifact"),
    `PR_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$PR_TITLE\" ]; then",
    `  PR_TITLE="$(grep -m 1 -v '^[[:space:]]*$' ${shellQuote(prBodyPath)} | sed 's/^#*[[:space:]]*//' | sed 's/[[:space:]]*$//')"`,
    "fi",
    "if [ -z \"$PR_TITLE\" ]; then",
    `  PR_TITLE="AI Studio session ${session.sessionId}"`,
    "fi",
    `EXPECTED_BRANCH=${quotedBranch}`,
    `BASE_BRANCH=${quotedBaseBranch}`,
    "CURRENT_BRANCH=\"$(git branch --show-current)\"",
    "if [ \"$CURRENT_BRANCH\" != \"$EXPECTED_BRANCH\" ]; then",
    "  printf '[studio] Worktree is on branch %s, expected %s.\\n' \"$CURRENT_BRANCH\" \"$EXPECTED_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "git fetch origin \"$BASE_BRANCH\"",
    "BASE_REF=\"origin/$BASE_BRANCH\"",
    "if ! git rev-parse --verify \"$BASE_REF\" >/dev/null 2>&1; then",
    "  printf '[studio] Cannot resolve base branch %s.\\n' \"$BASE_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "COMMITS_AHEAD=\"$(git rev-list --count \"$BASE_REF\"..HEAD)\"",
    "if [ \"$COMMITS_AHEAD\" = \"0\" ]; then",
    "  printf '[studio] No commits exist between %s and %s. Commit and push changes before creating the pull request.\\n' \"$BASE_REF\" \"$EXPECTED_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "if ! git ls-remote --exit-code --heads origin \"$EXPECTED_BRANCH\" >/dev/null 2>&1; then",
    "  printf '[studio] Branch %s is not pushed to origin. Run Commit and push changes before creating the pull request.\\n' \"$EXPECTED_BRANCH\" >&2",
    "  exit 1",
    "fi",
    `SOURCE_PR_URL=${shellQuote(sourcePrUrl)}`,
    "PR_BODY_FILE=" + shellQuote(prBodyPath),
    "if [ -n \"$SOURCE_PR_URL\" ]; then",
    "  PR_BODY_FILE=\"$(mktemp)\"",
    `  cat ${shellQuote(prBodyPath)} > "$PR_BODY_FILE"`,
    "  printf '\\n\\nContinues existing pull request: %s\\n' \"$SOURCE_PR_URL\" >> \"$PR_BODY_FILE\"",
    "fi",
    "printf '[studio] Creating GitHub pull request: %s\\n' \"$PR_TITLE\"",
    `PR_URL="$(gh pr create --base ${quotedBaseBranch} --head ${quotedBranch} --title "$PR_TITLE" --body-file "$PR_BODY_FILE")"`,
    "printf '%s\\n' \"$PR_URL\"",
    recordCommandFactScript("pr_url", "\"$PR_URL\"")
  ].join("\n");
}

function mergePrScript({
  beforeMergeScript = "",
  mergeMethod = "merge",
  session = {}
} = {}) {
  const prUrl = normalizeText(session.metadata?.pr_url);
  const mergeFlag = {
    merge: "--merge",
    rebase: "--rebase",
    squash: "--squash"
  }[normalizeText(mergeMethod)] || "--merge";
  return [
    "set -e",
    beforeMergeScript,
    `printf '[studio] Merging pull request %s\\n' ${shellQuote(prUrl)}`,
    `gh pr merge ${shellQuote(prUrl)} ${mergeFlag}`
  ].filter(Boolean).join("\n");
}

function syncMainCheckoutScript(session = {}, targetRoot = "") {
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  return [
    "set -e",
    `printf '[studio] Syncing main checkout %s to %s\\n' ${shellQuote(targetRoot)} ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} fetch origin ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} checkout ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} pull --ff-only origin ${shellQuote(baseBranch)}`
  ].join("\n");
}

async function createIssueOnGhTerminalSpec({ session = {} } = {}) {
  return completedMetadataSpec({
    applySuccessFacts: createIssueSuccessMetadataFromFacts,
    commandPreview: "gh issue create",
    cwd: normalizeText(session.metadata?.worktree_path) || session.targetRoot || process.cwd(),
    label: "Create issue on GH",
    script: createIssueOnGhScript(session)
  });
}

async function createPrOnGhTerminalSpec({ session = {} } = {}) {
  const branch = normalizeText(session.metadata?.branch);
  if (!branch) {
    return {
      ok: false,
      message: "Create the worktree before creating the pull request."
    };
  }
  return worktreeCommandSpec({
    applySuccessFacts: createPrSuccessMetadataFromFacts,
    commandPreview: "gh pr create",
    label: "Create PR on GH",
    script: createPrOnGhScript(session),
    session
  });
}

async function mergePrTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  if (!normalizeText(session.metadata?.pr_url)) {
    return {
      ok: false,
      message: "Create the pull request before merging."
    };
  }
  const config = context.config || session.config || {};
  const configValues = config.values || config;
  const hook = hooks?.beforeMerge;
  const hookResult = typeof hook === "function"
    ? await hook({
        context,
        session,
        targetRoot,
        worktreePath: normalizeText(session.metadata?.worktree_path)
      })
    : {};
  const beforeMergeScript = normalizeText(hookResult?.script || hookResult);
  return worktreeCommandSpec({
    commandPreview: "gh pr merge",
    label: "Merge PR",
    metadata: {
      pr_merged: "yes"
    },
    script: mergePrScript({
      beforeMergeScript,
      mergeMethod: configValues.github_pr_merge_method,
      session
    }),
    session
  });
}

async function syncMainCheckoutTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  if (!normalizeText(session.metadata?.pr_merged)) {
    return {
      ok: false,
      message: "Merge the pull request before syncing the main checkout."
    };
  }
  const syncRoot = targetRoot || session.targetRoot || process.cwd();
  return completedMetadataSpec({
    commandPreview: "git fetch && git pull --ff-only",
    cwd: syncRoot,
    label: "Sync main checkout",
    metadata: {
      main_checkout_synced: "yes"
    },
    script: syncMainCheckoutScript(session, syncRoot)
  });
}

const COMMAND_TERMINAL_SPECS = Object.freeze({
  commit_changes: commitChangesTerminalSpec,
  create_issue_on_gh: createIssueOnGhTerminalSpec,
  create_pr_on_gh: createPrOnGhTerminalSpec,
  create_worktree: createWorktreeTerminalSpec,
  install_dependencies: installDependenciesTerminalSpec,
  merge_pr: mergePrTerminalSpec,
  run_automated_checks: runAutomatedChecksTerminalSpec,
  sync_main_checkout: syncMainCheckoutTerminalSpec
});

async function createAiStudioWorkflowCommandTerminalSpec({
  commandId = "",
  context = {},
  hooks = {},
  targetRoot = ""
} = {}) {
  const createSpec = COMMAND_TERMINAL_SPECS[normalizeText(commandId)];
  if (!createSpec) {
    return {
      ok: false,
      message: `AI Studio workflow command ${commandId} is not implemented in the command terminal.`
    };
  }
  return createSpec({
    context,
    hooks,
    session: context.session || {},
    targetRoot
  });
}

export {
  createAiStudioWorkflowCommandTerminalSpec,
  createWorktreeBranch,
  createWorktreePath,
  DEFAULT_AUTOMATED_CHECK_COMMAND,
  DEFAULT_INSTALL_COMMAND
};
