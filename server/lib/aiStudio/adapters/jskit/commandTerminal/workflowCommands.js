import {
  metadataPath,
  normalizeText,
  shellQuote,
  worktreeCommandSpec,
  writeMetadataLineScript
} from "./shared.js";

function runAutomatedChecksScript() {
  return [
    "set -e",
    "printf '[studio] Running JSKIT automated checks.\\n'",
    "printf '[studio] $ npm run build\\n\\n'",
    "npm run build"
  ].join("\n");
}

function acceptChangesScript(session = {}, worktreePath = "") {
  const changesAcceptedPath = metadataPath(session, "changes_accepted");
  return [
    "set -e",
    `printf '[studio] Reviewing changes in %s\\n' ${shellQuote(worktreePath)}`,
    "git status --short",
    writeMetadataLineScript(changesAcceptedPath, "yes")
  ].join("\n");
}

function commitChangesScript(session = {}) {
  const commitPath = metadataPath(session, "accepted_commit");
  const issueTitlePath = metadataPath(session, "issue_title");
  return [
    "set -e",
    "if [ -z \"$(git status --short)\" ]; then",
    "  printf '[studio] No changes to commit.\\n' >&2",
    "  exit 1",
    "fi",
    `COMMIT_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="AI Studio session ${session.sessionId}"`,
    "fi",
    "printf '[studio] Committing changes: %s\\n' \"$COMMIT_TITLE\"",
    "git add -A",
    "git commit -m \"$COMMIT_TITLE\"",
    "ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    writeMetadataLineScript(commitPath, "\"$ACCEPTED_COMMIT\""),
    "printf '[studio] Committed %s\\n' \"$ACCEPTED_COMMIT\""
  ].join("\n");
}

async function runAutomatedChecksTerminalSpec({ session = {} } = {}) {
  return worktreeCommandSpec({
    commandPreview: "npm run build",
    label: "Run automated checks",
    metadata: {
      automated_checks_run: "yes"
    },
    script: runAutomatedChecksScript(),
    session
  });
}

async function acceptChangesTerminalSpec({ session = {} } = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  return worktreeCommandSpec({
    commandPreview: "git status --short",
    label: "Accept changes",
    script: acceptChangesScript(session, worktreePath),
    session
  });
}

async function commitChangesTerminalSpec({ session = {} } = {}) {
  return worktreeCommandSpec({
    commandPreview: "git add -A && git commit",
    label: "Commit changes",
    script: commitChangesScript(session),
    session
  });
}

export {
  acceptChangesTerminalSpec,
  commitChangesTerminalSpec,
  runAutomatedChecksTerminalSpec
};
