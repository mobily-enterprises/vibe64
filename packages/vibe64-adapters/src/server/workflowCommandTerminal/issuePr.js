import process from "node:process";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  artifactFilePath,
  recordCommandFactScript,
  requiredArtifactScript,
  stepArtifactShellLibrary
} from "../workflowCommandFacts.js";
import {
  createIssueSuccessMetadataFromFacts,
  createPrSuccessMetadataFromFacts
} from "./factMetadata.js";
import {
  completedMetadataSpec,
  worktreeCommandSpec
} from "./shellHelpers.js";

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
  const stepId = "create_and_merge_pull_request";
  const prBodyPath = artifactFilePath(session, `tmp/${stepId}.body.md`);
  const prTitlePath = artifactFilePath(session, `tmp/${stepId}.title.txt`);
  const sourcePrHeadSha = normalizeText(session.metadata?.source_pr_head_sha);
  const sourcePrNumber = normalizeText(session.metadata?.source_pr_number);
  const sourcePrUrl = normalizeText(session.metadata?.source_pr_url);
  const branch = normalizeText(session.metadata?.branch);
  const branchPushRemote = normalizeText(session.metadata?.branch_push_remote) || "origin";
  const prHeadOwner = normalizeText(session.metadata?.pr_head_owner);
  const baseBranch = normalizeText(session.metadata?.base_branch) ||
    normalizeText(session.metadata?.source_pr_head_ref) ||
    "main";
  const quotedBaseBranch = shellQuote(baseBranch);
  const quotedBranchPushRemote = shellQuote(branchPushRemote);
  const quotedBranch = shellQuote(branch);
  const quotedPrHeadOwner = shellQuote(prHeadOwner);
  return [
    "set -e",
    stepArtifactShellLibrary(session, stepId),
    "vibe64_require_tmp_artifact title.txt 'pull request title artifact'",
    "vibe64_require_tmp_artifact body.md 'pull request body artifact'",
    `PR_TITLE="$(head -n 1 ${shellQuote(prTitlePath)} | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$PR_TITLE\" ]; then",
    "  printf '[studio] Pull request title is empty.\\n' >&2",
    "  exit 1",
    "fi",
    `EXPECTED_BRANCH=${quotedBranch}`,
    `BASE_BRANCH=${quotedBaseBranch}`,
    `BRANCH_PUSH_REMOTE=${quotedBranchPushRemote}`,
    `PR_HEAD_OWNER=${quotedPrHeadOwner}`,
    "if [ -n \"$PR_HEAD_OWNER\" ]; then",
    "  PR_HEAD=\"$PR_HEAD_OWNER:$EXPECTED_BRANCH\"",
    "else",
    "  PR_HEAD=\"$EXPECTED_BRANCH\"",
    "fi",
    "CURRENT_BRANCH=\"$(git branch --show-current)\"",
    "if [ \"$CURRENT_BRANCH\" != \"$EXPECTED_BRANCH\" ]; then",
    "  printf '[studio] Worktree is on branch %s, expected %s.\\n' \"$CURRENT_BRANCH\" \"$EXPECTED_BRANCH\" >&2",
    "  exit 1",
    "fi",
    `SOURCE_PR_NUMBER=${shellQuote(sourcePrNumber)}`,
    `SOURCE_PR_HEAD_SHA=${shellQuote(sourcePrHeadSha)}`,
    "if [ -n \"$SOURCE_PR_NUMBER\" ]; then",
    "  printf '[studio] Validating stacked PR base #%s\\n' \"$SOURCE_PR_NUMBER\"",
    "  SOURCE_PR_STATE=\"$(gh pr view \"$SOURCE_PR_NUMBER\" --json state --jq '.state' 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  SOURCE_PR_CURRENT_SHA=\"$(gh pr view \"$SOURCE_PR_NUMBER\" --json headRefOid --jq '.headRefOid' 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  if [ -z \"$SOURCE_PR_STATE\" ] || [ -z \"$SOURCE_PR_CURRENT_SHA\" ]; then",
    "    printf '[studio] Could not validate existing PR #%s. Check GitHub access, then retry.\\n' \"$SOURCE_PR_NUMBER\" >&2",
    "    exit 1",
    "  fi",
    "  if [ \"$SOURCE_PR_STATE\" != \"OPEN\" ]; then",
    "    printf '[studio] Existing PR #%s is %s. Start a new session from the current work anchor.\\n' \"$SOURCE_PR_NUMBER\" \"$SOURCE_PR_STATE\" >&2",
    "    exit 1",
    "  fi",
    "  if [ -n \"$SOURCE_PR_HEAD_SHA\" ] && [ \"$SOURCE_PR_CURRENT_SHA\" != \"$SOURCE_PR_HEAD_SHA\" ]; then",
    "    printf '[studio] Existing PR #%s moved from %s to %s. Start a new session from the updated PR.\\n' \"$SOURCE_PR_NUMBER\" \"$SOURCE_PR_HEAD_SHA\" \"$SOURCE_PR_CURRENT_SHA\" >&2",
    "    exit 1",
    "  fi",
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
    "if ! git ls-remote --exit-code --heads \"$BRANCH_PUSH_REMOTE\" \"$EXPECTED_BRANCH\" >/dev/null 2>&1; then",
    "  printf '[studio] Branch %s is not pushed to %s. Run Commit and push changes before creating the pull request.\\n' \"$EXPECTED_BRANCH\" \"$BRANCH_PUSH_REMOTE\" >&2",
    "  exit 1",
    "fi",
    `SOURCE_PR_URL=${shellQuote(sourcePrUrl)}`,
    "if [ -n \"$SOURCE_PR_URL\" ]; then",
    "  PR_SOURCE=stacked",
    "else",
    "  PR_SOURCE=created",
    "fi",
    "PR_BODY_FILE=" + shellQuote(prBodyPath),
    "if [ -n \"$SOURCE_PR_URL\" ]; then",
    "  PR_BODY_FILE=\"$(mktemp)\"",
    `  cat ${shellQuote(prBodyPath)} > "$PR_BODY_FILE"`,
    "  printf '\\n\\nStacks on existing pull request: %s\\n' \"$SOURCE_PR_URL\" >> \"$PR_BODY_FILE\"",
    "fi",
    "find_existing_pull_request_url() {",
    "  gh pr list --head \"$PR_HEAD\" --base \"$BASE_BRANCH\" --state open --json url --jq '.[0].url' 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//'",
    "}",
    "PR_URL=\"$(find_existing_pull_request_url)\"",
    "if [ -n \"$PR_URL\" ]; then",
    "  printf '[studio] GitHub pull request already exists: %s\\n' \"$PR_URL\"",
    "  printf '%s\\n' \"$PR_URL\"",
    "  vibe64_write_artifact url.txt \"$PR_URL\"",
    "  vibe64_write_artifact source.txt \"$PR_SOURCE\"",
    `  ${recordCommandFactScript("pr_url", "\"$PR_URL\"")}`,
    `  ${recordCommandFactScript("pr_title", "\"$PR_TITLE\"")}`,
    `  ${recordCommandFactScript("pr_source", "\"$PR_SOURCE\"")}`,
    "  rm -f \"$(vibe64_tmp_artifact_path body.md)\"",
    "  rm -f \"$(vibe64_tmp_artifact_path title.txt)\"",
    "  exit 0",
    "fi",
    "printf '[studio] Creating GitHub pull request: %s\\n' \"$PR_TITLE\"",
    "if ! PR_URL=\"$(gh pr create --base \"$BASE_BRANCH\" --head \"$PR_HEAD\" --title \"$PR_TITLE\" --body-file \"$PR_BODY_FILE\")\"; then",
    "  PR_URL=\"$(find_existing_pull_request_url)\"",
    "  if [ -z \"$PR_URL\" ]; then",
    "    exit 1",
    "  fi",
    "  printf '[studio] GitHub pull request already exists: %s\\n' \"$PR_URL\"",
    "fi",
    "printf '%s\\n' \"$PR_URL\"",
    "vibe64_write_artifact url.txt \"$PR_URL\"",
    "vibe64_write_artifact source.txt \"$PR_SOURCE\"",
    recordCommandFactScript("pr_url", "\"$PR_URL\""),
    recordCommandFactScript("pr_title", "\"$PR_TITLE\""),
    recordCommandFactScript("pr_source", "\"$PR_SOURCE\""),
    "PR_NUMBER=\"$(printf '%s\\n' \"$PR_URL\" | sed -n 's#.*/pull/\\([0-9][0-9]*\\).*#\\1#p' | head -n 1)\"",
    "if [ -n \"$PR_NUMBER\" ]; then",
    "  vibe64_write_artifact number.txt \"$PR_NUMBER\"",
    `  ${recordCommandFactScript("pr_number", "\"$PR_NUMBER\"")}`,
    "fi",
    "rm -f \"$(vibe64_tmp_artifact_path body.md)\"",
    "rm -f \"$(vibe64_tmp_artifact_path title.txt)\""
  ].join("\n");
}

async function createIssueOnGhTerminalSpec({ session = {} } = {}) {
  return completedMetadataSpec({
    applySuccessFacts: createIssueSuccessMetadataFromFacts,
    commandPreview: "gh issue create",
    cwd: sessionSourcePath(session) || session.targetRoot || process.cwd(),
    label: "Create issue on GH",
    script: createIssueOnGhScript(session)
  });
}

async function createPrOnGhTerminalSpec({ session = {} } = {}) {
  const branch = normalizeText(session.metadata?.branch);
  if (!branch) {
    return {
      ok: false,
      message: "Create the session clone before creating the pull request."
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

export {
  createIssueOnGhTerminalSpec,
  createPrOnGhTerminalSpec
};
