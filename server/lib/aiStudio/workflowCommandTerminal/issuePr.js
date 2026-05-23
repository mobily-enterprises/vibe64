import process from "node:process";

import {
  shellQuote
} from "../../shellCommands.js";
import {
  normalizeText
} from "../core.js";
import {
  artifactFilePath,
  metadataFilePath,
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
  const stepId = "create_pull_request";
  const prBodyPath = artifactFilePath(session, `tmp/${stepId}.body.md`);
  const prTitlePath = artifactFilePath(session, `tmp/${stepId}.title.txt`);
  const sourcePrUrl = normalizeText(session.metadata?.source_pr_url);
  const branch = normalizeText(session.metadata?.branch);
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  const quotedBaseBranch = shellQuote(baseBranch);
  const quotedBranch = shellQuote(branch);
  return [
    "set -e",
    stepArtifactShellLibrary(session, stepId),
    "ai_studio_require_tmp_artifact title.txt 'pull request title artifact'",
    "ai_studio_require_tmp_artifact body.md 'pull request body artifact'",
    `PR_TITLE="$(head -n 1 ${shellQuote(prTitlePath)} | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$PR_TITLE\" ]; then",
    "  printf '[studio] Pull request title is empty.\\n' >&2",
    "  exit 1",
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
    "if [ -n \"$SOURCE_PR_URL\" ]; then",
    "  PR_SOURCE=replacement",
    "else",
    "  PR_SOURCE=created",
    "fi",
    "PR_BODY_FILE=" + shellQuote(prBodyPath),
    "if [ -n \"$SOURCE_PR_URL\" ]; then",
    "  PR_BODY_FILE=\"$(mktemp)\"",
    `  cat ${shellQuote(prBodyPath)} > "$PR_BODY_FILE"`,
    "  printf '\\n\\nContinues existing pull request: %s\\n' \"$SOURCE_PR_URL\" >> \"$PR_BODY_FILE\"",
    "fi",
    "find_existing_pull_request_url() {",
    "  gh pr list --head \"$EXPECTED_BRANCH\" --base \"$BASE_BRANCH\" --state open --json url --jq '.[0].url' 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//'",
    "}",
    "PR_URL=\"$(find_existing_pull_request_url)\"",
    "if [ -n \"$PR_URL\" ]; then",
    "  printf '[studio] GitHub pull request already exists: %s\\n' \"$PR_URL\"",
    "  printf '%s\\n' \"$PR_URL\"",
    "  ai_studio_write_artifact url.txt \"$PR_URL\"",
    "  ai_studio_write_artifact source.txt \"$PR_SOURCE\"",
    `  ${recordCommandFactScript("pr_url", "\"$PR_URL\"")}`,
    `  ${recordCommandFactScript("pr_title", "\"$PR_TITLE\"")}`,
    `  ${recordCommandFactScript("pr_source", "\"$PR_SOURCE\"")}`,
    "  rm -f \"$(ai_studio_tmp_artifact_path body.md)\"",
    "  rm -f \"$(ai_studio_tmp_artifact_path title.txt)\"",
    "  exit 0",
    "fi",
    "printf '[studio] Creating GitHub pull request: %s\\n' \"$PR_TITLE\"",
    "if ! PR_URL=\"$(gh pr create --base \"$BASE_BRANCH\" --head \"$EXPECTED_BRANCH\" --title \"$PR_TITLE\" --body-file \"$PR_BODY_FILE\")\"; then",
    "  PR_URL=\"$(find_existing_pull_request_url)\"",
    "  if [ -z \"$PR_URL\" ]; then",
    "    exit 1",
    "  fi",
    "  printf '[studio] GitHub pull request already exists: %s\\n' \"$PR_URL\"",
    "fi",
    "printf '%s\\n' \"$PR_URL\"",
    "ai_studio_write_artifact url.txt \"$PR_URL\"",
    "ai_studio_write_artifact source.txt \"$PR_SOURCE\"",
    recordCommandFactScript("pr_url", "\"$PR_URL\""),
    recordCommandFactScript("pr_title", "\"$PR_TITLE\""),
    recordCommandFactScript("pr_source", "\"$PR_SOURCE\""),
    "PR_NUMBER=\"$(printf '%s\\n' \"$PR_URL\" | sed -n 's#.*/pull/\\([0-9][0-9]*\\).*#\\1#p' | head -n 1)\"",
    "if [ -n \"$PR_NUMBER\" ]; then",
    "  ai_studio_write_artifact number.txt \"$PR_NUMBER\"",
    `  ${recordCommandFactScript("pr_number", "\"$PR_NUMBER\"")}`,
    "fi",
    "rm -f \"$(ai_studio_tmp_artifact_path body.md)\"",
    "rm -f \"$(ai_studio_tmp_artifact_path title.txt)\""
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

export {
  createIssueOnGhTerminalSpec,
  createPrOnGhTerminalSpec
};
