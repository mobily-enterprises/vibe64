import {
  normalizeText
} from "@local/vibe64-core/server/core";

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
  cachePath = "",
  defaultBranch = "",
  remoteUrl = "",
  worktreePath = ""
} = {}) {
  return {
    base_branch: baseBranch,
    base_commit: baseCommit,
    branch,
    worktree_cache_path: cachePath,
    worktree_default_branch: defaultBranch || baseBranch,
    worktree_kind: "session_clone",
    worktree_remote_url: remoteUrl,
    worktree_path: worktreePath
  };
}

function sessionUsesSourcePullRequest(session = {}) {
  const metadata = session.metadata || {};
  return normalizeText(metadata.source_pr_update_mode) === "stacked" ||
    normalizeText(metadata.pr_source) === "existing" ||
    Boolean(normalizeText(metadata.source_pr_url));
}

function createWorktreeSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  const baseMetadata = metadataFromFacts(facts, [
    "base_branch",
    "base_commit",
    "worktree_cache_path",
    "worktree_default_branch",
    "worktree_kind",
    "worktree_remote_url"
  ]);
  if (!sessionUsesSourcePullRequest(session)) {
    return commandMetadataResult({
      metadata: baseMetadata
    });
  }

  const updateMode = normalizeText(facts.source_pr_update_mode) ||
    normalizeText(session.metadata?.source_pr_update_mode);
  if (updateMode !== "stacked" && !normalizeText(session.metadata?.source_pr_url)) {
    return commandMetadataResult({
      metadata: baseMetadata
    });
  }

  const sessionPrUrl = normalizeText(session.metadata?.pr_url);
  const sourcePrUrl = normalizeText(session.metadata?.source_pr_url);
  const deletePrMetadata = sessionPrUrl && sessionPrUrl === sourcePrUrl
    ? ["pr_url", "pr_source", "pr_number", "pr_title"]
    : [];
  return commandMetadataResult({
    deleteMetadata: deletePrMetadata,
    metadata: {
      ...baseMetadata,
      source_pr_update_mode: "stacked"
    }
  });
}

function commitChangesSuccessMetadataFromFacts({ facts = {} } = {}) {
  return commandMetadataResult({
    metadata: metadataFromFacts(facts, [
      "accepted_commit",
      "branch_pushed",
      "branch_push_remote",
      "local_commit_only",
      "main_checkout_synced",
      "pr_head_owner",
      "pr_head_repository"
    ])
  });
}

function createIssueSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
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
      github_issue_mode: "create",
      issue_source: "created",
      work_anchor_number: normalizeText(metadata.issue_number),
      work_anchor_title: normalizeText(session.metadata?.work_title) || normalizeText(metadata.issue_title),
      work_anchor_type: "issue",
      work_anchor_url: normalizeText(metadata.issue_url),
      ...metadata
    }
  });
}

function createPrSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  const metadata = metadataFromFacts(facts, [
    "pr_number",
    "pr_source",
    "pr_title",
    "pr_url"
  ]);
  if (!metadata.pr_url) {
    return commandMetadataResult();
  }
  return commandMetadataResult({
    metadata: {
      ...metadata,
      pr_source: normalizeText(metadata.pr_source) || (normalizeText(session.metadata?.source_pr_url) ? "stacked" : "created")
    }
  });
}

export {
  commitChangesSuccessMetadataFromFacts,
  createIssueSuccessMetadataFromFacts,
  createPrSuccessMetadataFromFacts,
  createWorktreeSuccessMetadataFromFacts,
  worktreeMetadata
};
