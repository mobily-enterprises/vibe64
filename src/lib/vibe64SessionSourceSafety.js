function normalizedCount(value = 0) {
  return Math.max(0, Number(value) || 0);
}

function sourceSafetyRequiresPush(status = {}) {
  return status?.requiresPush === true;
}

function sourceSafetyHasUncommittedChanges(status = {}) {
  return normalizedCount(status?.changedFileCount) > 0;
}

function sourceSafetyIsUnsafe(status = {}) {
  return Boolean(
    status?.initialized &&
    status?.available !== false &&
    status?.unsafe
  );
}

function sourceSafetyButtonLabel(status = {}) {
  if (status?.promptSent) {
    return "Prompt sent";
  }
  if (status?.prompting) {
    return "Sending";
  }
  return sourceSafetyRequiresPush(status) ? "Commit & push" : "Commit";
}

function sourceSafetyMarkStyle(status = {}) {
  const ratio = Math.min(1, normalizedCount(status?.severity) / 100);
  const hue = Math.round(48 * (1 - ratio));
  const saturation = Math.round(94 - (ratio * 10));
  const lightness = Math.round(53 - (ratio * 7));
  return {
    "--vibe64-source-safety-color": `hsl(${hue} ${saturation}% ${lightness}%)`
  };
}

function pluralizedCount(value = 0, singular = "item", plural = `${singular}s`) {
  const count = normalizedCount(value);
  return `${count} ${count === 1 ? singular : plural}`;
}

function sourceSafetyStatusSummary(status = {}) {
  const changedFileCount = normalizedCount(status?.changedFileCount);
  const unpushedCommitCount = normalizedCount(status?.unpushedCommitCount);
  const details = [];
  if (sourceSafetyHasUncommittedChanges(status)) {
    details.push(`${pluralizedCount(changedFileCount, "file")} not committed`);
  }
  if (sourceSafetyRequiresPush(status) && unpushedCommitCount > 0) {
    details.push(`${pluralizedCount(unpushedCommitCount, "commit")} not pushed`);
  }
  return details.join("; ") || "Session work is not safely stored";
}

function sourceSafetyStatusTitle(status = {}) {
  if (status?.promptError) {
    return `The save-work prompt failed: ${String(status.promptError)}`;
  }
  const action = sourceSafetyRequiresPush(status)
    ? "Click to commit and push."
    : "Click to commit.";
  return `${sourceSafetyStatusSummary(status)}. ${action}`;
}

function sourceSafetyDialogTitle(status = {}) {
  return sourceSafetyRequiresPush(status)
    ? "Unpushed work could be left behind"
    : "Uncommitted work could be left behind";
}

function sourceSafetyDialogMessage(status = {}) {
  const changedFileCount = normalizedCount(status?.changedFileCount);
  const unpushedCommitCount = normalizedCount(status?.unpushedCommitCount);
  const parts = [];
  if (sourceSafetyHasUncommittedChanges(status)) {
    parts.push(
      `${pluralizedCount(changedFileCount, "changed file")} still ${changedFileCount === 1 ? "needs" : "need"} to be committed`
    );
  }
  if (sourceSafetyRequiresPush(status) && unpushedCommitCount > 0) {
    parts.push(
      `${pluralizedCount(unpushedCommitCount, "local commit")} still ${unpushedCommitCount === 1 ? "needs" : "need"} to be pushed`
    );
  }
  const detail = parts.length
    ? parts.join(" and ")
    : "This session contains work that is not safely stored";
  const destination = sourceSafetyRequiresPush(status)
    ? "Commit and push it before abandoning this session."
    : "Commit it before abandoning this session.";
  return `${detail}. ${destination}`;
}

function sourceSafetyDisplayPrompt(status = {}) {
  return sourceSafetyRequiresPush(status)
    ? "Commit and push all current session work to origin/main."
    : "Commit all current session work.";
}

function sourceSafetyPrompt(status = {}) {
  const requiresPush = sourceSafetyRequiresPush(status);
  return [
    requiresPush
      ? "Commit and push all current work in this Git-backed session to origin/main."
      : "Commit all current work in this local-source session.",
    "This is an independent source-safety request, not a Vibe64 workflow step. Do not change the workflow state.",
    "Use the fast path. Run git status --short --branch, then commit every current worktree change as-is, including untracked portable Vibe64 source contracts such as vibe64.system.json. Do not inspect file contents, edit files, or run audits, validation, lint, tests, or builds for a straightforward save.",
    requiresPush
      ? "Fetch only origin/main. If origin/main is an ancestor of HEAD, immediately push HEAD:refs/heads/main. If HEAD is an ancestor of origin/main, fast-forward to origin/main and finish. Otherwise perform one normal merge of origin/main into the current work; if it succeeds cleanly, immediately push HEAD:refs/heads/main. Only ever push to origin/main. Never push another ref, rebase, force-push, create a fork, or start pull-request work. If a Git command fails or the merge conflicts, stop and ask the user; do not start a broader investigation."
      : "Do not push; after committing, verify that the working tree is clean. If the commit fails, stop and ask the user.",
    requiresPush
      ? "Verify that live origin/main equals HEAD, then report the commit SHA in one concise response."
      : "Report the commit SHA in one concise response."
  ].join("\n\n");
}

export {
  sourceSafetyButtonLabel,
  sourceSafetyDialogMessage,
  sourceSafetyDialogTitle,
  sourceSafetyDisplayPrompt,
  sourceSafetyHasUncommittedChanges,
  sourceSafetyIsUnsafe,
  sourceSafetyMarkStyle,
  sourceSafetyPrompt,
  sourceSafetyRequiresPush,
  sourceSafetyStatusSummary,
  sourceSafetyStatusTitle
};
