import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  metadataFilePath,
  recordCommandFactScript
} from "../workflowCommandFacts.js";
import {
  commitChangesSuccessMetadataFromFacts
} from "./factMetadata.js";
import {
  worktreeCommandSpec
} from "./shellHelpers.js";

function commitChangesScript(session = {}) {
  const workTitlePath = metadataFilePath(session, "work_title");
  const issueTitlePath = metadataFilePath(session, "issue_title");
  const baseBranch = normalizeText(session.metadata?.base_branch) ||
    normalizeText(session.metadata?.source_pr_head_ref) ||
    normalizeText(session.metadata?.source_pr_base_ref) ||
    "main";
  return [
    "set -e",
    `COMMIT_TITLE="$(cat ${shellQuote(workTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "fi",
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="Vibe64 session ${session.sessionId}"`,
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
    "printf '[studio] Pushing branch %s\\n' \"$CURRENT_BRANCH\"",
    "git push -u origin \"$CURRENT_BRANCH\"",
    recordCommandFactScript("branch_pushed", "\"$CURRENT_BRANCH\""),
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

export {
  commitChangesTerminalSpec
};
